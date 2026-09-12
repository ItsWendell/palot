/** Restarts Palot through the active development or packaged adapter. */

import { app } from "electron";

export async function requestAppRestart(reason: string): Promise<void> {
  if (app.isPackaged) {
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
