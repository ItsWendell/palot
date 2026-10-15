import { app, BrowserWindow } from "electron";
import log from "electron-log/main";
import {
  PROJECT_SCRIPTS_IPC_CHANNELS,
  type ProjectScriptRun,
} from "../../shared/project-scripts-contract";
import { palotDatabase } from "../database/client";
import { classifyOpenCodeProfile } from "../opencode-connections/capabilities";
import { openCodeRuntime } from "../opencode-runtime";
import { onSessionSettled } from "../session-triage-store";
import { ProjectScriptRepository } from "./repository";
import { runScriptProcess } from "./runner";
import { ProjectScriptsService, type SettledTask } from "./service";

const REQUEST_TIMEOUT_MS = 30_000;
const projectScriptsLog = log.scope("project-scripts");

function isLocalProfile(profileID: string): boolean | null {
  const profile = openCodeRuntime
    .profileSnapshot()
    .profiles.find((candidate) => candidate.id === profileID);
  return profile ? classifyOpenCodeProfile(profile).capabilities.localPathActions : null;
}

/**
 * Reads the task and its candidate projects from the task's own server; never from the
 * renderer. The directory's project comes first: it is the project Palot shows the task
 * under, and so the one people configure scripts for.
 */
async function resolveTask(profileID: string, sessionID: string): Promise<SettledTask> {
  const runtime = openCodeRuntime
    .listRuntimes()
    .find((candidate) => candidate.profileID === profileID && candidate.connected);
  if (!runtime) throw new Error("The task's OpenCode server is not connected.");
  return openCodeRuntime.scopedConnection(runtime.connectionID).withClient(async (client) => {
    const signal = () => AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    const session = await client.session.get({ sessionID }, { signal: signal() });
    const directory = session.location.directory;
    const [located, projects] = await Promise.all([
      client.location
        .get({ location: { directory } }, { signal: signal() })
        .then((location) => location.project.id)
        .catch(() => null),
      client.project.list({}, { signal: signal() }),
    ]);
    return {
      directory,
      projects: [...new Set([located, session.projectID])].flatMap((id) => {
        const project = projects.find((candidate) => candidate.id === id);
        return project
          ? [{ id: project.id, canonical: project.canonical, sandboxes: project.sandboxes }]
          : [];
      }),
    };
  });
}

function emit(run: ProjectScriptRun): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed())
      window.webContents.send(PROJECT_SCRIPTS_IPC_CHANNELS.projectScriptRunFinished, run);
  }
}

let service: ProjectScriptsService | null = null;
let started = false;

export function projectScriptsService(): ProjectScriptsService {
  return (service ??= new ProjectScriptsService({
    repository: new ProjectScriptRepository(palotDatabase()),
    isLocalProfile,
    resolveTask,
    runProcess: runScriptProcess,
    emit,
    log: projectScriptsLog,
  }));
}

/** Run settle scripts for settlements from every source, and stop them when Palot quits. */
export function startProjectScripts(): void {
  if (started) return;
  started = true;
  onSessionSettled((event) => {
    void projectScriptsService()
      .handleSettled(event)
      .catch((error) => projectScriptsLog.warn("Project scripts failed after settling", error));
  });
  app.once("will-quit", () => service?.stop());
}
