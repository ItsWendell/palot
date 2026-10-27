import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { persistedStorageKey } from "../atoms/persisted";
import { COMPOSER_SHORTCUT_KEYS, matchComposerShortcut } from "./composer-shortcuts";
import {
  KEYBOARD_SHORTCUTS,
  boundShortcutKeys,
  defaultShortcutKeys,
  formatShortcut,
  isShortcutCustomized,
  keyboardShortcut,
  matchesShortcut,
  recentTaskShortcutIndex,
  resetShortcutBinding,
  resetShortcutBindings,
  setShortcutBinding,
  shortcutBindingProblem,
  shortcutConflicts,
  shortcutFromKeyboardEvent,
  shortcutKeys,
  shortcutOverrides,
} from "./keyboard-shortcuts";

function key(init: KeyboardEventInit & { altGraph?: boolean }) {
  const { altGraph, ...rest } = init;
  const event = new KeyboardEvent("keydown", rest);
  // Happy DOM reports AltGraph whenever Alt is held; Chromium reports it only for AltGr.
  Object.defineProperty(event, "getModifierState", {
    value: (state: string) => state === "AltGraph" && altGraph === true,
  });
  return event;
}

describe("formatShortcut", () => {
  it("uses Ctrl/Alt/Shift with plus signs on Windows and Linux", () => {
    expect(formatShortcut(["Mod", "Shift", "I"], "Win32")).toBe("Ctrl+Shift+I");
    expect(formatShortcut(["Control", "`"], "Linux x86_64")).toBe("Ctrl+`");
    expect(formatShortcut(["Shift", "Mod", "O"], "Linux x86_64")).toBe("Ctrl+Shift+O");
    expect(formatShortcut(["Alt", "1–9"], "Linux x86_64")).toBe("Alt+1–9");
    expect(formatShortcut(["Control", "Shift", "Tab"], "Linux x86_64")).toBe("Ctrl+Shift+Tab");
  });

  it("uses Apple modifier symbols in Apple order on macOS", () => {
    expect(formatShortcut(["Meta", "Shift", "I"], "MacIntel")).toBe("⇧⌘I");
    expect(formatShortcut(["Control", "`"], "MacIntel")).toBe("⌃`");
    expect(formatShortcut(["Alt", "1"], "MacIntel")).toBe("⌥1");
    expect(formatShortcut(["Mod", "Enter"], "darwin")).toBe("⌘↩");
  });

  it("collapses Mod and Control into a single Ctrl outside macOS", () => {
    expect(formatShortcut(["Mod", "Control", "K"], "Win32")).toBe("Ctrl+K");
  });
});

describe("matchesShortcut", () => {
  it("accepts Ctrl or Command for primary shortcuts and requires exact Shift", () => {
    expect(matchesShortcut(key({ key: "k", ctrlKey: true }), ["Mod", "K"])).toBe(true);
    expect(matchesShortcut(key({ key: "k", metaKey: true }), ["Mod", "K"])).toBe(true);
    expect(matchesShortcut(key({ key: "K", ctrlKey: true, shiftKey: true }), ["Mod", "K"])).toBe(
      false,
    );
    expect(
      matchesShortcut(key({ key: "O", ctrlKey: true, shiftKey: true }), ["Mod", "Shift", "O"]),
    ).toBe(true);
  });

  it("matches punctuation by physical key when Shift changes the character", () => {
    expect(
      matchesShortcut(key({ key: ">", code: "Period", ctrlKey: true, shiftKey: true }), [
        "Mod",
        "Shift",
        ".",
      ]),
    ).toBe(true);
  });

  it("matches letters on non-Latin layouts by physical key", () => {
    expect(matchesShortcut(key({ key: "д", code: "KeyL", ctrlKey: true }), ["Mod", "L"])).toBe(
      true,
    );
    // A Latin layout that moves the letter must follow the character, not the position.
    expect(matchesShortcut(key({ key: "z", code: "KeyY", ctrlKey: true }), ["Mod", "Y"])).toBe(
      false,
    );
  });

  it("keeps literal Control shortcuts separate from Command", () => {
    expect(matchesShortcut(key({ key: "Tab", ctrlKey: true }), ["Control", "Tab"])).toBe(true);
    expect(matchesShortcut(key({ key: "Tab", metaKey: true }), ["Control", "Tab"])).toBe(false);
    expect(
      matchesShortcut(key({ key: "Tab", ctrlKey: true, shiftKey: true }), ["Control", "Tab"]),
    ).toBe(false);
  });

  it("ignores IME composition and AltGr input", () => {
    expect(matchesShortcut(key({ key: "l", ctrlKey: true, isComposing: true }), ["Mod", "L"])).toBe(
      false,
    );
    expect(
      matchesShortcut(key({ key: "l", ctrlKey: true, altKey: true, altGraph: true }), ["Mod", "L"]),
    ).toBe(false);
  });

  it("accepts explicit Ctrl+Alt shortcuts even when the chord reports AltGraph", () => {
    const chord = key({
      key: "[",
      code: "BracketLeft",
      ctrlKey: true,
      altKey: true,
      altGraph: true,
    });
    expect(matchesShortcut(chord, ["Mod", "Alt", "["])).toBe(true);
    expect(matchesShortcut(chord, ["Mod", "["])).toBe(false);
    // German layout: AltGr+8 types "[" and must stay text input.
    const typedBracket = key({
      key: "[",
      code: "Digit8",
      ctrlKey: true,
      altKey: true,
      altGraph: true,
    });
    expect(matchesShortcut(typedBracket, ["Mod", "Alt", "["])).toBe(false);
  });
});

describe("recentTaskShortcutIndex", () => {
  it("reads Alt+digit from the physical key so Option characters still match", () => {
    expect(recentTaskShortcutIndex(key({ key: "3", code: "Digit3", altKey: true }))).toBe(3);
    expect(recentTaskShortcutIndex(key({ key: "¡", code: "Digit1", altKey: true }))).toBe(1);
  });

  it("does not fire for AltGr, other modifiers, zero, or composition", () => {
    expect(
      recentTaskShortcutIndex(
        key({ key: "{", code: "Digit7", altKey: true, ctrlKey: true, altGraph: true }),
      ),
    ).toBeNull();
    expect(
      recentTaskShortcutIndex(key({ key: "7", code: "Digit7", altKey: true, ctrlKey: true })),
    ).toBeNull();
    expect(recentTaskShortcutIndex(key({ key: "0", code: "Digit0", altKey: true }))).toBeNull();
    expect(
      recentTaskShortcutIndex(key({ key: "1", code: "Digit1", altKey: true, isComposing: true })),
    ).toBeNull();
    expect(recentTaskShortcutIndex(key({ key: "1", code: "Digit1" }))).toBeNull();
  });
});

describe("keyboard shortcut catalog", () => {
  // Two shortcuts with the same keys in overlapping scopes would make one unreachable.
  it("ships default bindings without conflicts", () => {
    for (const shortcut of KEYBOARD_SHORTCUTS) {
      expect(shortcutConflicts(shortcut.id, shortcut.keys).map(({ id }) => id)).toEqual([]);
    }
  });
});

describe("personal bindings", () => {
  beforeEach(() => {
    document.documentElement.dataset.platform = "linux";
  });
  afterEach(() => {
    resetShortcutBindings();
    delete document.documentElement.dataset.platform;
  });

  it("allows rebinding and clearing the terminal quote action through the shared registry", () => {
    setShortcutBinding("terminal.quote", ["Mod", "Shift", "J"]);
    expect(
      matchesShortcut(
        key({ key: "J", ctrlKey: true, shiftKey: true }),
        shortcutKeys("terminal.quote"),
      ),
    ).toBe(true);
    expect(
      matchesShortcut(
        key({ key: "L", ctrlKey: true, shiftKey: true }),
        shortcutKeys("terminal.quote"),
      ),
    ).toBe(false);
    setShortcutBinding("terminal.quote", null);
    expect(boundShortcutKeys("terminal.quote")).toBeUndefined();
  });

  it("routes matchers and labels through the effective binding and persists it", () => {
    setShortcutBinding("palette.open", ["Mod", "P"]);
    expect(matchesShortcut(key({ key: "p", ctrlKey: true }), shortcutKeys("palette.open"))).toBe(
      true,
    );
    expect(matchesShortcut(key({ key: "k", ctrlKey: true }), shortcutKeys("palette.open"))).toBe(
      false,
    );
    expect(formatShortcut(shortcutKeys("palette.open"))).toBe("Ctrl+P");
    expect(window.localStorage.getItem(persistedStorageKey("keyboard-shortcuts"))).toContain(
      "palette.open",
    );

    setShortcutBinding("composer.model", ["Mod", "J"]);
    expect(matchComposerShortcut(key({ key: "j", ctrlKey: true }))).toBe("model");
    expect(matchComposerShortcut(key({ key: "'", code: "Quote", ctrlKey: true }))).toBeNull();
    expect(COMPOSER_SHORTCUT_KEYS.model).toEqual(["Mod", "J"]);
  });

  it("clears optional shortcuts but keeps required and locked ones", () => {
    setShortcutBinding("task.new", null);
    expect(shortcutKeys("task.new")).toEqual([]);
    expect(boundShortcutKeys("task.new")).toBeUndefined();
    expect(matchesShortcut(key({ key: "n", ctrlKey: true }), shortcutKeys("task.new"))).toBe(false);
    expect(() => setShortcutBinding("palette.open", null)).toThrow();
    expect(() => setShortcutBinding("composer.send", ["Mod", "Enter"])).toThrow();
    expect(shortcutBindingProblem("task.recent", ["Mod", "1"])).toBe(
      keyboardShortcut("task.recent").locked,
    );
  });

  it("resets one binding or all of them", () => {
    setShortcutBinding("task.new", ["Mod", "J"]);
    setShortcutBinding("settings.open", ["Mod", "Shift", "P"]);
    resetShortcutBinding("task.new");
    expect(shortcutKeys("task.new")).toBe(defaultShortcutKeys("task.new"));
    expect(isShortcutCustomized("settings.open")).toBe(true);
    resetShortcutBindings();
    expect(shortcutOverrides()).toEqual({});
    expect(window.localStorage.getItem(persistedStorageKey("keyboard-shortcuts"))).toBeNull();
  });

  it("treats saving the default keys as a reset", () => {
    setShortcutBinding("task.new", ["Mod", "J"]);
    setShortcutBinding("task.new", ["Mod", "N"]);
    expect(isShortcutCustomized("task.new")).toBe(false);
  });

  it("detects conflicts only between scopes that receive the same key press", () => {
    expect(shortcutConflicts("composer.model", ["Mod", "K"]).map(({ id }) => id)).toEqual([
      "palette.open",
    ]);
    expect(shortcutConflicts("task.turn.next", ["Mod", "."]).map(({ id }) => id)).toEqual([
      "composer.agent.next",
    ]);
    // Ctrl satisfies Mod, so a literal Control binding collides with it.
    expect(shortcutConflicts("task.next", ["Control", "K"]).map(({ id }) => id)).toEqual([
      "palette.open",
    ]);
    expect(shortcutConflicts("task.find", ["Mod", "F"])).toEqual([]);
    expect(shortcutConflicts("changes.find", ["Mod", "F"])).toEqual([]);
    setShortcutBinding("palette.open", ["Mod", "P"]);
    expect(shortcutConflicts("composer.model", ["Mod", "K"])).toEqual([]);
  });

  it("rejects bare keys, Alt for global shortcuts, and system shortcuts", () => {
    expect(shortcutBindingProblem("task.new", ["J"])).toMatch(/Ctrl/);
    expect(shortcutBindingProblem("task.new", ["Shift", "J"])).toMatch(/Ctrl/);
    expect(shortcutBindingProblem("task.new", ["Mod", "Alt", "J"])).toMatch(/Alt/);
    expect(shortcutBindingProblem("task.turn.next", ["Mod", "Alt", "J"])).toBeNull();
    expect(shortcutBindingProblem("task.new", ["Mod", "C"])).toMatch(/Copy/);
    expect(shortcutBindingProblem("task.new", ["Mod", "Q"], "Linux")).toBeNull();
    expect(shortcutBindingProblem("task.new", ["Mod", "Q"], "MacIntel")).toMatch(/Quit/);
  });
});

describe("shortcutFromKeyboardEvent", () => {
  it("records Command as Mod on macOS and Ctrl as Mod elsewhere", () => {
    expect(
      shortcutFromKeyboardEvent(key({ key: "j", code: "KeyJ", metaKey: true }), "MacIntel"),
    ).toEqual(["Mod", "J"]);
    expect(
      shortcutFromKeyboardEvent(key({ key: "j", code: "KeyJ", ctrlKey: true }), "MacIntel"),
    ).toEqual(["Control", "J"]);
    expect(
      shortcutFromKeyboardEvent(key({ key: "j", code: "KeyJ", ctrlKey: true }), "Linux"),
    ).toEqual(["Mod", "J"]);
  });

  it("uses physical keys when modifiers change the character and waits for a key", () => {
    expect(
      shortcutFromKeyboardEvent(
        key({ key: ">", code: "Period", ctrlKey: true, shiftKey: true }),
        "Linux",
      ),
    ).toEqual(["Mod", "Shift", "."]);
    expect(
      shortcutFromKeyboardEvent(
        key({ key: "˚", code: "KeyK", metaKey: true, altKey: true }),
        "MacIntel",
      ),
    ).toEqual(["Mod", "Alt", "K"]);
    expect(shortcutFromKeyboardEvent(key({ key: "Control", ctrlKey: true }), "Linux")).toBeNull();
  });
});
