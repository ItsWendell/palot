import { useCallback, useLayoutEffect, useRef, type RefObject } from "react";
import type { TranscriptProjectionRow } from "../lib/turn-projection";

/** Prompts (steers included) and responses carry their message ID, which survives regrouping. */
const MESSAGE_ANCHOR_SELECTOR = "[data-palot-prompt-id], [data-palot-response-message]";
const STABLE_FRAMES = 8;
const SETTLE_MS = 1_000;

/**
 * Where the reader was when an older page was requested, as offsets from the viewport top.
 *
 * A turn's ID is its first message's ID, so an older page that completes the first loaded turn
 * gives that turn a new ID. The anchor therefore prefers a prompt or response inside the turn,
 * and also remembers the following turn: the regrouped turn is the one right before it.
 */
export interface TranscriptPrependAnchor {
  turnID: string;
  nextTurnID: string | null;
  turnTop: number;
  turnBottom: number;
  message: { selector: string; top: number } | null;
  /** Turns on screen, kept mounted while the page is applied so no blank frame shows. */
  visibleTurnIDs: string[];
  historyStartID: string | null;
  firstTurnID: string | null;
}

interface MountedTurn {
  element: HTMLElement;
  rect: DOMRect;
  index: number;
}

function mountedTurns(viewport: HTMLElement, rows: readonly TranscriptProjectionRow[]) {
  return Array.from(viewport.querySelectorAll<HTMLElement>("[data-turn-row-id]"))
    .map((element) => ({
      element,
      rect: element.getBoundingClientRect(),
      index: rows.findIndex((row) => row.id === element.dataset.turnRowId),
    }))
    .filter((turn) => turn.index >= 0)
    .toSorted((left, right) => left.rect.top - right.rect.top);
}

/**
 * Reads the reader's position before an older page is applied. The anchor is the first prompt or
 * response that starts on screen, else the one that spans the top edge, else the turn at the top.
 */
export function readTranscriptPrependAnchor(input: {
  viewport: HTMLElement;
  rows: readonly TranscriptProjectionRow[];
  hasMore: boolean;
  bottomInset: number;
  historyStartID: string | null;
}): TranscriptPrependAnchor | null {
  const { viewport, rows } = input;
  const bounds = viewport.getBoundingClientRect();
  const top = bounds.top;
  // The composer dock covers the bottom of the transcript.
  const bottom = Math.max(top + 1, bounds.bottom - input.bottomInset);
  const turns = mountedTurns(viewport, rows);
  if (turns.length === 0) return null;
  const onScreen = turns.filter((turn) => turn.rect.bottom > top && turn.rect.top < bottom);
  const messages = Array.from(viewport.querySelectorAll<HTMLElement>(MESSAGE_ANCHOR_SELECTOR))
    .flatMap((element) => {
      const turnElement = element.closest<HTMLElement>("[data-turn-row-id]");
      const turn = onScreen.find((candidate) => candidate.element === turnElement);
      if (!turn) return [];
      const promptID = element.dataset.palotPromptId;
      // An older page can complete the first turn, and its opening prompt then becomes a steer
      // with a label above it. Anchor to something else in that turn when there is a choice.
      if (promptID && input.hasMore && turn.index === 0 && rows[0]?.turn.user?.id === promptID)
        return [];
      const rect = element.getBoundingClientRect();
      if (rect.height <= 0 || rect.bottom <= top || rect.top >= bottom) return [];
      const selector = promptID
        ? `[data-palot-prompt-id="${CSS.escape(promptID)}"]`
        : `[data-palot-response-message="${CSS.escape(element.dataset.palotResponseMessage ?? "")}"]`;
      return [{ rect, turn, selector }];
    })
    .toSorted((left, right) => left.rect.top - right.rect.top);
  const message =
    messages.find((candidate) => candidate.rect.top >= top) ??
    messages.findLast((candidate) => candidate.rect.top < top);
  const turn: MountedTurn =
    message?.turn ??
    onScreen[0] ??
    turns.find((candidate) => candidate.rect.top >= top) ??
    turns.at(-1)!;
  return {
    turnID: rows[turn.index]!.id,
    nextTurnID: rows[turn.index + 1]?.id ?? null,
    turnTop: turn.rect.top - top,
    turnBottom: turn.rect.bottom - top,
    message: message ? { selector: message.selector, top: message.rect.top - top } : null,
    visibleTurnIDs: onScreen.map((candidate) => rows[candidate.index]!.id),
    historyStartID: input.historyStartID,
    firstTurnID: rows[0]?.id ?? null,
  };
}

/**
 * The anchor's turn in `rows`. When its ID is gone, an older page completed it and it is the turn
 * right before the one that followed it; it then grew at its top, so its bottom edge holds.
 */
export function resolveTranscriptPrependAnchor(
  anchor: Pick<TranscriptPrependAnchor, "turnID" | "nextTurnID">,
  rows: readonly TranscriptProjectionRow[],
): { index: number; regrouped: boolean } | null {
  const same = rows.findIndex((row) => row.id === anchor.turnID);
  if (same >= 0) return { index: same, regrouped: false };
  if (anchor.nextTurnID) {
    const next = rows.findIndex((row) => row.id === anchor.nextTurnID);
    return next > 0 ? { index: next - 1, regrouped: true } : null;
  }
  return rows.length > 0 ? { index: rows.length - 1, regrouped: true } : null;
}

/** Whether the older page has reached the rendered rows. */
export function transcriptPrependApplied(
  anchor: Pick<TranscriptPrependAnchor, "historyStartID" | "firstTurnID">,
  rows: readonly TranscriptProjectionRow[],
  historyStartID: string | null,
): boolean {
  return historyStartID !== anchor.historyStartID || (rows[0]?.id ?? null) !== anchor.firstTurnID;
}

/**
 * How far the anchor has moved from where the reader saw it, in pixels; positive means it is
 * now lower on screen. Null when neither the message nor its turn is mounted.
 */
export function transcriptPrependAnchorDrift(
  anchor: TranscriptPrependAnchor,
  viewport: HTMLElement,
  rows: readonly TranscriptProjectionRow[],
): number | null {
  const top = viewport.getBoundingClientRect().top;
  if (anchor.message) {
    const element = viewport.querySelector<HTMLElement>(anchor.message.selector);
    const rect = element?.getBoundingClientRect();
    if (rect && rect.height > 0) return rect.top - top - anchor.message.top;
  }
  const resolved = resolveTranscriptPrependAnchor(anchor, rows);
  const row = resolved ? rows[resolved.index] : undefined;
  if (!resolved || !row) return null;
  const element = viewport.querySelector<HTMLElement>(`[data-turn-row-id="${CSS.escape(row.id)}"]`);
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  return resolved.regrouped
    ? rect.bottom - top - anchor.turnBottom
    : rect.top - top - anchor.turnTop;
}

/** The turns a held position keeps mounted. */
export type TranscriptPrependPin = Pick<
  TranscriptPrependAnchor,
  "turnID" | "nextTurnID" | "visibleTurnIDs"
>;

/** Row indexes to keep in the virtual range while a position is held. */
export function transcriptPrependPinnedIndexes(
  pin: TranscriptPrependPin | null,
  rows: readonly TranscriptProjectionRow[],
): number[] {
  if (!pin) return [];
  const resolved = resolveTranscriptPrependAnchor(pin, rows);
  return [
    ...new Set([
      ...(resolved ? [resolved.index] : []),
      ...pin.visibleTurnIDs
        .map((turnID) => rows.findIndex((row) => row.id === turnID))
        .filter((index) => index >= 0),
    ]),
  ];
}

type AnchorState = TranscriptPrependAnchor & {
  /** pending: the page is not applied yet; restoring: it is, and the position is being held. */
  phase: "pending" | "restoring";
  fetchedAt: number | null;
  restoredAt: number;
  stableFrames: number;
};

export type TranscriptPrependRelease =
  /** The reader scrolled. Before the page is applied, this only moves the anchor. */
  | "user"
  /** Navigation, a new submission or a failed page: stop holding the position. */
  | "cancel";

/**
 * Keeps the reader's place while an older page is prepended: record what they see before the
 * request, then, once the page is applied, scroll so it is where it was before that commit paints.
 */
export function useTranscriptPrependAnchor(input: {
  viewport: RefObject<HTMLElement | null>;
  rows: readonly TranscriptProjectionRow[];
  historyStartID: string | null;
  hasMore: boolean;
  bottomInset: number;
  /** Changes when the virtual layout changes, such as its measured total height. */
  layoutVersion: unknown;
  /** Called before the hook scrolls, so the scroll is not taken for the reader's own. */
  willScroll(): void;
  didScroll(scrollTop: number): void;
  /** Receives the turns to keep mounted, or null once the position is released. */
  pin(pin: TranscriptPrependPin | null): void;
}) {
  const state = useRef<AnchorState | null>(null);
  const frame = useRef(0);
  const pinned = useRef<TranscriptPrependPin | null>(null);
  const latest = useRef(input);
  latest.current = input;

  const release = useCallback((reason: TranscriptPrependRelease) => {
    const current = state.current;
    if (!current) return;
    if (reason === "user" && current.phase === "pending") return;
    cancelAnimationFrame(frame.current);
    state.current = null;
    setPin(null);
  }, []);

  const read = () => {
    const { viewport, rows, hasMore, bottomInset, historyStartID } = latest.current;
    return viewport.current
      ? readTranscriptPrependAnchor({
          viewport: viewport.current,
          rows,
          hasMore,
          bottomInset,
          historyStartID,
        })
      : null;
  };

  function setPin(next: TranscriptPrependPin | null) {
    const current = pinned.current;
    if (
      current === next ||
      (current &&
        next &&
        current.turnID === next.turnID &&
        current.nextTurnID === next.nextTurnID &&
        current.visibleTurnIDs.join("\0") === next.visibleTurnIDs.join("\0"))
    )
      return;
    pinned.current = next;
    latest.current.pin(next);
  }

  const updatePin = (anchor: TranscriptPrependAnchor) =>
    setPin({
      turnID: anchor.turnID,
      nextTurnID: anchor.nextTurnID,
      visibleTurnIDs: anchor.visibleTurnIDs,
    });

  /** Records the reader's place before an older page is requested. */
  const capture = useCallback((): boolean => {
    cancelAnimationFrame(frame.current);
    const anchor = read();
    if (!anchor) {
      state.current = null;
      setPin(null);
      return false;
    }
    state.current = {
      ...anchor,
      phase: "pending",
      fetchedAt: null,
      restoredAt: 0,
      stableFrames: 0,
    };
    updatePin(anchor);
    return true;
  }, []);

  /** The reader scrolled while the page is loading: hold their new place instead. */
  const readerMoved = useCallback(() => {
    const current = state.current;
    if (current?.phase !== "pending") return;
    const anchor = read();
    if (!anchor) return;
    // Keep what the request saw as the history start, which decides when the page is applied.
    state.current = {
      ...current,
      ...anchor,
      historyStartID: current.historyStartID,
      firstTurnID: current.firstTurnID,
    };
    updatePin(anchor);
  }, []);

  const hold = (): boolean => {
    const current = state.current;
    const viewport = latest.current.viewport.current;
    if (!current || current.phase !== "restoring" || !viewport) return false;
    const drift = transcriptPrependAnchorDrift(current, viewport, latest.current.rows);
    if (drift !== null && Math.abs(drift) > 0.5) {
      latest.current.willScroll();
      viewport.scrollTop += drift;
      latest.current.didScroll(viewport.scrollTop);
      current.stableFrames = 0;
    } else if (drift !== null) {
      current.stableFrames += 1;
    }
    if (
      current.stableFrames >= STABLE_FRAMES ||
      performance.now() - current.restoredAt >= SETTLE_MS
    ) {
      release("cancel");
      return false;
    }
    return true;
  };

  const tick = () => {
    const current = state.current;
    if (!current) return;
    if (current.phase === "pending") {
      // A page that changed nothing on screen leaves nothing to hold.
      if (current.fetchedAt !== null && performance.now() - current.fetchedAt >= SETTLE_MS) {
        release("cancel");
        return;
      }
    } else if (!hold()) return;
    frame.current = requestAnimationFrame(tick);
  };

  /** The page request finished; if its rows never change the transcript, let go. */
  const fetched = useCallback(() => {
    const current = state.current;
    if (!current || current.phase !== "pending") return;
    current.fetchedAt = performance.now();
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(tick);
  }, []);

  useLayoutEffect(() => {
    const current = state.current;
    if (!current) return;
    if (current.phase === "pending") {
      if (!transcriptPrependApplied(current, input.rows, input.historyStartID)) return;
      current.phase = "restoring";
      current.restoredAt = performance.now();
    }
    // Correct in the commit that applied the page (or changed its layout), before it paints.
    cancelAnimationFrame(frame.current);
    if (hold()) frame.current = requestAnimationFrame(tick);
  }, [input.rows, input.historyStartID, input.layoutVersion]);

  useLayoutEffect(() => () => cancelAnimationFrame(frame.current), []);

  return {
    capture,
    release,
    readerMoved,
    fetched,
    isHolding: useCallback(() => state.current !== null, []),
  };
}
