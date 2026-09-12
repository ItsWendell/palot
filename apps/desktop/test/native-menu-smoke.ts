// Bundle with `bun build --target=node --external=electron --format=cjs` and run
// with the pinned Electron binary, not Bun. No OpenCode service or user data.
import assert from "node:assert/strict";
import { once } from "node:events";
import { isAbsolute } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { app, BrowserWindow, Menu, screen } from "electron";
import { popupNativeContextMenu } from "../src/main/native-menu-popup";

const dataRoot = process.env.PALOT_MENU_SMOKE_DATA;
assert(dataRoot && isAbsolute(dataRoot), "PALOT_MENU_SMOKE_DATA must be an isolated absolute path");
app.setPath("userData", dataRoot);
const watchdog = setTimeout(() => app.exit(2), 20_000);

async function run() {
  await app.whenReady();
  const window = new BrowserWindow({ width: 600, height: 420, show: false });
  await window.loadURL(
    "data:text/html,<textarea style='width:300px;height:100px'>Native menu regression</textarea>",
  );
  window.showInactive();

  // Use a genuine Chromium context-menu event, not a fabricated frontend event.
  const context = once(window.webContents, "context-menu");
  window.webContents.sendInputEvent({
    type: "mouseDown",
    x: 40,
    y: 40,
    button: "right",
    clickCount: 1,
  });
  window.webContents.sendInputEvent({
    type: "mouseUp",
    x: 40,
    y: 40,
    button: "right",
    clickCount: 1,
  });
  const [, params] = (await context) as [Electron.Event, Electron.ContextMenuParams];
  assert.equal(params.isEditable, true);

  const menu = Menu.buildFromTemplate([{ role: "copy" }, { role: "paste" }]);
  let shows = 0;
  menu.on("menu-will-show", () => shows++);
  const nearestDisplay = screen.getDisplayNearestPoint.bind(screen);
  const display = screen.getAllDisplays()[0]!;
  if (process.platform === "linux") {
    assert.equal(popupNativeContextMenu(menu, window, { ...params, x: -1 }), false);
    assert.equal(popupNativeContextMenu(menu, window, { ...params, y: -1 }), false);
    assert.equal(shows, 0);
    // Fault injection is limited to the guard's public screen query. No native
    // menu should be entered with the exact empty rectangle found in the core.
    screen.getDisplayNearestPoint = () => ({
      ...display,
      bounds: { x: 449, y: 214, width: 0, height: 0 },
      workArea: { x: 449, y: 214, width: 0, height: 0 },
    });
    try {
      assert.equal(popupNativeContextMenu(menu, window, params), false);
      assert.equal(shows, 0);
    } finally {
      screen.getDisplayNearestPoint = nearestDisplay;
    }
  }

  // Restore actual host geometry. Exercise reopening/dismissal, including keyboard
  // source semantics. Returning from popup alone does not prove native dismissal.
  for (const source of [params.menuSourceType, "keyboard"] as const) {
    const closed = once(menu, "menu-will-close");
    assert.equal(popupNativeContextMenu(menu, window, { ...params, menuSourceType: source }), true);
    const dismiss = setTimeout(() => menu.closePopup(window), 150);
    await closed;
    clearTimeout(dismiss);
    // menu-will-close runs inside native teardown. Let that stack unwind before
    // reopening the same Menu or destroying its owner (Electron forbids reentry).
    await delay(0);
  }
  assert.equal(shows, 2);
  assert.equal(
    await window.webContents.executeJavaScript("document.querySelector('textarea').value"),
    "Native menu regression",
  );
  console.log(
    "Native menu smoke passed: empty geometry blocked; two real popups opened/closed; renderer alive.",
  );
  window.destroy();
}

void run().then(
  () => {
    clearTimeout(watchdog);
    app.quit();
  },
  (error) => {
    console.error(error);
    app.exit(1);
  },
);
