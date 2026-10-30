// Bundle with `bun build --target=node --external=electron --format=cjs` and run with the
// pinned Electron binary, not Bun, on a real display (on Linux, a private headless Weston
// with `--ozone-platform=wayland`; headless Ozone has no viewport to right-click). No
// OpenCode service or user data. On Linux and Windows this downloads the en-US Hunspell
// dictionary from Chromium's default (Google) CDN into the isolated data directory.
import assert from "node:assert/strict";
import { once } from "node:events";
import { isAbsolute } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { app, BrowserWindow, Menu, session } from "electron";
import { installNativeContextMenu } from "../src/main/native-context-menu";

const dataRoot = process.env.PALOT_MENU_SMOKE_DATA;
assert(dataRoot && isAbsolute(dataRoot), "PALOT_MENU_SMOKE_DATA must be an isolated absolute path");
app.setPath("userData", dataRoot);
const watchdog = setTimeout(() => app.exit(2), 60_000);

type Template = Electron.MenuItemConstructorOptions[];
const templates: Template[] = [];
// Capture what the real handler builds; never enter a native popup in automation.
Menu.buildFromTemplate = ((template: Template) => {
  templates.push(template);
  return { popup: () => {}, closePopup: () => {} } as unknown as Electron.Menu;
}) as typeof Menu.buildFromTemplate;

async function rightClickWord(window: BrowserWindow, selector: string, word: string) {
  const point = (await window.webContents.executeJavaScript(`(() => {
    const field = document.querySelector(${JSON.stringify(selector)});
    const node = field.tagName === "TEXTAREA" ? null : field.firstChild;
    if (!node) {
      const rect = field.getBoundingClientRect();
      return { x: Math.round(rect.left + 12), y: Math.round(rect.top + 12) };
    }
    const start = node.textContent.indexOf(${JSON.stringify(word)});
    const range = document.createRange();
    range.setStart(node, start + 1);
    range.setEnd(node, start + 2);
    const rect = range.getBoundingClientRect();
    return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
  })()`)) as { x: number; y: number };
  const context = once(window.webContents, "context-menu");
  for (const type of ["mouseDown", "mouseUp"] as const)
    window.webContents.sendInputEvent({ type, ...point, button: "right", clickCount: 1 });
  const [, params] = (await context) as [Electron.Event, Electron.ContextMenuParams];
  // installNativeContextMenu builds asynchronously after the event.
  await delay(50);
  return params;
}

const labels = (template: Template | undefined) =>
  (template ?? []).map((item) => item.label ?? item.role ?? item.type);

async function run() {
  await app.whenReady();
  const languages = session.defaultSession.availableSpellCheckerLanguages;
  console.log(
    JSON.stringify({
      platform: process.platform,
      preferredSystemLanguages: app.getPreferredSystemLanguages(),
      availableCount: languages.length,
      defaultLanguages: session.defaultSession.getSpellCheckerLanguages(),
    }),
  );
  if (process.platform !== "darwin") {
    const ready = new Promise<string>((resolve) => {
      session.defaultSession.once("spellcheck-dictionary-initialized", (_event, code) =>
        resolve(`initialized ${code}`),
      );
      session.defaultSession.once("spellcheck-dictionary-download-failure", (_event, code) =>
        resolve(`download failed ${code}`),
      );
    });
    session.defaultSession.on("spellcheck-dictionary-download-begin", (_event, code) =>
      console.log(`dictionary download began: ${code}`),
    );
    session.defaultSession.setSpellCheckerLanguages(["en-US"]);
    console.log(`dictionary: ${await Promise.race([ready, delay(30_000, "timed out")])}`);
  }
  session.defaultSession.setSpellCheckerEnabled(true);

  const window = new BrowserWindow({
    width: 700,
    height: 420,
    show: false,
    webPreferences: { spellcheck: true, sandbox: true, contextIsolation: true },
  });
  installNativeContextMenu(window);
  const html = `<div id="field" contenteditable="true" style="font:20px sans-serif;padding:8px">Please recieve teh zqxjvbnmk</div>
<iframe id="frame" srcdoc="<div contenteditable=true style='font:20px sans-serif'>recieve here</div>" style="width:400px;height:80px"></iframe>`;
  window.showInactive();
  await window.loadURL(`data:text/html,${encodeURIComponent(html)}`);
  window.webContents.focus();
  await window.webContents.executeJavaScript(`(() => {
    const field = document.getElementById("field");
    field.focus();
    const range = document.createRange();
    range.selectNodeContents(field);
    range.collapse(false);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
  })()`);
  // Typing triggers Chromium's spellcheck pass over the field.
  window.webContents.insertText(" ");
  await delay(1500);

  const misspelled = await rightClickWord(window, "#field", "recieve");
  console.log(
    JSON.stringify({
      misspelledWord: misspelled.misspelledWord,
      suggestions: misspelled.dictionarySuggestions,
      mainFrame: misspelled.frame === window.webContents.mainFrame,
      template: labels(templates.at(-1)),
    }),
  );
  assert.equal(misspelled.misspelledWord, "recieve");
  assert.ok(misspelled.dictionarySuggestions.includes("receive"));
  const menu = templates.at(-1)!;
  assert.equal(menu[0]?.label, misspelled.dictionarySuggestions[0]);
  assert.ok(labels(menu).includes("Add to Dictionary"));
  assert.ok(labels(menu).includes("paste"), "editing items stay after spelling items");
  const receive = menu.find((item) => item.label === "receive")!;
  receive.click?.({} as Electron.MenuItem, undefined, {} as Electron.KeyboardEvent);
  await delay(200);
  const text = (await window.webContents.executeJavaScript(
    "document.getElementById('field').textContent",
  )) as string;
  assert.match(text, /Please receive teh/);

  const unknown = await rightClickWord(window, "#field", "zqxjvbnmk");
  console.log(
    JSON.stringify({
      misspelledWord: unknown.misspelledWord,
      suggestions: unknown.dictionarySuggestions,
      template: labels(templates.at(-1)),
    }),
  );
  assert.equal(unknown.misspelledWord, "zqxjvbnmk");
  if (unknown.dictionarySuggestions.length === 0)
    assert.equal(templates.at(-1)![0]?.label, "No Suggestions");
  const add = templates.at(-1)!.find((item) => item.label === "Add to Dictionary")!;
  add.click?.({} as Electron.MenuItem, undefined, {} as Electron.KeyboardEvent);
  await delay(1000);
  const added = await rightClickWord(window, "#field", "zqxjvbnmk");
  console.log(
    JSON.stringify({ afterAdd: added.misspelledWord, template: labels(templates.at(-1)) }),
  );
  assert.equal(added.misspelledWord, "", "an added word is no longer misspelled");
  assert.ok(!labels(templates.at(-1)).includes("Add to Dictionary"));

  // A subframe's editable content gets editing items, never spelling items.
  const frame = window.webContents.mainFrame.frames[0]!;
  await frame.executeJavaScript(`(() => {
    const field = document.querySelector("div");
    field.focus();
    const range = document.createRange();
    range.selectNodeContents(field);
    range.collapse(false);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
  })()`);
  window.webContents.insertText(" ");
  await delay(1500);
  const offset = (await window.webContents.executeJavaScript(
    "(() => { const r = document.getElementById('frame').getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top) }; })()",
  )) as { x: number; y: number };
  const context = once(window.webContents, "context-menu");
  for (const type of ["mouseDown", "mouseUp"] as const)
    window.webContents.sendInputEvent({
      type,
      x: offset.x + 30,
      y: offset.y + 18,
      button: "right",
      clickCount: 1,
    });
  const [, framed] = (await context) as [Electron.Event, Electron.ContextMenuParams];
  await delay(50);
  console.log(
    JSON.stringify({
      subframeMisspelled: framed.misspelledWord,
      subframeIsMain: framed.frame === window.webContents.mainFrame,
      template: labels(templates.at(-1)),
    }),
  );
  assert.equal(framed.isEditable, true);
  assert.ok(!labels(templates.at(-1)).includes("Add to Dictionary"));

  console.log("Spellcheck menu smoke passed.");
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
