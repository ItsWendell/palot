import type { QueryClient, QueryKey } from "@tanstack/react-query";
import type { PalotEvent, PalotMessage } from "../../shared";
import { workspaceRelativePath } from "./file-reference";
import { inboxBranchKeys, isLocationQueryKey, openCodeKeys } from "./opencode-query";

const MODEL_CATALOG_EVENTS = new Set<PalotEvent["type"]>([
  "models-dev.refreshed",
  "provider.updated",
  "model.updated",
  "integration.updated",
  "credential.switched",
]);

const SETTINGS_EVENTS = new Set<PalotEvent["type"]>([
  "config.updated",
  "agent.updated",
  "integration.updated",
  "credential.updated",
  "credential.switched",
  "provider.updated",
  "model.updated",
  "models-dev.refreshed",
  "mcp.status.changed",
  "mcp.resources.changed",
  "plugin.updated",
  "skill.updated",
  "command.updated",
  "reference.updated",
  "websearch.updated",
]);

const COMPOSER_CATALOG_EVENTS = new Set<PalotEvent["type"]>([
  "config.updated",
  "command.updated",
  "skill.updated",
]);

const DIFF_EVENTS = new Set<PalotEvent["type"]>([
  "session.tool.success",
  "session.tool.failed",
  "session.execution.succeeded",
  "session.execution.failed",
  "session.execution.interrupted",
]);

const SESSION_STATS_EVENTS = new Set<PalotEvent["type"]>([
  "session.created",
  "session.deleted",
  "session.forked",
  "session.execution.succeeded",
  "session.execution.failed",
  "session.execution.interrupted",
]);

export function sessionStatsShouldRevalidate(event: PalotEvent): boolean {
  return SESSION_STATS_EVENTS.has(event.type);
}

export function sessionTranscriptShouldRevalidate(
  event: PalotEvent,
  messages: readonly PalotMessage[],
): boolean {
  if (
    event.type !== "session.execution.succeeded" &&
    event.type !== "session.execution.failed" &&
    event.type !== "session.execution.interrupted"
  ) {
    return false;
  }
  // Execution can settle without a terminal event for each tool. Read the
  // authoritative transcript rather than inventing a completed/failed result.
  return messages.some(
    (message) =>
      message.type === "assistant" &&
      message.content.some((part) => {
        const state = part.state;
        return (
          part.type === "tool" &&
          state !== null &&
          typeof state === "object" &&
          !Array.isArray(state) &&
          (state.status === "streaming" || state.status === "running")
        );
      }),
  );
}

// Ephemeral (never replayed) events that only a running location emits. Not MCP status:
// servers report "closed" while their location shuts down.
const LOCATION_LIVE_EVENTS = new Set<PalotEvent["type"]>([
  "session.status",
  "shell.created",
  "vcs.branch.updated",
  "filesystem.changed",
]);

export function locationIsLoadedBy(event: PalotEvent): boolean {
  return LOCATION_LIVE_EVENTS.has(event.type) && Boolean(event.location?.directory);
}

/**
 * An evicted location changed no data, so nothing is re-read: refetching would boot the
 * directory again (and restart its MCP servers) right after OpenCode retired it. Its cached
 * reads are only marked stale, and the next mount or explicit refresh reads them again.
 * Configuration reloads refresh explicitly; moved sessions arrive as `session.moved`.
 */
export function markShutdownLocationStale(
  queryClient: QueryClient,
  connectionID: string,
  directory: string,
): void {
  void queryClient.invalidateQueries({
    predicate: (query) => isLocationQueryKey(query.queryKey, connectionID, directory),
    refetchType: "none",
  });
  // Row branch reads are fill-ins for the remembered label; drop them so the directory reads
  // again only once it is loaded.
  queryClient.removeQueries({ queryKey: inboxBranchKeys.directory(connectionID, directory) });
  queryClient.setQueryData<readonly string[]>(
    openCodeKeys.loadedLocations(connectionID),
    (current) =>
      current?.includes(directory) ? current.filter((entry) => entry !== directory) : current,
  );
}

/** The changed path relative to the event's location, or null when it can't be resolved. */
function changedFileTarget(event: PalotEvent): { directory: string; path: string } | null {
  if (event.type !== "filesystem.changed" || !event.location?.directory) return null;
  const file: unknown = event.data.file;
  if (typeof file !== "string" || !file) return null;
  const path = workspaceRelativePath(event.location.directory, file);
  return path ? { directory: event.location.directory, path } : null;
}

function parentDirectory(path: string): string {
  return path.split("/").slice(0, -1).join("/");
}

/** A cached file read under a location: a file's content or a directory's listing. */
type FileQuery =
  | { kind: "file"; path: string | null }
  | { kind: "listing"; path: string | null }
  | null;

/** What a key under `[...files, directory]` reads, with its path relative to the location. */
function fileQueryOf(directory: string, rest: readonly unknown[]): FileQuery {
  if (rest.length === 1 && typeof rest[0] === "string")
    return { kind: "file", path: workspaceRelativePath(directory, rest[0]) };
  if (rest.length === 2 && rest[0] === "directory" && typeof rest[1] === "string")
    return { kind: "listing", path: workspaceRelativePath(directory, rest[1] || ".") };
  return null;
}

/**
 * The cached reads a `filesystem.changed` event makes stale: the changed file's content (keyed
 * by a path relative to the location or absolute, under any workspace ID), and, when a file or
 * directory was added or removed, the listing of the directory holding it. An added directory
 * also re-reads its own listing if one is cached, so a folder recreated under the same name
 * doesn't show the files the old one held. Other open files keep their data, so their previews
 * don't reload.
 */
export function changedFileQueryKeys(
  queryClient: QueryClient,
  connectionID: string,
  event: PalotEvent,
): QueryKey[] {
  if (event.type !== "filesystem.changed") return [];
  const target = changedFileTarget(event);
  if (!target) return [];
  const listing = event.data.event === "change" ? null : parentDirectory(target.path);
  const added = event.data.event === "add" ? target.path : null;
  const prefix = [...openCodeKeys.files(connectionID), target.directory];
  return queryClient
    .getQueryCache()
    .findAll({ queryKey: prefix })
    .flatMap(({ queryKey }) => {
      const read = fileQueryOf(target.directory, queryKey.slice(prefix.length + 1));
      if (read?.kind === "file") return read.path === target.path ? [queryKey] : [];
      if (read?.kind === "listing")
        return read.path !== null && (read.path === listing || read.path === added)
          ? [queryKey]
          : [];
      return [];
    });
}

/**
 * A removed path may have been a folder (OpenCode reports both as `unlink`): its own listing and
 * every listing and file read below it are forgotten, so a folder recreated under the same name
 * never shows what the old one held. Reads nobody watches are removed; a listing still on screen
 * is emptied rather than re-read (the folder is gone, so a read could only fail), and an open file
 * below it is re-read so it says it no longer exists. The removed path's own content and its
 * parent's listing are `changedFileQueryKeys`' job.
 */
export function forgetRemovedPath(
  queryClient: QueryClient,
  connectionID: string,
  event: PalotEvent,
): void {
  if (event.type !== "filesystem.changed" || event.data.event !== "unlink") return;
  const target = changedFileTarget(event);
  // The location itself going away is `location.shutdown`'s business.
  if (!target || !target.path) return;
  const below = `${target.path}/`;
  const prefix = [...openCodeKeys.files(connectionID), target.directory];
  for (const query of queryClient.getQueryCache().findAll({ queryKey: prefix })) {
    const read = fileQueryOf(target.directory, query.queryKey.slice(prefix.length + 1));
    if (!read || read.path === null) continue;
    const inside = read.path.startsWith(below);
    if (!inside && !(read.kind === "listing" && read.path === target.path)) continue;
    if (!query.isActive()) queryClient.removeQueries({ queryKey: query.queryKey, exact: true });
    else if (read.kind === "listing") queryClient.setQueryData(query.queryKey, []);
    else void queryClient.invalidateQueries({ queryKey: query.queryKey, exact: true });
  }
}

export function openCodeInvalidationKeys(connectionID: string, event: PalotEvent): QueryKey[] {
  // Handled by markShutdownLocationStale: eviction must not re-read (and re-boot) anything.
  if (event.type === "location.shutdown") return [];
  const keys: QueryKey[] = [];
  if (event.type === "artifact.updated") {
    // OpenCode 2.2.5 sends this when the location's artifact providers change.
    keys.push(
      event.location
        ? openCodeKeys.artifactsLocation(connectionID, event.location.directory)
        : openCodeKeys.artifacts(connectionID),
    );
  }
  // Since OpenCode 2.2.7 usage limits no longer wait for plugins: a location still loading
  // answers without the limits a plugin provides, and these events say when to read again.
  // Only mounted readers refetch, since each read asks OpenCode Console.
  if (
    event.type === "integration.updated" ||
    event.type === "credential.updated" ||
    event.type === "credential.switched"
  ) {
    keys.push(
      event.location
        ? openCodeKeys.usageLimits(connectionID, event.location.directory)
        : [...openCodeKeys.all(connectionID), "usage-limits"],
    );
    // Whether the server can start a voice model follows its credentials.
    keys.push(openCodeKeys.voiceModels(connectionID));
  }
  // Spend moves with every turn, and a turn that failed on a limit means the limits changed: the
  // model picker and the Usage page read them again when a turn ends, not on a poll.
  if (event.type === "session.execution.succeeded" || event.type === "session.execution.failed") {
    keys.push(
      event.location
        ? openCodeKeys.usageLimits(connectionID, event.location.directory)
        : [...openCodeKeys.all(connectionID), "usage-limits"],
    );
  }
  if (event.type === "session.inbox.cancelled") {
    keys.push(openCodeKeys.promptIndex(connectionID, event.data.sessionID));
  }
  if (event.type === "vcs.branch.updated") {
    keys.push(
      event.location
        ? openCodeKeys.vcsLocation(connectionID, event.location)
        : openCodeKeys.vcs(connectionID),
    );
    keys.push(
      event.location
        ? openCodeKeys.diffsLocation(connectionID, event.location)
        : openCodeKeys.diffs(connectionID),
    );
    if (event.location) keys.push(openCodeKeys.vcsBranches(connectionID, event.location));
    // A named branch is remembered directly from the event; anything else is re-read.
    if (event.location && event.data.branch === undefined)
      keys.push(inboxBranchKeys.directory(connectionID, event.location.directory));
  }
  if (MODEL_CATALOG_EVENTS.has(event.type)) {
    keys.push(
      event.location
        ? openCodeKeys.modelsLocation(connectionID, event.location)
        : openCodeKeys.models(connectionID),
    );
  }
  if (SETTINGS_EVENTS.has(event.type)) {
    keys.push(
      event.location
        ? openCodeKeys.settingsLocation(connectionID, event.location)
        : openCodeKeys.settings(connectionID),
    );
  }
  if (COMPOSER_CATALOG_EVENTS.has(event.type)) {
    keys.push(
      event.location
        ? openCodeKeys.composerCatalog(connectionID, event.location)
        : openCodeKeys.composerCatalogs(connectionID),
    );
  }
  if (event.type === "filesystem.changed") {
    // Watches and their events are scoped to a directory, not a workspace: match file queries
    // for the directory under any workspace ID by key prefix.
    keys.push(
      event.location
        ? [...openCodeKeys.fileSearches(connectionID), event.location.directory]
        : openCodeKeys.fileSearches(connectionID),
    );
    // A located change names its file, and `changedFileQueryKeys` refreshes only that file's
    // reads; without a location there is no root to resolve it against.
    if (!event.location || changedFileTarget(event) === null) {
      keys.push(
        event.location
          ? [...openCodeKeys.files(connectionID), event.location.directory]
          : openCodeKeys.files(connectionID),
      );
    }
    keys.push(
      event.location
        ? openCodeKeys.vcsLocation(connectionID, event.location)
        : openCodeKeys.vcs(connectionID),
    );
    keys.push(
      event.location
        ? openCodeKeys.diffsLocation(connectionID, event.location)
        : openCodeKeys.diffs(connectionID),
    );
  }
  if (DIFF_EVENTS.has(event.type)) {
    keys.push(
      event.location
        ? openCodeKeys.diffsLocation(connectionID, event.location)
        : openCodeKeys.diffs(connectionID),
    );
  }
  if (
    event.type === "session.shell.started" ||
    event.type === "session.shell.ended" ||
    event.type === "shell.created" ||
    event.type === "shell.exited" ||
    event.type === "shell.deleted"
  ) {
    // Running work counts follow these events instead of polling, so match the directory
    // under any workspace ID.
    keys.push(
      event.location
        ? [...openCodeKeys.runningShellsRoot(connectionID), event.location.directory]
        : openCodeKeys.runningShellsRoot(connectionID),
    );
    if (event.location) keys.push(openCodeKeys.backgroundJobsRoot(connectionID));
  }
  // OpenCode 2.4.0: a job started, moved to the background or ended. Shell jobs decide which
  // family directories running work reads; scripts follow the event itself.
  if (event.type === "experimental.job.updated" && event.data.info.kind === "shell") {
    keys.push(openCodeKeys.backgroundJobsRoot(connectionID));
  }
  if (event.type === "persistent-pty.added" || event.type === "persistent-pty.removed") {
    keys.push(openCodeKeys.sessionTerminals(connectionID, event.data.sessionID));
  }
  // Exit events name only the terminal, not its session.
  if (event.type === "pty.exited" || event.type === "pty.deleted") {
    keys.push(openCodeKeys.terminals(connectionID));
  }
  if (event.type === "session.forked") {
    keys.push(openCodeKeys.childSessions(connectionID, event.data.parentID));
    keys.push(openCodeKeys.session(connectionID, event.data.sessionID));
    keys.push(openCodeKeys.transcript(connectionID, event.data.sessionID));
    keys.push(openCodeKeys.sessionActivity(connectionID));
  }
  if (event.type === "session.metadata.updated") {
    keys.push(openCodeKeys.session(connectionID, event.data.sessionID));
  }
  if (event.type === "session.instructions.updated") {
    keys.push(openCodeKeys.sessionInstructionEntries(connectionID, event.data.sessionID));
    keys.push(openCodeKeys.sessionContext(connectionID, event.data.sessionID));
  }
  if (event.type === "session.compaction.ended" || event.type === "session.compaction.failed") {
    keys.push(openCodeKeys.sessionContext(connectionID, event.data.sessionID));
  }
  if (
    event.type === "session.revert.staged" ||
    event.type === "session.revert.cleared" ||
    event.type === "session.revert.committed"
  ) {
    keys.push(openCodeKeys.session(connectionID, event.data.sessionID));
    keys.push(
      event.location
        ? openCodeKeys.diffsLocation(connectionID, event.location)
        : openCodeKeys.diffs(connectionID),
    );
    if (event.type === "session.revert.committed") {
      keys.push(openCodeKeys.transcript(connectionID, event.data.sessionID));
      keys.push(openCodeKeys.promptIndex(connectionID, event.data.sessionID));
    }
  }
  if (event.type === "worktree.updated" || event.type === "worktree.resolved") {
    keys.push(openCodeKeys.worktrees(connectionID, event.data.projectID));
    keys.push(openCodeKeys.projects(connectionID));
  }
  if (event.type === "project.updated") {
    keys.push(openCodeKeys.projects(connectionID));
  }
  return keys;
}
