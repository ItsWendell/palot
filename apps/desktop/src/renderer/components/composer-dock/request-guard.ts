/**
 * When a request may take over the composer's Enter and its text field.
 *
 * - A request that arrives while the user is typing (or within 1.5 s of their last keystroke)
 *   waits for a pause before Enter answers it.
 * - A draft that existed when the request arrived never becomes feedback: the field and the
 *   primary button stay the message's, and the request panel brings its own feedback input.
 *   Only an empty field doubles as "Tell the agent what to do differently…".
 */

/** How long after the last keystroke a request waits before Enter answers it. */
export const ENTER_GUARD_MS = 1_500;

interface RequestGuardInput {
  /** When the request became visible. */
  shownAt: number;
  /** The last keystroke in the composer, or null when there was none. */
  lastKeystrokeAt: number | null;
  now: number;
  /** Whether the text field held a draft (text or attachments) when the request arrived. */
  draftAtArrival: boolean;
}

export interface RequestGuard {
  /** What the text field is for: the request's feedback or answer, or the user's message. */
  field: "feedback" | "message";
  /** Whether the typing pause has passed. */
  armed: boolean;
  /** Whether Enter in the text field answers the request. */
  ownsEnter: boolean;
  /** When `armed` turns true, for a timer; null once armed. */
  armsAt: number | null;
}

export function requestGuard({
  shownAt,
  lastKeystrokeAt,
  now,
  draftAtArrival,
}: RequestGuardInput): RequestGuard {
  const field = draftAtArrival ? "message" : "feedback";
  // A request that arrived during a pause is ready at once; one that arrived mid-typing
  // waits until the typing stops for the guard's length.
  const armed =
    lastKeystrokeAt === null ||
    shownAt - lastKeystrokeAt >= ENTER_GUARD_MS ||
    now - lastKeystrokeAt >= ENTER_GUARD_MS;
  return {
    field,
    armed,
    ownsEnter: field === "feedback" && armed,
    armsAt: armed || lastKeystrokeAt === null ? null : lastKeystrokeAt + ENTER_GUARD_MS,
  };
}
