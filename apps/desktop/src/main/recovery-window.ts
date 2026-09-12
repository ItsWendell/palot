import { BrowserWindow, dialog } from "electron";
import log from "electron-log/main";
import { closePalotDatabase } from "./database/client";
import {
  exportSupportBundle,
  hasDatabaseBackup,
  palotDataLocations,
  removePalotOwnedData,
  resetPalotSettings,
  restoreLatestDatabaseBackup,
  revealPalotDataFolder,
  revealPalotLogsFolder,
} from "./data-recovery";
import { requestAppRestart } from "./app-restart";
import { redactLogValue } from "./logging";

let recoveryWindow: BrowserWindow | null = null;
let recoveryFailure: unknown;
let actionRunning = false;

export async function showRecoveryWindow(failure: unknown): Promise<BrowserWindow> {
  recoveryFailure = failure;
  log.error("Palot startup failed", failure);
  if (recoveryWindow && !recoveryWindow.isDestroyed()) {
    recoveryWindow.show();
    recoveryWindow.focus();
    return recoveryWindow;
  }

  const window = new BrowserWindow({
    title: "Palot Recovery",
    width: 760,
    height: 720,
    minWidth: 640,
    minHeight: 560,
    show: false,
    backgroundColor: "#111214",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  recoveryWindow = window;
  window.on("closed", () => {
    if (recoveryWindow === window) recoveryWindow = null;
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith("palot-recovery:")) {
      event.preventDefault();
      return;
    }
    event.preventDefault();
    if (!actionRunning) void runRecoveryAction(new URL(url).pathname.replace(/^\//, ""), window);
  });
  window.once("ready-to-show", () => window.show());
  await loadRecoveryPage(window);
  return window;
}

async function loadRecoveryPage(window: BrowserWindow, notice?: string): Promise<void> {
  const locations = palotDataLocations();
  const failure = String(
    redactLogValue(
      recoveryFailure instanceof Error ? recoveryFailure.message : String(recoveryFailure),
    ),
  );
  const backupAvailable = hasDatabaseBackup(locations);
  await window.loadURL(
    `data:text/html;charset=utf-8,${encodeURIComponent(recoveryHtml({ failure, notice, backupAvailable, locations }))}`,
  );
}

async function runRecoveryAction(action: string, window: BrowserWindow): Promise<void> {
  actionRunning = true;
  try {
    if (action === "retry") {
      await requestAppRestart("Retry requested from startup recovery");
      return;
    }
    if (action === "reveal-data") await revealPalotDataFolder();
    else if (action === "reveal-logs") await revealPalotLogsFolder();
    else if (action === "support") {
      const file = await exportSupportBundle(recoveryFailure);
      if (file) await loadRecoveryPage(window, "Support bundle exported.");
    } else if (action === "restore") {
      if (
        !(await confirm(
          window,
          "Restore the latest database backup?",
          "Palot will replace its task triage and automation database, then restart. OpenCode sessions and configuration are not changed.",
          "Restore backup",
        ))
      )
        return;
      closePalotDatabase();
      await restoreLatestDatabaseBackup();
      await requestAppRestart("Restored Palot database backup");
    } else if (action === "reset-settings") {
      if (
        !(await confirm(
          window,
          "Reset Palot settings?",
          "This clears Palot preferences and local UI state. Saved OpenCode server profiles and encrypted server credentials are preserved.",
          "Reset settings",
        ))
      )
        return;
      await resetPalotSettings();
      await requestAppRestart("Reset Palot settings from startup recovery");
    } else if (action === "delete-data") {
      if (
        !(await confirm(
          window,
          "Remove all Palot-owned data?",
          "This permanently removes Palot's database, settings, local UI state, logs, temporary attachments, server profiles, and encrypted server credentials. OpenCode sessions, auth, configuration, and service data are not deleted.",
          "Remove Palot data",
        ))
      )
        return;
      closePalotDatabase();
      await removePalotOwnedData();
      await requestAppRestart("Removed Palot-owned data from startup recovery");
    }
  } catch (error) {
    log.error("Palot recovery action failed", { action, error });
    await loadRecoveryPage(
      window,
      error instanceof Error ? `Action failed: ${error.message}` : "The recovery action failed.",
    );
  } finally {
    actionRunning = false;
  }
}

async function confirm(
  window: BrowserWindow,
  message: string,
  detail: string,
  confirmLabel: string,
): Promise<boolean> {
  const result = await dialog.showMessageBox(window, {
    type: "warning",
    message,
    detail,
    buttons: ["Cancel", confirmLabel],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  });
  return result.response === 1;
}

function recoveryHtml({
  failure,
  notice,
  backupAvailable,
  locations,
}: {
  failure: string;
  notice?: string;
  backupAvailable: boolean;
  locations: ReturnType<typeof palotDataLocations>;
}): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; navigate-to palot-recovery:">
<title>Palot Recovery</title><style>
:root{color-scheme:dark;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#111214;color:#f4f4f5}body{margin:0;padding:40px}main{max-width:680px;margin:auto}h1{font-size:28px;margin:0 0 8px}h2{font-size:14px;margin:28px 0 10px;color:#d4d4d8}p{color:#a1a1aa;line-height:1.5}.error,.notice,.boundary{border:1px solid #3f3f46;background:#18181b;border-radius:10px;padding:14px}.error{font-family:ui-monospace,SFMono-Regular,monospace;font-size:12px;color:#fca5a5;overflow-wrap:anywhere}.notice{color:#bbf7d0;border-color:#166534}.actions{display:grid;grid-template-columns:1fr 1fr;gap:10px}.button{display:block;padding:11px 13px;border:1px solid #52525b;border-radius:8px;color:#fafafa;text-decoration:none;background:#27272a;font-size:13px;font-weight:600}.button:hover{background:#3f3f46}.button.primary{background:#f4f4f5;color:#18181b}.button.danger{border-color:#7f1d1d;color:#fecaca}.button.disabled{pointer-events:none;opacity:.45}.locations{font:12px ui-monospace,SFMono-Regular,monospace;color:#a1a1aa;overflow-wrap:anywhere}.boundary strong{color:#f4f4f5}@media(max-width:640px){body{padding:24px}.actions{grid-template-columns:1fr}}
</style></head><body><main>
<h1>Palot could not start</h1><p>Your OpenCode data has not been changed. Use the options below to recover Palot's own local state.</p>
${notice ? `<div class="notice">${escapeHtml(notice)}</div>` : ""}
<div class="error">${escapeHtml(failure)}</div>
<h2>Recovery</h2><div class="actions">
<a class="button primary" href="palot-recovery:retry">Retry startup</a>
<a class="button" href="palot-recovery:reveal-data">Reveal Palot data folder</a>
<a class="button ${backupAvailable ? "" : "disabled"}" href="palot-recovery:restore">Restore latest database backup</a>
<a class="button" href="palot-recovery:reset-settings">Reset Palot settings</a>
<a class="button" href="palot-recovery:support">Export redacted support bundle</a>
<a class="button" href="palot-recovery:reveal-logs">Reveal logs folder</a>
</div>
<h2>Locations</h2><p class="locations">Data: ${escapeHtml(locations.data)}<br>Logs: ${escapeHtml(locations.logs)}<br>Backups: ${escapeHtml(locations.backups)}</p>
<div class="boundary"><strong>OpenCode ownership boundary</strong><p>Reset and removal actions only target Palot's application data. They do not delete OpenCode sessions, provider auth, configuration, projects, worktrees, or service storage.</p></div>
<h2>Start over</h2><a class="button danger" href="palot-recovery:delete-data">Remove all Palot-owned data</a>
</main></body></html>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
