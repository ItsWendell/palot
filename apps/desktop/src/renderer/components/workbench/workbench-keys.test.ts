import { afterEach, describe, expect, it } from "vitest";
import { resetShortcutBindings, setShortcutBinding } from "../../lib/keyboard-shortcuts";
import { adjacentWorkbenchTab, workbenchKeyAction } from "./workbench-keys";

function key(init: KeyboardEventInit, target?: Element) {
  const event = new KeyboardEvent("keydown", init);
  // Happy DOM reports AltGraph whenever Alt is held; Chromium reports it only for AltGr.
  Object.defineProperty(event, "getModifierState", { value: () => false });
  if (target) Object.defineProperty(event, "target", { value: target });
  return event;
}

const several = { tabCount: 3, canReopen: false };

describe("workbenchKeyAction", () => {
  afterEach(() => resetShortcutBindings());

  it("closes the tab with the platform close key instead of the window", () => {
    expect(workbenchKeyAction(key({ key: "w", ctrlKey: true }), several, "Linux")).toBe("close");
    expect(workbenchKeyAction(key({ key: "w", metaKey: true }), several, "MacIntel")).toBe("close");
    // ⌃W is not macOS's close key, and Super+W is not Linux's.
    expect(workbenchKeyAction(key({ key: "w", ctrlKey: true }), several, "MacIntel")).toBeNull();
    expect(workbenchKeyAction(key({ key: "w", metaKey: true }), several, "Linux")).toBeNull();
  });

  it("keeps the close key from the window menu when it would otherwise close the window", () => {
    const held = key({ key: "w", ctrlKey: true, repeat: true });
    expect(workbenchKeyAction(held, several, "Linux")).toBe("swallow");
    const empty = { tabCount: 0, canReopen: false };
    expect(workbenchKeyAction(key({ key: "w", ctrlKey: true }), empty, "Linux")).toBe("swallow");
  });

  it("leaves Ctrl keys to a focused terminal", () => {
    const terminal = document.createElement("div");
    terminal.dataset.workbenchTerminal = "pty";
    const input = terminal.appendChild(document.createElement("textarea"));
    expect(
      workbenchKeyAction(key({ key: "w", ctrlKey: true }, input), several, "Linux"),
    ).toBeNull();
    expect(
      workbenchKeyAction(key({ key: "Tab", ctrlKey: true }, input), several, "Linux"),
    ).toBeNull();
    expect(workbenchKeyAction(key({ key: "w", metaKey: true }, input), several, "MacIntel")).toBe(
      "close",
    );
  });

  it("cycles tabs only when the pane has several", () => {
    expect(workbenchKeyAction(key({ key: "Tab", ctrlKey: true }), several, "Linux")).toBe("next");
    expect(
      workbenchKeyAction(key({ key: "Tab", ctrlKey: true, shiftKey: true }), several, "Linux"),
    ).toBe("previous");
    const one = { tabCount: 1, canReopen: false };
    expect(workbenchKeyAction(key({ key: "Tab", ctrlKey: true }), one, "Linux")).toBeNull();
  });

  it("follows personal task switching bindings", () => {
    setShortcutBinding("task.next", ["Mod", "J"]);
    expect(workbenchKeyAction(key({ key: "Tab", ctrlKey: true }), several, "Linux")).toBeNull();
    expect(workbenchKeyAction(key({ key: "j", ctrlKey: true }), several, "Linux")).toBe("next");
  });
});

describe("adjacentWorkbenchTab", () => {
  const tabs = [{ id: "a" }, { id: "b" }, { id: "c" }];

  it("wraps at both ends", () => {
    expect(adjacentWorkbenchTab(tabs, "c", "next")?.id).toBe("a");
    expect(adjacentWorkbenchTab(tabs, "a", "previous")?.id).toBe("c");
    expect(adjacentWorkbenchTab(tabs.slice(0, 1), "a", "next")).toBeUndefined();
  });
});
