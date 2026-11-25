/** Restarts Palot through the active development or packaged adapter. */

import { app } from "electron";
import log from "electron-log/main";

const BEFORE_RESTART_DEADLINE_MS = 5_000;
type RestartTask = () => unknown;
const beforeRestart = new Set<RestartTask>();

/**
 * Registers cleanup for the packaged restart path. `app.exit()` skips `before-quit`, so the
 * orderly shutdown in `index.ts` never runs there.
 */
export function onBeforeRestart(task: RestartTask): () => void {
  beforeRestart.add(task);
  return () => beforeRestart.delete(task);
}

async function runBeforeRestart() {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<void>((resolve) => {
    timer = setTimeout(() => {
      log.warn("Restart cleanup did not finish before the deadline");
      resolve();
    }, BEFORE_RESTART_DEADLINE_MS);
  });
  const tasks = [...beforeRestart].map(async (task) => {
    try {
      await task();
    } catch (error) {
      log.warn("Restart cleanup failed", error);
    }
  });
  await Promise.race([Promise.all(tasks), deadline]);
  clearTimeout(timer);
}

export async function requestAppRestart(reason: string): Promise<void> {
  if (app.isPackaged) {
    await runBeforeRestart();
    app.relaunch();
    setTimeout(() => app.exit(0), 100);
    return;
  }

  const url = process.env.PALOT_DEV_CONTROL_URL;
  const token = process.env.PALOT_DEV_CONTROL_TOKEN;
  if (!url || !token) throw new Error("The Palot development supervisor is unavailable.");
  const response = await fetch(new URL("/restart", url), {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ reason }),
    signal: AbortSignal.timeout(3_000),
  });
  if (!response.ok)
    throw new Error(`The Palot development supervisor returned ${response.status}.`);
}
