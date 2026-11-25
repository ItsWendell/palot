/**
 * What a key does to the open request, wherever focus is: in the composer's text field (the
 * caller routes its keydown here) or inside the request panel. Pure, so the editor, the panel
 * and the tests read the same rules. Escape never approves and never denies.
 */

import type { ShortcutKeys } from "@/lib/keyboard-shortcuts";
import type { RequestView } from "./types";

/** Built-in request keys. They are locked: the composer owns them while a request is open. */
export const REQUEST_SHORTCUTS = {
  deny: ["Mod", "Shift", "Backspace"],
  alwaysAllow: ["Mod", "Shift", "Enter"],
  previous: ["Alt", "ArrowUp"],
  next: ["Alt", "ArrowDown"],
  back: ["Alt", "ArrowLeft"],
} as const satisfies Record<string, ShortcutKeys>;

export type RequestKeyAction =
  | { type: "deny" }
  | { type: "always-allow" }
  | { type: "allow-once" }
  /** Deny, sending the text field's content as the reason. */
  | { type: "deny-with-feedback" }
  | { type: "page"; delta: -1 | 1 }
  | { type: "pick"; index: number }
  | { type: "back" }
  /** Go on: the next step, or submit on the last. */
  | { type: "next" };

export interface RequestKeyEvent {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  isComposing?: boolean;
}

interface RequestKeyContext {
  request: RequestView;
  /** How many requests are pending. */
  count: number;
  /** The question's current step. */
  step?: number;
  /** Whether the composer's text field is empty. */
  fieldEmpty: boolean;
  /** Whether Enter (and 1–9) in the text field answer the request; see `requestGuard`. */
  ownsEnter: boolean;
}

function modifiers(event: RequestKeyEvent) {
  return {
    mod: event.metaKey !== event.ctrlKey,
    shift: event.shiftKey,
    alt: event.altKey,
  };
}

export function requestKeyAction(
  event: RequestKeyEvent,
  { request, count, step = 0, fieldEmpty, ownsEnter }: RequestKeyContext,
): RequestKeyAction | null {
  if (event.isComposing) return null;
  const { mod, shift, alt } = modifiers(event);
  const plain = !mod && !shift && !alt && !event.metaKey && !event.ctrlKey;

  if (request.kind === "permission" && mod && shift && !alt) {
    if (event.key === "Backspace") return { type: "deny" };
    if (event.key === "Enter" && request.rule) return { type: "always-allow" };
  }
  if (alt && !mod && !shift && count > 1) {
    if (event.key === "ArrowUp") return { type: "page", delta: -1 };
    if (event.key === "ArrowDown") return { type: "page", delta: 1 };
  }
  if (alt && !mod && !shift && event.key === "ArrowLeft" && request.kind === "question") {
    return step > 0 ? { type: "back" } : null;
  }
  if (!plain || !ownsEnter) return null;

  if (event.key === "Enter") {
    if (request.kind === "permission") {
      return fieldEmpty ? { type: "allow-once" } : { type: "deny-with-feedback" };
    }
    if (request.kind === "question") return { type: "next" };
    return null;
  }
  if (request.kind === "question" && fieldEmpty && /^[1-9]$/.test(event.key)) {
    const index = Number(event.key) - 1;
    const options = request.steps[step]?.options.length ?? 0;
    return index < options ? { type: "pick", index } : null;
  }
  return null;
}
