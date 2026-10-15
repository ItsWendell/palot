import {
  matchesShortcut,
  shortcutKeys,
  type KeyboardShortcutID,
  type ShortcutKeys,
} from "./keyboard-shortcuts";

export type ComposerShortcut =
  | "model"
  | "reasoning-cycle"
  | "agent-next"
  | "agent-previous"
  | "attach"
  | "shell-mode"
  | "normal-mode";

const COMPOSER_SHORTCUT_IDS: Record<ComposerShortcut, KeyboardShortcutID> = {
  model: "composer.model",
  "reasoning-cycle": "composer.reasoning.cycle",
  "agent-next": "composer.agent.next",
  "agent-previous": "composer.agent.previous",
  attach: "composer.attach",
  "shell-mode": "composer.shell.enter-key",
  "normal-mode": "composer.shell.exit-key",
};

const COMPOSER_SHORTCUTS = Object.entries(COMPOSER_SHORTCUT_IDS) as [
  ComposerShortcut,
  KeyboardShortcutID,
][];

/** Effective composer bindings, read on access so personal bindings apply immediately. */
export const COMPOSER_SHORTCUT_KEYS = Object.defineProperties(
  {} as Record<ComposerShortcut, ShortcutKeys>,
  Object.fromEntries(
    COMPOSER_SHORTCUTS.map(([shortcut, id]) => [
      shortcut,
      { enumerable: true, get: () => shortcutKeys(id) },
    ]),
  ),
);

export function matchComposerShortcut(event: KeyboardEvent): ComposerShortcut | null {
  return COMPOSER_SHORTCUTS.find(([, id]) => matchesShortcut(event, shortcutKeys(id)))?.[0] ?? null;
}
