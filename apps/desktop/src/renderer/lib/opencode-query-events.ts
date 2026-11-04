import type { QueryClient, QueryKey } from "@tanstack/react-query";
import type { PalotEvent, PalotMessage } from "../../shared";
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
    keys.push(
      event.location
        ? [...openCodeKeys.files(connectionID), event.location.directory]
        : openCodeKeys.files(connectionID),
    );
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
