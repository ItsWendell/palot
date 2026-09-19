import type { QueryKey } from "@tanstack/react-query";
import type { PalotEvent, PalotMessage } from "../../shared";
import { openCodeKeys } from "./opencode-query";

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

export function openCodeInvalidationKeys(connectionID: string, event: PalotEvent): QueryKey[] {
  // Reload evicts location-owned registries and sessions can move across locations.
  // Re-read the connection rather than retaining projections of an evicted location.
  if (event.type === "location.shutdown") return [openCodeKeys.all(connectionID)];
  const keys: QueryKey[] = [];
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
    keys.push(
      event.location
        ? openCodeKeys.fileSearchLocation(connectionID, event.location)
        : openCodeKeys.fileSearches(connectionID),
    );
    keys.push(
      event.location
        ? openCodeKeys.fileLocation(connectionID, event.location)
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
    keys.push(
      event.location
        ? openCodeKeys.runningShells(connectionID, event.location)
        : openCodeKeys.runningShellsRoot(connectionID),
    );
  }
  if (event.type === "session.forked") {
    keys.push(openCodeKeys.childSessions(connectionID, event.data.parentID));
    keys.push(openCodeKeys.session(connectionID, event.data.sessionID));
    keys.push(openCodeKeys.transcript(connectionID, event.data.sessionID));
    keys.push(openCodeKeys.sessionActivity(connectionID));
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
