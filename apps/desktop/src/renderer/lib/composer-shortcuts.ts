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

/**
 * What Enter does in the composer: `send` uses the default delivery, `steer` and `queue` are
 * Mod+Enter's alternate to it, `queue-first` (Alt+Enter while the agent works) queues the
 * message ahead of the other queued ones, and `null` leaves the key to the input (Shift+Enter
 * is a new line).
 */
export type ComposerEnterAction = "send" | "steer" | "queue" | "steer-first" | "queue-first" | null;

export interface ComposerEnterState {
  /** Nothing would be sent: no text, attachments, comments, or upload in flight. */
  empty: boolean;
  /** A turn is running in an existing task. */
  working: boolean;
  /** Undelivered prompts waiting with queue delivery. */
  queued: number;
  /** A queued prompt is open for editing in the composer, or opening. */
  editing: boolean;
  shell: boolean;
  submitting: boolean;
  /** The delivery Enter uses while the agent works; Mod+Enter sends the other one. */
  delivery: "queue" | "steer";
}

export function composerEnterAction(
  event: Pick<KeyboardEvent, "key" | "shiftKey" | "metaKey" | "ctrlKey"> & { altKey?: boolean },
  state: ComposerEnterState,
): ComposerEnterAction {
  if (event.key !== "Enter" || event.shiftKey) return null;
  // Alt+Enter on an idle task, or in shell mode, sends like Enter.
  if (event.altKey && !(event.metaKey || event.ctrlKey))
    return state.working && !state.shell ? "queue-first" : "send";
  if (!(event.metaKey || event.ctrlKey) || !state.working) return "send";
  // With nothing to send, the steer keys act on the queue instead of the composer.
  if (state.empty && state.queued > 0 && !state.editing && !state.shell && !state.submitting)
    return "steer-first";
  return state.delivery === "queue" ? "steer" : "queue";
}
