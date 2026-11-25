/**
 * Single source of truth for Palot keyboard shortcuts and their labels.
 *
 * Key names:
 * - `Mod` is the platform's primary modifier: ⌘ on macOS, Ctrl elsewhere.
 *   `Meta` is accepted as a legacy alias of `Mod`.
 * - `Control` is the literal Control key on every platform (⌃ on macOS).
 * - `Alt` is Option (⌥) on macOS.
 * - Other entries are `KeyboardEvent.key` values (`"K"`, `"Enter"`, `"ArrowUp"`, `"."`)
 *   or display-only ranges such as `"1–9"`.
 *
 * People can rebind editable shortcuts. Read keys through `shortcutKeys` (or
 * `useShortcutKeys` in components) so matchers and labels follow personal bindings.
 */
import { useSyncExternalStore } from "react";
import {
  loadPersistedValue,
  persistedStorageKey,
  removePersistedValue,
  savePersistedValue,
} from "../atoms/persisted";

export type ShortcutKey = string;
export type ShortcutKeys = readonly ShortcutKey[];
export type ShortcutPlatform = "mac" | "other";

export type KeyboardShortcutGroup = "general" | "tasks" | "panels" | "composer" | "task-view";

export const KEYBOARD_SHORTCUT_GROUPS: readonly { id: KeyboardShortcutGroup; label: string }[] = [
  { id: "general", label: "General" },
  { id: "tasks", label: "Tasks" },
  { id: "panels", label: "Panels" },
  { id: "composer", label: "Composer" },
  { id: "task-view", label: "Task view" },
];

export type KeyboardShortcutID =
  | "palette.open"
  | "task.new"
  | "chat.new"
  | "task.choose-project"
  | "settings.open"
  | "navigation.toggle"
  | "app.restart"
  | "task.recent"
  | "task.next"
  | "task.previous"
  | "tasks.list.previous"
  | "tasks.list.next"
  | "tasks.needs-you.next"
  | "task.settle"
  | "tasks.list.jump"
  | "task-list.move"
  | "task-list.settle"
  | "task-list.snooze"
  | "task-list.pin"
  | "task-list.unread"
  | "task-list.quick-look"
  | "task-list.allow"
  | "task-list.deny"
  | "task-list.rename"
  | "task.changes.toggle"
  | "task.terminal.toggle"
  | "task.voice.toggle"
  | "workbench.tab.close"
  | "terminal.quote"
  | "composer.focus"
  | "composer.send"
  | "composer.newline"
  | "composer.steer"
  | "composer.steer-first"
  | "composer.queue-first"
  | "composer.model"
  | "composer.reasoning.cycle"
  | "composer.agent.next"
  | "composer.agent.previous"
  | "composer.launcher"
  | "composer.attach"
  | "composer.stash"
  | "composer.shell"
  | "composer.shell.exit"
  | "composer.shell.enter-key"
  | "composer.shell.exit-key"
  | "composer.history.previous"
  | "composer.history.next"
  | "composer.page.up"
  | "composer.page.down"
  | "new-task.workspace"
  | "new-task.branch"
  | "task.find"
  | "task.ship"
  | "task.turn.previous"
  | "task.turn.next"
  | "task.jump"
  | "navigation.back"
  | "navigation.forward"
  | "focus.region.next"
  | "focus.region.previous"
  | "changes.find";

/**
 * Where a shortcut's handler listens. Bindings conflict when their scopes can receive the
 * same key press: `global` overlaps every scope, and the composer sits inside the task view.
 */
export type KeyboardShortcutScope = "global" | "composer" | "task-view" | "changes" | "task-list";

export interface KeyboardShortcut {
  id: KeyboardShortcutID;
  group: KeyboardShortcutGroup;
  label: string;
  keys: ShortcutKeys;
  /** Extra context, for example where the shortcut applies. */
  note?: string;
  /** Defaults to the group's scope. */
  scope?: KeyboardShortcutScope;
  /** Built-in or system-owned keys that people cannot rebind. */
  locked?: string;
  /** The shortcut must keep a binding; it can be changed but not cleared. */
  required?: boolean;
  /** Another locked shortcut on the same keys; the handler picks one by state, so they never conflict. */
  sharesKeysWith?: KeyboardShortcutID;
}

const COMPOSER_TYPING = "Part of typing in the composer";
const COMPOSER_PAGING = "The caret stays put; not while suggestions are open";
const FOCUS_REGION_ORDER = "Task list, transcript, composer, then the workbench when it is open";
const TASK_LIST_ROW = "On a focused row in the task list";
const TASK_LIST_ROW_KEY = "A single key on the focused row";
const WORKBENCH_TAB_CYCLING =
  "Switches workbench tabs instead while a workbench with several tabs has focus";

export const KEYBOARD_SHORTCUTS: readonly KeyboardShortcut[] = [
  {
    id: "palette.open",
    group: "general",
    label: "Search tasks and commands",
    keys: ["Mod", "K"],
    required: true,
  },
  { id: "task.new", group: "general", label: "New task", keys: ["Mod", "N"] },
  { id: "chat.new", group: "general", label: "New chat", keys: ["Mod", "Alt", "N"] },
  {
    id: "task.choose-project",
    group: "general",
    label: "Choose project for a new task",
    keys: ["Mod", "Shift", "O"],
  },
  { id: "settings.open", group: "general", label: "Open settings", keys: ["Mod", ","] },
  {
    id: "navigation.toggle",
    group: "general",
    label: "Show or hide navigation",
    keys: ["Mod", "B"],
  },
  {
    id: "app.restart",
    group: "general",
    label: "Restart Palot",
    keys: ["Mod", "Shift", "R"],
    note: "Development and Nightly builds",
  },
  {
    id: "task.recent",
    group: "tasks",
    label: "Open recent task 1–9",
    keys: ["Alt", "1–9"],
    note: "Same order as Recent tasks in the command palette",
    locked: "Uses the number keys as a range",
  },
  {
    id: "task.next",
    group: "tasks",
    label: "Next recent task",
    keys: ["Control", "Tab"],
    note: WORKBENCH_TAB_CYCLING,
  },
  {
    id: "task.previous",
    group: "tasks",
    label: "Previous recent task",
    keys: ["Control", "Shift", "Tab"],
    note: WORKBENCH_TAB_CYCLING,
  },
  {
    id: "tasks.list.previous",
    group: "tasks",
    label: "Open the previous task in the list",
    keys: ["Alt", "ArrowUp"],
    note: "Not while typing in a field",
  },
  {
    id: "tasks.list.next",
    group: "tasks",
    label: "Open the next task in the list",
    keys: ["Alt", "ArrowDown"],
    note: "Not while typing in a field",
  },
  {
    id: "tasks.needs-you.next",
    group: "tasks",
    label: "Open the next task that needs you",
    keys: ["Mod", "Alt", "A"],
  },
  {
    id: "task.settle",
    group: "tasks",
    label: "Settle the open task",
    keys: ["Mod", "Shift", "S"],
    note: "Then opens the next task in the list, as settling its row does",
  },
  {
    id: "tasks.list.jump",
    group: "tasks",
    label: "Open task 1–9 in the list",
    keys: ["Mod", "1–9"],
    note: "Hold the modifier to see the numbers",
    locked: "Uses the number keys as a range",
  },
  {
    id: "task-list.move",
    group: "tasks",
    label: "Move through the task list",
    keys: ["J"],
    note: "K moves up; the arrow keys work too",
    scope: "task-list",
    locked: TASK_LIST_ROW_KEY,
  },
  {
    id: "task-list.settle",
    group: "tasks",
    label: "Settle",
    keys: ["E"],
    note: TASK_LIST_ROW,
    scope: "task-list",
    locked: TASK_LIST_ROW_KEY,
  },
  {
    id: "task-list.snooze",
    group: "tasks",
    label: "Snooze",
    keys: ["S"],
    note: TASK_LIST_ROW,
    scope: "task-list",
    locked: TASK_LIST_ROW_KEY,
  },
  {
    id: "task-list.pin",
    group: "tasks",
    label: "Pin or unpin",
    keys: ["P"],
    note: TASK_LIST_ROW,
    scope: "task-list",
    locked: TASK_LIST_ROW_KEY,
  },
  {
    id: "task-list.unread",
    group: "tasks",
    label: "Mark as read or unread",
    keys: ["U"],
    note: TASK_LIST_ROW,
    scope: "task-list",
    locked: TASK_LIST_ROW_KEY,
  },
  {
    id: "task-list.quick-look",
    group: "tasks",
    label: "Quick look",
    keys: ["Space"],
    note: TASK_LIST_ROW,
    scope: "task-list",
    locked: TASK_LIST_ROW_KEY,
  },
  {
    id: "task-list.allow",
    group: "tasks",
    label: "Allow once",
    keys: ["A"],
    note: "On a focused row waiting for approval",
    scope: "task-list",
    locked: TASK_LIST_ROW_KEY,
  },
  {
    id: "task-list.deny",
    group: "tasks",
    label: "Deny",
    keys: ["D"],
    note: "On a focused row waiting for approval",
    scope: "task-list",
    locked: TASK_LIST_ROW_KEY,
  },
  {
    id: "task-list.rename",
    group: "tasks",
    label: "Rename",
    keys: ["F2"],
    note: "On a focused row; double-click works too",
    scope: "task-list",
    locked: TASK_LIST_ROW_KEY,
  },
  {
    id: "task.changes.toggle",
    group: "panels",
    label: "Show or hide changes",
    keys: ["Mod", "Shift", "I"],
  },
  {
    id: "task.terminal.toggle",
    group: "panels",
    label: "Show or hide terminal",
    keys: ["Control", "`"],
  },
  {
    id: "task.voice.toggle",
    group: "tasks",
    label: "Start or end voice chat",
    keys: ["Mod", "Alt", "V"],
  },
  {
    id: "workbench.tab.close",
    group: "panels",
    label: "Close workbench tab",
    keys: ["Mod", "W"],
    note: "While the workbench has focus; elsewhere it closes the window",
    locked: "Shares the system Close window shortcut",
  },
  {
    id: "composer.focus",
    group: "composer",
    label: "Focus composer",
    keys: ["Mod", "L"],
    scope: "global",
  },
  {
    id: "terminal.quote",
    group: "panels",
    label: "Quote terminal selection in composer",
    keys: ["Mod", "Shift", "L"],
    note: "While the terminal has focus and text is selected",
  },
  {
    id: "composer.send",
    group: "composer",
    label: "Send message",
    keys: ["Enter"],
    locked: COMPOSER_TYPING,
  },
  {
    id: "composer.newline",
    group: "composer",
    label: "New line",
    keys: ["Shift", "Enter"],
    locked: COMPOSER_TYPING,
  },
  {
    id: "composer.steer",
    group: "composer",
    label: "Send the other way (steer or queue)",
    keys: ["Mod", "Enter"],
    note: "While a task is working",
    locked: COMPOSER_TYPING,
  },
  {
    id: "composer.steer-first",
    group: "composer",
    label: "Steer the first queued message",
    keys: ["Mod", "Enter"],
    note: "With an empty composer while a task is working",
    locked: COMPOSER_TYPING,
    sharesKeysWith: "composer.steer",
  },
  {
    id: "composer.queue-first",
    group: "composer",
    label: "Queue the message first",
    keys: ["Alt", "Enter"],
    note: "While a task is working; ahead of the messages already queued",
    locked: COMPOSER_TYPING,
  },
  { id: "composer.model", group: "composer", label: "Choose model", keys: ["Mod", "'"] },
  {
    id: "composer.reasoning.cycle",
    group: "composer",
    label: "Cycle reasoning effort",
    keys: ["Mod", "Shift", "D"],
    note: "For models with reasoning options",
  },
  { id: "composer.agent.next", group: "composer", label: "Cycle agent", keys: ["Mod", "."] },
  {
    id: "composer.agent.previous",
    group: "composer",
    label: "Cycle agent backwards",
    keys: ["Mod", "Shift", "."],
  },
  {
    id: "composer.launcher",
    group: "composer",
    label: "Add to the message",
    keys: ["Mod", "/"],
  },
  { id: "composer.attach", group: "composer", label: "Attach files", keys: ["Mod", "U"] },
  {
    id: "composer.stash",
    group: "composer",
    label: "Stash prompt",
    keys: ["Mod", "S"],
    locked: "Only while the composer is focused; file editors keep Save",
  },
  {
    id: "composer.shell",
    group: "composer",
    label: "Shell command mode",
    keys: ["!"],
    note: "At the start of an empty composer",
    locked: COMPOSER_TYPING,
  },
  {
    id: "composer.shell.exit",
    group: "composer",
    label: "Leave shell mode",
    keys: ["Escape"],
    locked: COMPOSER_TYPING,
  },
  {
    id: "composer.shell.enter-key",
    group: "composer",
    label: "Switch to shell command mode",
    keys: ["Mod", "Shift", "X"],
  },
  {
    id: "composer.shell.exit-key",
    group: "composer",
    label: "Switch to normal prompt mode",
    keys: ["Mod", "Shift", "E"],
  },
  {
    id: "composer.history.previous",
    group: "composer",
    label: "Previous prompt",
    keys: ["ArrowUp"],
    note: "In an empty composer or with the cursor at the start",
    locked: COMPOSER_TYPING,
  },
  {
    id: "composer.history.next",
    group: "composer",
    label: "Next prompt",
    keys: ["ArrowDown"],
    note: "In an empty composer",
    locked: COMPOSER_TYPING,
  },
  {
    id: "composer.page.up",
    group: "composer",
    label: "Scroll the task up a page",
    keys: ["PageUp"],
    note: COMPOSER_PAGING,
    locked: COMPOSER_TYPING,
  },
  {
    id: "composer.page.down",
    group: "composer",
    label: "Scroll the task down a page",
    keys: ["PageDown"],
    note: COMPOSER_PAGING,
    locked: COMPOSER_TYPING,
  },
  {
    id: "new-task.workspace",
    group: "composer",
    label: "Choose where a new task works",
    keys: ["Mod", "Alt", "O"],
    note: "On the New task screen",
  },
  {
    id: "new-task.branch",
    group: "composer",
    label: "Choose a new worktree's base branch",
    keys: ["Mod", "Alt", "B"],
    note: "On the New task screen, when it creates a worktree",
  },
  { id: "task.find", group: "task-view", label: "Find in task", keys: ["Mod", "F"] },
  {
    id: "task.ship",
    group: "task-view",
    label: "Next shipping step (commit, push or pull request)",
    keys: ["Mod", "Shift", "Enter"],
    note: "Runs the task header's ship button; commits still ask for the message first",
  },
  {
    id: "changes.find",
    group: "panels",
    label: "Find in changes",
    keys: ["Mod", "F"],
    note: "While a Changes, diff or file tab is focused",
    scope: "changes",
  },
  {
    id: "task.turn.previous",
    group: "task-view",
    label: "Previous user turn",
    keys: ["Mod", "Alt", "["],
  },
  {
    id: "task.turn.next",
    group: "task-view",
    label: "Next user turn",
    keys: ["Mod", "Alt", "]"],
  },
  {
    id: "task.jump",
    group: "task-view",
    label: "Jump to message",
    keys: ["Mod", "Alt", "G"],
    note: "Search every prompt in the task, also ones not loaded yet",
  },
  { id: "navigation.back", group: "general", label: "Go back", keys: ["Mod", "["] },
  { id: "navigation.forward", group: "general", label: "Go forward", keys: ["Mod", "]"] },
  {
    id: "focus.region.next",
    group: "general",
    label: "Move focus to the next area",
    keys: ["F6"],
    note: FOCUS_REGION_ORDER,
  },
  {
    id: "focus.region.previous",
    group: "general",
    label: "Move focus to the previous area",
    keys: ["Shift", "F6"],
    note: FOCUS_REGION_ORDER,
  },
];

const SHORTCUTS_BY_ID = new Map(KEYBOARD_SHORTCUTS.map((shortcut) => [shortcut.id, shortcut]));
const NO_KEYS: ShortcutKeys = Object.freeze([]);

export function keyboardShortcut(id: KeyboardShortcutID): KeyboardShortcut {
  const shortcut = SHORTCUTS_BY_ID.get(id);
  if (!shortcut) throw new Error(`Unknown keyboard shortcut: ${id}`);
  return shortcut;
}

/** The catalog default, ignoring personal bindings. */
export function defaultShortcutKeys(id: KeyboardShortcutID): ShortcutKeys {
  return keyboardShortcut(id).keys;
}

/**
 * The effective binding: the personal binding when one is saved, otherwise the default.
 * Empty when the shortcut was cleared. Every matcher and label must read keys through this.
 */
export function shortcutKeys(id: KeyboardShortcutID): ShortcutKeys {
  const override = currentOverrides()[id];
  if (override === undefined) return keyboardShortcut(id).keys;
  return override ?? NO_KEYS;
}

/** The effective binding, or `undefined` when the shortcut is unbound. */
export function boundShortcutKeys(id: KeyboardShortcutID): ShortcutKeys | undefined {
  const keys = shortcutKeys(id);
  return keys.length > 0 ? keys : undefined;
}

export function shortcutScope(shortcut: KeyboardShortcut): KeyboardShortcutScope {
  if (shortcut.scope) return shortcut.scope;
  if (shortcut.group === "composer") return "composer";
  if (shortcut.group === "task-view") return "task-view";
  return "global";
}

/** Resolves the current platform. Pass a `navigator.platform`-style string to override. */
export function shortcutPlatform(platform?: string): ShortcutPlatform {
  if (platform !== undefined) {
    const value = platform.toLowerCase();
    return value.includes("mac") || value === "darwin" ? "mac" : "other";
  }
  if (typeof document !== "undefined") {
    const dataset = document.documentElement.dataset.platform;
    if (dataset) return dataset === "darwin" ? "mac" : "other";
  }
  if (typeof window !== "undefined" && window.palot?.platform) {
    return window.palot.platform === "darwin" ? "mac" : "other";
  }
  if (typeof navigator !== "undefined") return shortcutPlatform(navigator.platform);
  return "other";
}

type Modifier = "Control" | "Alt" | "Shift" | "Mod";

const MODIFIER_ALIASES: Record<string, Modifier> = {
  Mod: "Mod",
  Meta: "Mod",
  Cmd: "Mod",
  Command: "Mod",
  Control: "Control",
  Ctrl: "Control",
  Alt: "Alt",
  Option: "Alt",
  Shift: "Shift",
};

// Apple orders modifiers ⌃⌥⇧⌘; Windows and Linux conventionally use Ctrl+Alt+Shift.
const MAC_MODIFIER_ORDER: readonly Modifier[] = ["Control", "Alt", "Shift", "Mod"];
const OTHER_MODIFIER_ORDER: readonly Modifier[] = ["Mod", "Control", "Alt", "Shift"];

const MAC_MODIFIER_LABELS: Record<Modifier, string> = {
  Control: "⌃",
  Alt: "⌥",
  Shift: "⇧",
  Mod: "⌘",
};
const OTHER_MODIFIER_LABELS: Record<Modifier, string> = {
  Control: "Ctrl",
  Alt: "Alt",
  Shift: "Shift",
  Mod: "Ctrl",
};

const SHARED_KEY_LABELS: Record<string, string> = {
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
  PageUp: "Page Up",
  PageDown: "Page Down",
  " ": "Space",
  Space: "Space",
};
const MAC_KEY_LABELS: Record<string, string> = {
  Enter: "↩",
  Tab: "⇥",
  Escape: "Esc",
  Backspace: "⌫",
  Delete: "⌦",
};
const OTHER_KEY_LABELS: Record<string, string> = {
  Escape: "Esc",
  Delete: "Del",
};

function splitShortcut(keys: ShortcutKeys) {
  const modifiers = new Set<Modifier>();
  const rest: string[] = [];
  for (const key of keys) {
    const modifier = MODIFIER_ALIASES[key];
    if (modifier) modifiers.add(modifier);
    else rest.push(key);
  }
  return { modifiers, rest };
}

function keyLabel(key: string, platform: ShortcutPlatform) {
  const label =
    (platform === "mac" ? MAC_KEY_LABELS[key] : OTHER_KEY_LABELS[key]) ?? SHARED_KEY_LABELS[key];
  if (label) return label;
  return key.length === 1 ? key.toUpperCase() : key;
}

/** Ordered display tokens, one per key, for rendering each key in its own `<Kbd>`. */
export function shortcutTokens(keys: ShortcutKeys, platform?: string): string[] {
  const resolved = shortcutPlatform(platform);
  const { modifiers, rest } = splitShortcut(keys);
  // On Windows and Linux, Mod and Control are the same physical key.
  if (resolved === "other" && modifiers.has("Mod")) modifiers.delete("Control");
  const order = resolved === "mac" ? MAC_MODIFIER_ORDER : OTHER_MODIFIER_ORDER;
  const labels = resolved === "mac" ? MAC_MODIFIER_LABELS : OTHER_MODIFIER_LABELS;
  return [
    ...order.filter((modifier) => modifiers.has(modifier)).map((modifier) => labels[modifier]),
    ...rest.map((key) => keyLabel(key, resolved)),
  ];
}

/**
 * Formats a shortcut label: `⇧⌘I` on macOS and `Ctrl+Shift+I` on Windows and Linux.
 */
export function formatShortcut(keys: ShortcutKeys, platform?: string): string {
  return shortcutTokens(keys, platform).join(shortcutPlatform(platform) === "mac" ? "" : "+");
}

/** `aria-keyshortcuts` value for a binding, or `undefined` when unbound. */
export function shortcutAriaKeys(keys: ShortcutKeys, platform?: string): string | undefined {
  const { modifiers, rest } = splitShortcut(keys);
  if (rest.length !== 1) return undefined;
  const mac = shortcutPlatform(platform) === "mac";
  const names = [
    modifiers.has("Control") || (!mac && modifiers.has("Mod")) ? "Control" : null,
    modifiers.has("Alt") ? "Alt" : null,
    modifiers.has("Shift") ? "Shift" : null,
    mac && modifiers.has("Mod") ? "Meta" : null,
  ].filter((name): name is string => name !== null);
  const key = rest[0]!;
  return [...names, key.length === 1 ? key.toUpperCase() : key].join("+");
}

const KEY_CODES: Record<string, string> = {
  ",": "Comma",
  ".": "Period",
  "'": "Quote",
  "[": "BracketLeft",
  "]": "BracketRight",
  "`": "Backquote",
  "/": "Slash",
  ";": "Semicolon",
  "-": "Minus",
  "=": "Equal",
  "\\": "Backslash",
  Space: "Space",
};
const KEYS_BY_CODE = new Map(Object.entries(KEY_CODES).map(([key, code]) => [code, key]));

function physicalCode(key: string): string | undefined {
  if (/^[0-9]$/.test(key)) return `Digit${key}`;
  if (/^[a-z]$/i.test(key)) return `Key${key.toUpperCase()}`;
  return KEY_CODES[key];
}

function keyMatches(event: KeyboardEvent, key: string) {
  const eventKey = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  const expected = key.length === 1 ? key.toLowerCase() : key;
  if (eventKey === expected) return true;
  // Fall back to physical keys when a modifier or non-Latin layout changes `event.key`,
  // for example Shift+. producing ">" or Option+1 producing "¡".
  if (/^[0-9]$/.test(key)) return event.code === `Digit${key}`;
  if (/^[a-z]$/i.test(key)) {
    return !/^[a-z]$/i.test(event.key) && event.code === `Key${key.toUpperCase()}`;
  }
  const code = KEY_CODES[key];
  return code !== undefined && event.code === code;
}

/**
 * Matches a keyboard event against a shortcut.
 *
 * `Mod` accepts either Ctrl or ⌘ so Palot's existing Ctrl and ⌘ bindings keep working on
 * every platform. `Control` requires Ctrl without ⌘. Alt shortcuts never match AltGr input
 * (Ctrl+Alt on Windows), and nothing matches while an IME composition is active.
 */
export function matchesShortcut(event: KeyboardEvent, keys: ShortcutKeys): boolean {
  if (event.isComposing || event.keyCode === 229) return false;
  const { modifiers, rest } = splitShortcut(keys);
  if (rest.length !== 1) return false;
  const wantsMod = modifiers.has("Mod");
  const wantsControl = modifiers.has("Control");
  const wantsAlt = modifiers.has("Alt");
  // Windows reports a physical Ctrl+Alt chord as AltGraph. Only explicit Ctrl/Mod+Alt
  // shortcuts accept it; other shortcuts must not fire while AltGr types a character.
  const ctrlAltChord = (wantsMod || wantsControl) && wantsAlt && event.ctrlKey && event.altKey;
  if (event.getModifierState?.("AltGraph") && !ctrlAltChord) return false;
  if (wantsMod) {
    if (!event.metaKey && !event.ctrlKey) return false;
    if (event.metaKey && event.ctrlKey) return false;
  } else if (wantsControl) {
    if (!event.ctrlKey || event.metaKey) return false;
  } else if (event.ctrlKey || event.metaKey) {
    return false;
  }
  if (event.altKey !== wantsAlt) return false;
  if (event.shiftKey !== modifiers.has("Shift")) return false;
  // An AltGraph chord may be AltGr typing a character (for example "[" on German layouts),
  // so it only counts when the physical key itself is the shortcut key.
  if (event.getModifierState?.("AltGraph")) return event.code === physicalCode(rest[0]!);
  return keyMatches(event, rest[0]!);
}

/** Returns 1–9 for an Alt+digit recent-task shortcut, otherwise null. */
export function recentTaskShortcutIndex(event: KeyboardEvent): number | null {
  if (event.isComposing || event.keyCode === 229) return null;
  if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return null;
  if (event.getModifierState?.("AltGraph")) return null;
  const match = /^Digit([1-9])$/.exec(event.code) ?? /^([1-9])$/.exec(event.key);
  return match ? Number(match[1]) : null;
}

// Personal bindings -----------------------------------------------------------------------

/** Personal bindings by catalog ID. `null` means the shortcut was cleared. */
export type ShortcutOverrides = Partial<Record<KeyboardShortcutID, ShortcutKeys | null>>;

const OVERRIDES_KEY = "keyboard-shortcuts";
let overrides: ShortcutOverrides | null = null;
let watchingStorage = false;
const overrideListeners = new Set<() => void>();

function currentOverrides(): ShortcutOverrides {
  if (!watchingStorage && typeof window !== "undefined") {
    // Other windows share these bindings through localStorage.
    watchingStorage = true;
    window.addEventListener("storage", onOverridesStorage);
  }
  overrides ??= sanitizeOverrides(
    loadPersistedValue<Record<string, unknown>>({
      key: OVERRIDES_KEY,
      initialValue: {},
      validate: (value): value is Record<string, unknown> =>
        Boolean(value) && typeof value === "object" && !Array.isArray(value),
    }),
  );
  return overrides;
}

function sanitizeOverrides(value: Record<string, unknown>): ShortcutOverrides {
  const result: ShortcutOverrides = {};
  for (const [id, keys] of Object.entries(value)) {
    const shortcut = SHORTCUTS_BY_ID.get(id as KeyboardShortcutID);
    if (!shortcut || shortcut.locked) continue;
    if (keys === null) {
      if (!shortcut.required) result[shortcut.id] = null;
      continue;
    }
    if (!Array.isArray(keys) || !keys.every((key) => typeof key === "string")) continue;
    if (splitShortcut(keys).rest.length !== 1) continue;
    result[shortcut.id] = Object.freeze([...keys]);
  }
  return result;
}

function commitOverrides(next: ShortcutOverrides): void {
  overrides = next;
  if (Object.keys(next).length === 0) removePersistedValue(OVERRIDES_KEY);
  else savePersistedValue(OVERRIDES_KEY, next);
  for (const listener of overrideListeners) listener();
}

function onOverridesStorage(event: StorageEvent): void {
  if (event.key !== null && event.key !== persistedStorageKey(OVERRIDES_KEY)) return;
  overrides = null;
  for (const listener of overrideListeners) listener();
}

export function shortcutOverrides(): ShortcutOverrides {
  return currentOverrides();
}

export function isShortcutCustomized(id: KeyboardShortcutID): boolean {
  return currentOverrides()[id] !== undefined;
}

/** Saves a personal binding. `null` clears the shortcut; the default keys reset it. */
export function setShortcutBinding(id: KeyboardShortcutID, keys: ShortcutKeys | null): void {
  const shortcut = keyboardShortcut(id);
  if (shortcut.locked) throw new Error(`${shortcut.label} cannot be changed`);
  if (keys === null && shortcut.required) throw new Error(`${shortcut.label} needs a shortcut`);
  const next = { ...currentOverrides() };
  if (keys !== null && sameShortcut(keys, shortcut.keys)) delete next[id];
  else next[id] = keys === null ? null : Object.freeze([...keys]);
  commitOverrides(next);
}

export function resetShortcutBinding(id: KeyboardShortcutID): void {
  if (currentOverrides()[id] === undefined) return;
  const next = { ...currentOverrides() };
  delete next[id];
  commitOverrides(next);
}

export function resetShortcutBindings(): void {
  commitOverrides({});
}

export function subscribeShortcutBindings(listener: () => void): () => void {
  overrideListeners.add(listener);
  return () => {
    overrideListeners.delete(listener);
  };
}

/** Re-renders when any personal binding changes; returns the current overrides. */
export function useShortcutOverrides(): ShortcutOverrides {
  return useSyncExternalStore(subscribeShortcutBindings, currentOverrides, currentOverrides);
}

/** The effective binding for display; re-renders when it changes. */
export function useShortcutKeys(id: KeyboardShortcutID): ShortcutKeys {
  const read = () => shortcutKeys(id);
  return useSyncExternalStore(subscribeShortcutBindings, read, read);
}

// Recording, validation and conflicts -------------------------------------------------------

const RECORDING_IGNORED_KEYS = new Set([
  "Shift",
  "Control",
  "Alt",
  "Meta",
  "AltGraph",
  "CapsLock",
  "Fn",
  "FnLock",
  "Hyper",
  "Super",
  "OS",
]);
const UNKNOWN_KEYS = new Set(["Dead", "Unidentified", "Process"]);

function recordedKey(event: KeyboardEvent): string | null {
  if (RECORDING_IGNORED_KEYS.has(event.key)) return null;
  // Follow the typed letter so AZERTY and Dvorak bindings match what the keycap shows.
  if (/^[a-z]$/i.test(event.key)) return event.key.toUpperCase();
  const letter = /^Key([A-Z])$/.exec(event.code)?.[1];
  if (letter) return letter;
  const digit = /^Digit([0-9])$/.exec(event.code)?.[1];
  if (digit) return digit;
  const physical = KEYS_BY_CODE.get(event.code);
  if (physical) return physical;
  if (event.key === " ") return "Space";
  return event.key.length > 0 && !UNKNOWN_KEYS.has(event.key) ? event.key : null;
}

/**
 * Converts a key press into catalog keys, or `null` while only modifiers are held.
 * Command (and the Super key outside macOS) records as `Mod`, matching `matchesShortcut`.
 */
export function shortcutFromKeyboardEvent(
  event: KeyboardEvent,
  platform?: string,
): ShortcutKeys | null {
  if (event.isComposing || event.keyCode === 229) return null;
  const key = recordedKey(event);
  if (!key) return null;
  const mac = shortcutPlatform(platform) === "mac";
  const keys: ShortcutKey[] = [];
  if (mac ? event.metaKey : event.ctrlKey || event.metaKey) keys.push("Mod");
  if (mac && event.ctrlKey) keys.push("Control");
  if (event.altKey) keys.push("Alt");
  if (event.shiftKey) keys.push("Shift");
  keys.push(key);
  return keys;
}

/** Normalized identity of a binding; Control and Mod fold together because `Mod` accepts Ctrl. */
function shortcutSignature(keys: ShortcutKeys): string | null {
  const { modifiers, rest } = splitShortcut(keys);
  if (rest.length !== 1) return null;
  if (modifiers.delete("Control")) modifiers.add("Mod");
  const key = rest[0]!.length === 1 ? rest[0]!.toLowerCase() : rest[0]!;
  return [...MAC_MODIFIER_ORDER.filter((modifier) => modifiers.has(modifier)), key].join("+");
}

function sameShortcut(left: ShortcutKeys, right: ShortcutKeys): boolean {
  const signature = shortcutSignature(left);
  return signature !== null && signature === shortcutSignature(right);
}

const ALL_SCOPES: readonly KeyboardShortcutScope[] = [
  "global",
  "composer",
  "task-view",
  "changes",
  "task-list",
];
const OVERLAPPING_SCOPES: Record<KeyboardShortcutScope, readonly KeyboardShortcutScope[]> = {
  global: ALL_SCOPES,
  composer: ["global", "composer", "task-view"],
  "task-view": ["global", "composer", "task-view"],
  changes: ["global", "changes"],
  "task-list": ["global", "task-list"],
};

/** Other catalog entries whose effective binding would receive the same key press. */
export function shortcutConflicts(id: KeyboardShortcutID, keys: ShortcutKeys): KeyboardShortcut[] {
  const signature = shortcutSignature(keys);
  if (!signature) return [];
  const shortcut = keyboardShortcut(id);
  const scopes = OVERLAPPING_SCOPES[shortcutScope(shortcut)];
  return KEYBOARD_SHORTCUTS.filter(
    (other) =>
      other.id !== id &&
      other.sharesKeysWith !== id &&
      shortcut.sharesKeysWith !== other.id &&
      scopes.includes(shortcutScope(other)) &&
      shortcutSignature(shortcutKeys(other.id)) === signature,
  );
}

// Electron's edit and window menus own these on every platform; app menu items only on macOS.
const SYSTEM_SHORTCUTS: readonly { keys: ShortcutKeys; label: string; macOnly?: boolean }[] = [
  { keys: ["Mod", "C"], label: "Copy" },
  { keys: ["Mod", "X"], label: "Cut" },
  { keys: ["Mod", "V"], label: "Paste" },
  { keys: ["Mod", "A"], label: "Select all" },
  { keys: ["Mod", "Z"], label: "Undo" },
  { keys: ["Mod", "Shift", "Z"], label: "Redo" },
  { keys: ["Mod", "W"], label: "Close window or workbench tab" },
  { keys: ["Mod", "M"], label: "Minimize" },
  { keys: ["Mod", "Q"], label: "Quit", macOnly: true },
  { keys: ["Mod", "H"], label: "Hide Palot", macOnly: true },
];

const FUNCTION_KEY = /^F([1-9]|1[0-9]|2[0-4])$/;

/** Explains why a recorded binding can't be saved, or returns `null` when it can. */
export function shortcutBindingProblem(
  id: KeyboardShortcutID,
  keys: ShortcutKeys,
  platform?: string,
): string | null {
  const shortcut = keyboardShortcut(id);
  if (shortcut.locked) return shortcut.locked;
  const mac = shortcutPlatform(platform) === "mac";
  const { modifiers, rest } = splitShortcut(keys);
  if (rest.length !== 1) return "Press one key together with modifiers.";
  // Function keys don't type text, so they work without a modifier.
  if (!modifiers.has("Mod") && !modifiers.has("Control") && !FUNCTION_KEY.test(rest[0]!)) {
    return mac
      ? "Include ⌘ or ⌃ so typing isn't interrupted."
      : "Include Ctrl so typing isn't interrupted.";
  }
  if (
    shortcutScope(shortcut) === "global" &&
    modifiers.has("Alt") &&
    !sameShortcut(keys, shortcut.keys)
  ) {
    return `${mac ? "⌥" : "Alt"} isn't available for shortcuts that work everywhere.`;
  }
  const system = SYSTEM_SHORTCUTS.find(
    (candidate) => (mac || !candidate.macOnly) && sameShortcut(candidate.keys, keys),
  );
  if (system) return `${formatShortcut(keys, platform)} is reserved for ${system.label}.`;
  // A locked shortcut cannot give up its keys, so Replace would have nothing to clear.
  const locked = shortcutConflicts(id, keys).find((other) => other.locked);
  if (locked)
    return `${formatShortcut(keys, platform)} is used by ${locked.label}, which can't be changed.`;
  return null;
}
