/**
 * Project scripts: shell commands a person configures per project that Palot runs on this
 * computer in a task's directory. Only local connections run them; nothing runs unless a
 * script was saved here first. OpenCode's own worktree startup command stays separate.
 */

export const PROJECT_SCRIPTS_IPC_CHANNELS = {
  projectScriptsLoad: "palot:project-scripts:load",
  projectScriptsSave: "palot:project-scripts:save",
  projectScriptsRemove: "palot:project-scripts:remove",
  /** Main → renderer: one script run finished (passed, failed, timed out, or could not start). */
  projectScriptRunFinished: "palot:project-scripts:run-finished",
} as const;

export const PROJECT_SCRIPT_LIMITS = {
  name: 80,
  command: 4_000,
  scriptsPerProject: 20,
  /** Captured output keeps the last this-many characters. */
  outputCharacters: 64_000,
  minTimeoutSeconds: 5,
  maxTimeoutSeconds: 3_600,
  defaultTimeoutSeconds: 600,
} as const;

export interface ProjectScript {
  id: string;
  name: string;
  /** Run through the user's shell, exactly as shown in settings. */
  command: string;
  /** Run in the task's directory each time a task in this project settles. */
  runOnSettle: boolean;
  timeoutSeconds: number;
  createdAt: number;
  updatedAt: number;
}

export interface ProjectScriptsTarget {
  profileID: string;
  projectID: string;
}

export type ProjectScriptsAvailability = { supported: true } | { supported: false; reason: string };

export interface ProjectScriptsState extends ProjectScriptsTarget {
  scripts: ProjectScript[];
  availability: ProjectScriptsAvailability;
}

export interface ProjectScriptDraft {
  /** Absent to add a script; an existing ID replaces that script. */
  id?: string;
  name: string;
  command: string;
  runOnSettle: boolean;
  timeoutSeconds: number;
}

export interface SaveProjectScriptInput extends ProjectScriptsTarget {
  script: ProjectScriptDraft;
}

export interface RemoveProjectScriptInput extends ProjectScriptsTarget {
  scriptID: string;
}

export type ProjectScriptRunStatus = "passed" | "failed" | "timed-out" | "error";

export interface ProjectScriptRun {
  id: string;
  trigger: "settle";
  profileID: string;
  projectID: string;
  sessionID: string;
  scriptID: string;
  scriptName: string;
  command: string;
  /** The validated working directory, or null when the task's directory was rejected. */
  directory: string | null;
  startedAt: number;
  finishedAt: number;
  status: ProjectScriptRunStatus;
  exitCode: number | null;
  signal: string | null;
  /** Combined stdout and stderr, keeping the tail when it exceeds the limit. */
  output: string;
  outputTruncated: boolean;
  /** Why the script could not run or was stopped. */
  error: string | null;
}

export interface PalotProjectScriptsApi {
  load(target: ProjectScriptsTarget): Promise<ProjectScriptsState>;
  save(input: SaveProjectScriptInput): Promise<ProjectScriptsState>;
  remove(input: RemoveProjectScriptInput): Promise<ProjectScriptsState>;
  onRunFinished(listener: (run: ProjectScriptRun) => void): () => void;
}
