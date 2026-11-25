/**
 * The launcher's data: Palot's real sources read through the existing query keys and stores.
 * Catalogs come from the cache the composer prefetches, so opening the launcher never waits
 * on a request when they are there; only workspace file search fetches per query, debounced
 * and cancelled when superseded. Stores that change while the launcher is closed (the
 * workbench, the session graph, the stash) are read only while it is open.
 */

import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import { useEffect, useMemo, useState } from "react";
import type { LocationRef } from "@opencode/client";
import type { PalotProject, PalotSession } from "../../../shared";
import { useWorkbenchScope } from "../../atoms/workbench";
import { runtimeAtom } from "../../atoms/workspace";
import {
  composerCatalogQueryOptions,
  workspaceFileSearchQueryOptions,
} from "../../hooks/use-composer-discovery";
import { useSettingsSnapshot } from "../../hooks/use-settings-snapshot";
import { withoutChatProjects } from "../../lib/chats";
import { openWorkbenchFiles } from "../../lib/composer-open-files";
import { useShortcutKeys } from "../../lib/keyboard-shortcuts";
import { isCompleteSessionID } from "../../lib/markdown-session-links";
import { openCodeReconciler } from "../../lib/open-code-reconciler";
import { locationKey } from "../../lib/opencode-query";
import { canFetchOpenCode } from "../../lib/opencode-runtime-query";
import { loadPromptStash } from "../../lib/prompt-stash";
import { collectRecentProjectOutputs, type LoadedTask } from "../../lib/recent-project-outputs";
import { projectForSession, projectName } from "../../lib/view-models";
import { mapProject, mapSession } from "../../services/opencode-mappers";
import type { LauncherSourceID, LauncherSources, LauncherTask } from "./launcher-items";
import type { LauncherState } from "./launcher-state";
import {
  buildLauncherView,
  type LauncherSuggestionSource,
  type LauncherView,
} from "./launcher-view";

/** Typing pause before a workspace file search starts. */
export const FILE_SEARCH_DEBOUNCE_MS = 120;

const EMPTY_LIST: readonly never[] = [];

/**
 * Tasks `@` can mention: root tasks that are not archived, not this task and have a complete
 * ID, newest first. The caller supplies the active connection's catalog, never a cross-server
 * task list.
 */
export function launcherTasks(
  sessions: readonly PalotSession[],
  projects: PalotProject[],
  currentSessionID: string | null,
): LauncherTask[] {
  return sessions
    .filter(
      (session) =>
        !session.parentID &&
        !session.archivedAt &&
        session.id !== currentSessionID &&
        isCompleteSessionID(session.id),
    )
    .toSorted((left, right) => right.updatedAt - left.updatedAt || left.id.localeCompare(right.id))
    .map((session) => {
      const project = projectForSession(projects, session);
      return {
        id: session.id,
        title: session.title?.trim() || "Untitled task",
        project: project ? projectName(project) : session.location.directory,
        updatedAt: session.updatedAt,
      };
    });
}

function useDebouncedValue<T>(value: T, delay: number, active: boolean): T {
  const [debounced, setDebounced] = useState(value);
  // While inactive it follows the value at once, so the next activation starts current.
  if (!active && !Object.is(debounced, value)) setDebounced(value);
  useEffect(() => {
    if (!active) return;
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [active, delay, value]);
  return active ? debounced : value;
}

function errorText(error: unknown, fallback: string): string | null {
  if (!error) return null;
  return error instanceof Error && error.message ? error.message : fallback;
}

export interface LauncherDataInput {
  state: LauncherState;
  location: LocationRef;
  /** The task's project, for the agent and reference catalog. */
  projectID: string;
  /** The project recent outputs come from; defaults to `projectID`. */
  outputProjectID?: string;
  /** The open task; null for a new task. Excluded from task mentions. */
  sessionID: string | null;
  /** The workbench scope's task, for open files (a new task's draft scope has one too). */
  workbenchSessionID?: string | null;
  newTask: boolean;
  /** `lib/prompt-stash.ts` scope (profile and project). */
  stashScope: string;
  /** Changes when the launcher edited the stash (a deleted entry), so it is read again. */
  stashRevision?: number;
  /** The open task's state for "Suggested"; null for a new task. */
  session: LauncherSources["session"];
  attachDisabled?: boolean;
  /** The task's approvals, for the Approvals entry; absent hides it. */
  approvals?: LauncherSources["approvals"];
  /** The review picker's base branch and saved instructions. */
  review?: LauncherSources["review"];
  suggestions?: readonly LauncherSuggestionSource[];
}

interface LauncherData {
  view: LauncherView;
  sources: LauncherSources;
  /** The clock the view was built with, so a key can rebuild the same view. */
  now: number;
}

interface OpenSnapshot {
  now: number;
  tasks: LauncherTask[];
  outputs: LauncherSources["outputs"];
}

const CLOSED_SNAPSHOT: OpenSnapshot = { now: 0, tasks: [], outputs: [] };

export function useLauncherData(input: LauncherDataInput): LauncherData {
  const { state, location, projectID, sessionID, newTask, stashScope, session } = input;
  const { attachDisabled = false, approvals = null, review = null } = input;
  const outputProjectID = input.outputProjectID ?? projectID;
  const workbenchSessionID =
    input.workbenchSessionID === undefined ? sessionID : input.workbenchSessionID;
  const open = state.status === "open";
  const category = open ? state.category : null;
  const query = open ? state.query.trim() : "";
  const runtime = useAtomValue(runtimeAtom);
  const queryClient = useQueryClient();
  const connectionID = runtime?.connectionID ?? "disconnected";
  const fetchable = open && canFetchOpenCode(runtime);
  const locationID = locationKey(location);

  const catalog = useQuery(composerCatalogQueryOptions(connectionID, location, fetchable));
  const mentionCatalog = useSettingsSnapshot(
    { ...location, projectID, capabilities: ["agents", "references"] },
    fetchable,
  );

  // Root queries span every category, files included.
  const searching = open && (category === "mention" || (category === null && query !== ""));
  const searchQuery = useDebouncedValue(query, FILE_SEARCH_DEBOUNCE_MS, searching);
  const search = useQuery({
    ...workspaceFileSearchQueryOptions(connectionID, location, searchQuery, searching && fetchable),
    // Older rows stay listed (disabled) while the next query's rows load.
    placeholderData: keepPreviousData,
  });
  const searchSettled = searchQuery === query && !search.isPlaceholderData;

  const workbench = useWorkbenchScope(
    open && runtime && workbenchSessionID
      ? { profileID: runtime.profileID, sessionID: workbenchSessionID }
      : null,
  );
  const openFiles = useMemo(
    () => (open ? openWorkbenchFiles(workbench, runtime?.profileID, location) : EMPTY_LIST),
    // `locationID` stands for `location`, which callers may rebuild every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [open, workbench, runtime?.profileID, locationID],
  );

  // Tasks and outputs are read once per opening: they are in memory or local
  // storage, and nothing the launcher shows needs them live.
  const snapshot = useMemo<OpenSnapshot>(() => {
    if (!open) return CLOSED_SNAPSHOT;
    const reconciler = openCodeReconciler(queryClient);
    const sessions = reconciler.sessions(connectionID).map(mapSession);
    const projects = withoutChatProjects(reconciler.projects(connectionID).map(mapProject));
    const tasks: LoadedTask[] = sessions.map((candidate) => ({
      connectionID,
      session: candidate,
      messages: reconciler.messages(connectionID, candidate.id),
    }));
    return {
      now: Date.now(),
      tasks: launcherTasks(sessions, projects, sessionID),
      outputs: collectRecentProjectOutputs({
        connectionID,
        projectID: outputProjectID,
        location,
        tasks,
        projectOf: (candidate) => projectForSession(projects, candidate)?.id ?? candidate.projectID,
      }),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, queryClient, connectionID, outputProjectID, locationID, sessionID]);
  // The stash too, and again after the launcher deletes an entry.
  const stashRevision = input.stashRevision ?? 0;
  const stash = useMemo(
    () => (open ? loadPromptStash(stashScope) : EMPTY_LIST),
    // `stashRevision` only says the stored list changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [open, stashScope, stashRevision],
  );

  const attachShortcut = useShortcutKeys("composer.attach");
  // The combined snapshot is rebuilt every render; its lists are the cached ones.
  const agents = mentionCatalog.data?.agents;
  const references = mentionCatalog.data?.references;

  const sources = useMemo<LauncherSources>(() => {
    const loading: LauncherSourceID[] = [];
    if (!catalog.data && catalog.isFetching) loading.push("commands", "skills");
    if (mentionCatalog.isPending && mentionCatalog.isFetching) loading.push("mention");
    const catalogError = errorText(catalog.error, "Could not load suggestions.");
    const capabilityError = (capability: string) =>
      catalog.data?.errors.find((error) => error.capability === capability)?.message;
    const errors: LauncherSources["errors"] = {
      commands: catalogError ?? capabilityError("commands"),
      skills: catalogError ?? capabilityError("skills"),
      mention:
        errorText(mentionCatalog.error, "Could not load agents and references.") ?? undefined,
      files: searching
        ? (errorText(search.error, "Could not search workspace files.") ?? undefined)
        : undefined,
    };
    return {
      newTask,
      commands: catalog.data?.commands ?? EMPTY_LIST,
      skills: catalog.data?.skills ?? EMPTY_LIST,
      agents: agents ?? EMPTY_LIST,
      references: references ?? EMPTY_LIST,
      openFiles,
      files: {
        paths: searching ? (search.data ?? EMPTY_LIST).map((entry) => entry.path) : EMPTY_LIST,
        pending: searching && fetchable && (!searchSettled || (search.isFetching && !search.data)),
      },
      tasks: snapshot.tasks,
      outputs: snapshot.outputs,
      stash,
      loading,
      errors,
      attachShortcut,
      session,
      attachDisabled,
      approvals,
      review,
    };
  }, [
    approvals,
    review,
    attachDisabled,
    attachShortcut,
    catalog.data,
    catalog.error,
    catalog.isFetching,
    agents,
    references,
    mentionCatalog.error,
    mentionCatalog.isFetching,
    mentionCatalog.isPending,
    newTask,
    openFiles,
    search.data,
    search.error,
    search.isFetching,
    searchSettled,
    searching,
    fetchable,
    session,
    snapshot,
    stash,
  ]);

  const suggestions = input.suggestions;
  const view = useMemo(
    () => buildLauncherView(state, sources, { now: snapshot.now, suggestions }),
    [snapshot.now, sources, state, suggestions],
  );
  return { view, sources, now: snapshot.now };
}
