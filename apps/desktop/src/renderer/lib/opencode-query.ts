import type { LocationRef } from "@opencode/client";
import type { SettingsLocationInput } from "../../shared";

export const openCodeKeys = {
  all: (connectionID: string) => ["opencode", connectionID] as const,
  composerCatalogs: (connectionID: string) =>
    [...openCodeKeys.all(connectionID), "composer-catalog"] as const,
  composerCatalog: (connectionID: string, location: LocationRef) =>
    [
      ...openCodeKeys.composerCatalogs(connectionID),
      location.directory,
      location.workspaceID ?? "",
    ] as const,
  diffs: (connectionID: string) => [...openCodeKeys.all(connectionID), "diffs"] as const,
  diffsLocation: (connectionID: string, location: LocationRef) =>
    [...openCodeKeys.diffs(connectionID), location.directory, location.workspaceID ?? ""] as const,
  locationDiffs: (connectionID: string, location: LocationRef, mode: "working" | "branch") =>
    [...openCodeKeys.diffsLocation(connectionID, location), mode] as const,
  workingDiffs: (connectionID: string, location: LocationRef) =>
    openCodeKeys.locationDiffs(connectionID, location, "working"),
  sessionDiffs: (connectionID: string, sessionID: string, location: LocationRef) =>
    [...openCodeKeys.workingDiffs(connectionID, location), sessionID] as const,
  fileSearches: (connectionID: string) =>
    [...openCodeKeys.all(connectionID), "file-search"] as const,
  fileSearchLocation: (connectionID: string, location: LocationRef) =>
    [
      ...openCodeKeys.fileSearches(connectionID),
      location.directory,
      location.workspaceID ?? "",
    ] as const,
  fileSearch: (connectionID: string, location: LocationRef, query: string) =>
    [...openCodeKeys.fileSearchLocation(connectionID, location), query] as const,
  files: (connectionID: string) => [...openCodeKeys.all(connectionID), "files"] as const,
  fileLocation: (connectionID: string, location: LocationRef) =>
    [...openCodeKeys.files(connectionID), location.directory, location.workspaceID ?? ""] as const,
  file: (connectionID: string, location: LocationRef, path: string) =>
    [...openCodeKeys.fileLocation(connectionID, location), path] as const,
  fileDirectory: (connectionID: string, location: LocationRef, path: string) =>
    [...openCodeKeys.fileLocation(connectionID, location), "directory", path] as const,
  models: (connectionID: string) => [...openCodeKeys.all(connectionID), "models"] as const,
  modelsLocation: (connectionID: string, location: LocationRef) =>
    [...openCodeKeys.models(connectionID), location.directory, location.workspaceID ?? ""] as const,
  search: (connectionID: string, query: string) =>
    [...openCodeKeys.all(connectionID), "session-search", query] as const,
  requests: (connectionID: string) => [...openCodeKeys.all(connectionID), "requests"] as const,
  sessionRequests: (connectionID: string, sessionID: string) =>
    [...openCodeKeys.requests(connectionID), sessionID] as const,
  projects: (connectionID: string) => [...openCodeKeys.all(connectionID), "projects"] as const,
  sessions: (connectionID: string) => [...openCodeKeys.all(connectionID), "sessions"] as const,
  rootSessions: (connectionID: string) =>
    [...openCodeKeys.sessions(connectionID), "roots"] as const,
  sessionActivity: (connectionID: string) =>
    [...openCodeKeys.sessions(connectionID), "activity"] as const,
  sessionStatsRoot: (connectionID: string) =>
    [...openCodeKeys.sessions(connectionID), "stats"] as const,
  sessionStats: (
    connectionID: string,
    input: {
      timezone: string;
      from: number;
      to: number;
      tools: "none" | "summary" | "detail";
      project?: string;
    },
  ) =>
    [
      ...openCodeKeys.sessionStatsRoot(connectionID),
      input.timezone,
      input.from,
      input.to,
      input.tools,
      input.project ?? "",
    ] as const,
  runningShellsRoot: (connectionID: string) =>
    [...openCodeKeys.sessions(connectionID), "running-shells"] as const,
  runningShells: (connectionID: string, location: LocationRef) =>
    [
      ...openCodeKeys.runningShellsRoot(connectionID),
      location.directory,
      location.workspaceID ?? "",
    ] as const,
  session: (connectionID: string, sessionID: string) =>
    [...openCodeKeys.sessions(connectionID), "detail", sessionID] as const,
  sessionContext: (connectionID: string, sessionID: string) =>
    [...openCodeKeys.session(connectionID, sessionID), "context"] as const,
  sessionInstructionEntries: (connectionID: string, sessionID: string) =>
    [...openCodeKeys.session(connectionID, sessionID), "instruction-entries"] as const,
  childSessions: (connectionID: string, parentID: string) =>
    [...openCodeKeys.sessions(connectionID), "children", parentID] as const,
  settings: (connectionID: string) => [...openCodeKeys.all(connectionID), "settings"] as const,
  settingsLocation: (connectionID: string, location: LocationRef) =>
    [
      ...openCodeKeys.settings(connectionID),
      location.directory,
      location.workspaceID ?? "",
    ] as const,
  settingsSnapshot: (connectionID: string, input: SettingsLocationInput) =>
    [
      ...openCodeKeys.settingsLocation(connectionID, input),
      input.projectID,
      ...(input.capabilities ?? ["all"]),
    ] as const,
  transcripts: (connectionID: string) =>
    [...openCodeKeys.all(connectionID), "transcripts"] as const,
  promptIndexes: (connectionID: string) =>
    [...openCodeKeys.all(connectionID), "prompt-index"] as const,
  promptIndex: (connectionID: string, sessionID: string) =>
    [...openCodeKeys.promptIndexes(connectionID), sessionID] as const,
  transcript: (connectionID: string, sessionID: string) =>
    [...openCodeKeys.transcripts(connectionID), sessionID] as const,
  vcs: (connectionID: string) => [...openCodeKeys.all(connectionID), "vcs"] as const,
  vcsLocation: (connectionID: string, location: LocationRef) =>
    [...openCodeKeys.vcs(connectionID), location.directory, location.workspaceID ?? ""] as const,
  vcsStatus: (connectionID: string, location: LocationRef) =>
    [...openCodeKeys.vcsLocation(connectionID, location), "status"] as const,
  vcsBase: (connectionID: string, location: LocationRef) =>
    [...openCodeKeys.vcsLocation(connectionID, location), "base"] as const,
  vcsBranches: (connectionID: string, location: LocationRef) =>
    [...openCodeKeys.vcsLocation(connectionID, location), "branches"] as const,
  vcsBranchSearch: (connectionID: string, location: LocationRef, search: string) =>
    [...openCodeKeys.vcsBranches(connectionID, location), search] as const,
  worktrees: (connectionID: string, projectID: string) =>
    [...openCodeKeys.all(connectionID), "worktrees", projectID] as const,
};

export function locationKey(location: LocationRef): string {
  return `${location.directory}\u0000${location.workspaceID ?? ""}`;
}
