import { randomUUID } from "node:crypto";
import {
  PROJECT_SCRIPT_LIMITS,
  type ProjectScript,
  type ProjectScriptRun,
  type ProjectScriptsAvailability,
  type ProjectScriptsState,
  type ProjectScriptsTarget,
  type RemoveProjectScriptInput,
  type SaveProjectScriptInput,
} from "../../shared/project-scripts-contract";
import { SESSION_TRIAGE_BATCH_LIMIT } from "../../shared/session-triage-contract";
import type { SessionSettledEvent } from "../session-triage-store";
import { isWorktreeDirectory, resolveScriptDirectory, type ProjectRoots } from "./directory";
import { ProjectScriptError, type ProjectScriptRepository } from "./repository";
import type { ScriptProcessInput, ScriptProcessResult } from "./runner";

export interface TaskProject extends ProjectRoots {
  id: string;
}

/** What main knows about a settled task, read from its own OpenCode server. */
export interface SettledTask {
  directory: string;
  /**
   * Projects whose scripts may apply, most specific first: the project OpenCode resolves for
   * the task's directory (the one Palot shows the task under), then the session's own
   * project. They can differ, e.g. for a nested repository. The first with settle scripts wins.
   */
  projects: TaskProject[];
}

export interface ProjectScriptsServiceOptions {
  repository: ProjectScriptRepository;
  /** Local profiles only; `null` for an unknown profile. */
  isLocalProfile(profileID: string): boolean | null;
  resolveTask(profileID: string, sessionID: string): Promise<SettledTask>;
  runProcess(input: ScriptProcessInput): Promise<ScriptProcessResult>;
  emit(run: ProjectScriptRun): void;
  log: Pick<Console, "info" | "warn">;
  now?: () => number;
  createID?: () => string;
}

/** Settlements remembered to keep a replayed settle from running scripts twice. */
const REMEMBERED_SETTLEMENTS = 500;
/**
 * Batch directories remembered so one batch runs a project's scripts once per directory.
 * Holds two full batches, so a running batch never forgets its own directories.
 */
const REMEMBERED_BATCH_DIRECTORIES = 2 * SESSION_TRIAGE_BATCH_LIMIT;

export class ProjectScriptsService {
  private readonly now: () => number;
  private readonly createID: () => string;
  private readonly lastSettlement = new Map<string, string>();
  private readonly running = new Set<string>();
  private readonly batchDirectories = new Set<string>();
  private readonly stopController = new AbortController();

  constructor(private readonly options: ProjectScriptsServiceOptions) {
    this.now = options.now ?? Date.now;
    this.createID = options.createID ?? randomUUID;
  }

  load(target: ProjectScriptsTarget): ProjectScriptsState {
    return this.state(target, this.options.repository.list(target));
  }

  save(input: SaveProjectScriptInput): ProjectScriptsState {
    const target = { profileID: input.profileID, projectID: input.projectID };
    this.assertSupported(target.profileID);
    return this.state(target, this.options.repository.save(target, input.script, this.now()));
  }

  remove(input: RemoveProjectScriptInput): ProjectScriptsState {
    const target = { profileID: input.profileID, projectID: input.projectID };
    return this.state(target, this.options.repository.remove(target, input.scriptID));
  }

  /**
   * Run the project's settle scripts once per settlement, in the task's own directory.
   * A batch (bulk or automatic settle) runs them only in worktrees, never the project's main
   * checkout, and once per directory, and skips rejected directories without a notice.
   * Resolves after every script finished; callers do not need to wait.
   */
  async handleSettled(event: SessionSettledEvent): Promise<void> {
    const { profileID, sessionID } = event;
    const skip = (reason: string) =>
      this.options.log.info(`Settle scripts skipped for ${sessionID} on ${profileID}: ${reason}`);
    if (this.stopController.signal.aborted) return skip("Palot is quitting");
    const availability = this.availability(profileID);
    if (availability.supported !== true) return skip(availability.reason);
    if (!this.options.repository.hasSettleScripts(profileID))
      return skip("no settle scripts on this connection");
    const key = `${profileID}\0${sessionID}`;
    const settlement = `${event.through.updatedAt}\0${event.through.sessionID}`;
    if (this.lastSettlement.get(key) === settlement) return skip("already ran for this settlement");
    if (this.running.has(key)) return skip("scripts are still running for this task");
    this.running.add(key);
    try {
      let task: SettledTask;
      try {
        task = await this.options.resolveTask(profileID, sessionID);
      } catch (error) {
        // Not remembered, so the next settle of this task tries again.
        this.options.log.warn("Could not read a settled task for its project scripts", error);
        return;
      }
      this.remember(key, settlement);
      const match = task.projects
        .map((project) => ({
          project,
          scripts: this.options.repository
            .list({ profileID, projectID: project.id })
            .filter((script) => script.runOnSettle),
        }))
        .find((candidate) => candidate.scripts.length > 0);
      if (!match)
        return skip(
          `no settle scripts for project ${task.projects.map((project) => project.id).join(" or ") || "(none)"}`,
        );
      const { project, scripts } = match;
      let directory: string | null = null;
      let rejection: string | null = null;
      try {
        directory = await resolveScriptDirectory(task.directory, project);
      } catch (error) {
        rejection = error instanceof Error ? error.message : "The task's directory was rejected.";
      }
      if (event.batch) {
        if (directory === null) return skip(`batch settle: ${rejection}`);
        if (!(await isWorktreeDirectory(directory, project)))
          return skip("batch settles run scripts only in worktrees");
        const batchKey = `${event.batch.id}\0${project.id}\0${directory}`;
        if (this.batchDirectories.has(batchKey))
          return skip("already ran in this directory for this batch");
        this.rememberBatchDirectory(batchKey);
      }
      for (const script of scripts) {
        if (this.stopController.signal.aborted) return;
        const startedAt = this.now();
        const base = {
          id: this.createID(),
          trigger: "settle" as const,
          profileID,
          projectID: project.id,
          sessionID,
          scriptID: script.id,
          scriptName: script.name,
          command: script.command,
          directory,
          startedAt,
        };
        if (directory === null) {
          skip(`"${script.name}" not run: ${rejection}`);
          this.options.emit({
            ...base,
            finishedAt: startedAt,
            status: "error",
            exitCode: null,
            signal: null,
            output: "",
            outputTruncated: false,
            error: rejection,
          });
          continue;
        }
        this.options.log.info(
          `Running settle script "${script.name}" for ${sessionID} in ${directory}`,
        );
        const result = await this.options.runProcess({
          command: script.command,
          cwd: directory,
          timeoutMs: script.timeoutSeconds * 1_000,
          outputLimit: PROJECT_SCRIPT_LIMITS.outputCharacters,
          env: scriptEnvironment(script, profileID, sessionID, project.id, directory),
          signal: this.stopController.signal,
        });
        this.options.log.info(
          `Project script "${script.name}" for ${sessionID} finished: ${result.status}`,
        );
        this.options.emit({ ...base, ...result, finishedAt: this.now() });
      }
    } finally {
      this.running.delete(key);
    }
  }

  /** Stop running scripts, e.g. when Palot quits. */
  stop(): void {
    this.stopController.abort();
  }

  private remember(key: string, settlement: string) {
    this.lastSettlement.delete(key);
    this.lastSettlement.set(key, settlement);
    if (this.lastSettlement.size > REMEMBERED_SETTLEMENTS) {
      const oldest = this.lastSettlement.keys().next().value;
      if (oldest !== undefined) this.lastSettlement.delete(oldest);
    }
  }

  private rememberBatchDirectory(key: string) {
    this.batchDirectories.add(key);
    if (this.batchDirectories.size > REMEMBERED_BATCH_DIRECTORIES) {
      const oldest = this.batchDirectories.values().next().value;
      if (oldest !== undefined) this.batchDirectories.delete(oldest);
    }
  }

  private availability(profileID: string): ProjectScriptsAvailability {
    const local = this.options.isLocalProfile(profileID);
    if (local === null) return { supported: false, reason: "This connection is no longer saved." };
    if (!local)
      return {
        supported: false,
        reason:
          "Scripts run on this computer, so they are only available for local OpenCode connections.",
      };
    return { supported: true };
  }

  private assertSupported(profileID: string) {
    const availability = this.availability(profileID);
    if (availability.supported !== true) throw new ProjectScriptError(availability.reason);
  }

  private state(target: ProjectScriptsTarget, scripts: ProjectScript[]): ProjectScriptsState {
    return { ...target, scripts, availability: this.availability(target.profileID) };
  }
}

function scriptEnvironment(
  script: ProjectScript,
  profileID: string,
  sessionID: string,
  projectID: string,
  directory: string,
): Record<string, string> {
  return {
    PALOT_SCRIPT_NAME: script.name,
    PALOT_SCRIPT_TRIGGER: "settle",
    PALOT_PROFILE_ID: profileID,
    PALOT_PROJECT_ID: projectID,
    PALOT_TASK_ID: sessionID,
    PALOT_TASK_DIRECTORY: directory,
  };
}
