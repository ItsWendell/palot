import type { QueryKey } from "@tanstack/react-query";
import type { PalotEvent } from "../../shared";
import { openCodeKeys } from "./opencode-query";

const MODEL_CATALOG_EVENTS = new Set<PalotEvent["type"]>([
  "models-dev.refreshed",
  "catalog.updated",
  "integration.updated",
  "credential.switched",
]);

const SETTINGS_EVENTS = new Set<PalotEvent["type"]>([
  "config.updated",
  "agent.updated",
  "integration.updated",
  "credential.updated",
  "credential.switched",
  "catalog.updated",
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

export function openCodeInvalidationKeys(connectionID: string, event: PalotEvent): QueryKey[] {
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
