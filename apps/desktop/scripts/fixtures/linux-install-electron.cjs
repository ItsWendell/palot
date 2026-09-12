const { app, BrowserWindow } = require("electron");
const { appendFileSync, writeFileSync } = require("node:fs");
const path = require("node:path");

const root = process.env.PALOT_INSTALL_FIXTURE_ROOT;
app.setPath("userData", path.join(root, "user-data"));
app.setPath("crashDumps", path.join(root, "crashes"));
const record = (event) =>
  appendFileSync(path.join(root, "events.jsonl"), `${JSON.stringify({ event, at: Date.now() })}\n`);
let quitting = false;
process.on("SIGTERM", () => app.quit());
app.on("before-quit", (event) => {
  record("before-quit");
  if (quitting) return;
  quitting = true;
  event.preventDefault();
  setTimeout(() => {
    record("cleanup-complete");
    app.quit();
  }, 1_000);
});
app.on("will-quit", () => record("will-quit"));
app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false });
  await window.loadURL("data:text/html,<title>Isolated install lifecycle</title>");
  writeFileSync(path.join(root, "ready"), String(process.pid));
});
