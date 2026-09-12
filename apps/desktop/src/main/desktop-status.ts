import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { TrayTaskSections } from "./tray-menu";

/** Optional presentation-only snapshot for shell widgets. OpenCode owns all task state. */
export class DesktopStatus {
  private pending = Promise.resolve();
  private readonly file: string | null;

  constructor(appID: string) {
    this.file =
      process.env.PALOT_OMARCHY_STATUS === "1" && process.env.XDG_RUNTIME_DIR
        ? path.join(process.env.XDG_RUNTIME_DIR, "palot", `${appID}.json`)
        : null;
  }

  publish(sections: TrayTaskSections): void {
    if (!this.file) return;
    const file = this.file;
    const snapshot = JSON.stringify({
      version: 1,
      pid: process.pid,
      updatedAt: Date.now(),
      running: sections.running.length,
      attention: sections.attention.length,
      tasks: [...sections.attention, ...sections.running].map((item) => ({
        sessionID: item.sessionID,
        title: item.title,
        detail: item.detail,
      })),
    });
    this.pending = this.pending
      .then(async () => {
        await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
        const temporary = `${file}.${process.pid}.tmp`;
        await writeFile(temporary, snapshot, { mode: 0o600 });
        await rename(temporary, file);
      })
      .catch((error) => console.warn("[desktop-status] Could not publish task status", error));
  }

  async dispose(): Promise<void> {
    await this.pending;
    if (this.file) await rm(this.file, { force: true });
  }
}
