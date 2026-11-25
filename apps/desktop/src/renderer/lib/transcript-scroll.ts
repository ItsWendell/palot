export const TRANSCRIPT_BOTTOM_THRESHOLD = 40;

/** Direction of a browser scroll key, excluding controls that own keyboard input. */
export function transcriptKeyboardScrollDelta(event: {
  key: string;
  target: EventTarget | null;
  defaultPrevented: boolean;
  shiftKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
}): number {
  if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return 0;
  const target = event.target instanceof Element ? event.target : null;
  if (
    target?.closest(
      'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="listbox"], [role="combobox"], [role="slider"], [role="spinbutton"], [role="tree"], [role="menu"], [role="tablist"], [role="grid"]',
    )
  )
    return 0;
  if (event.key === " " && target?.closest('button, [role="button"]')) return 0;
  if (["ArrowUp", "PageUp", "Home"].includes(event.key)) return -1;
  if (["ArrowDown", "PageDown", "End"].includes(event.key)) return 1;
  return event.key === " " ? (event.shiftKey ? -1 : 1) : 0;
}

/**
 * Direction of an unmodified PageUp/PageDown typed in the composer. As in chat apps, these
 * page the transcript even when the draft itself overflows. An open suggestion list keeps
 * the keys' native meaning, and so do modified page keys (Shift extends the selection).
 */
export function composerTranscriptPageDirection(event: {
  key: string;
  target: EventTarget | null;
  defaultPrevented: boolean;
  isComposing: boolean;
  shiftKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
}): -1 | 0 | 1 {
  if (event.key !== "PageUp" && event.key !== "PageDown") return 0;
  if (
    event.defaultPrevented ||
    event.isComposing ||
    event.shiftKey ||
    event.metaKey ||
    event.ctrlKey ||
    event.altKey
  )
    return 0;
  const input =
    event.target instanceof Element ? event.target.closest("[data-palot-composer-input]") : null;
  if (!input || input.getAttribute("aria-expanded") === "true") return 0;
  return event.key === "PageUp" ? -1 : 1;
}

/**
 * Scroll offset one page away: 80% of the transcript visible above the composer dock that
 * overlays its bottom, clamped to the scroll range. `from` continues a page scroll that is
 * still animating, so repeated presses add up.
 */
export function transcriptPageScrollTop(input: {
  metrics: TranscriptScrollMetrics;
  obscuredBottom: number;
  direction: -1 | 1;
  from?: number | null;
}): number {
  const { scrollTop, scrollHeight, clientHeight } = input.metrics;
  const visible =
    clientHeight - input.obscuredBottom > 0 ? clientHeight - input.obscuredBottom : clientHeight;
  const top = (input.from ?? scrollTop) + input.direction * visible * 0.8;
  return Math.min(Math.max(0, scrollHeight - clientHeight), Math.max(0, top));
}

export interface TranscriptScrollMetrics {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

export type TranscriptScrollIntent = "up" | "scrollbar" | "anchor" | null;

export interface TranscriptScrollFrame {
  current: number | null;
}

export function scheduleTranscriptScrollFrame(
  frame: TranscriptScrollFrame,
  callback: () => void,
): void {
  if (frame.current !== null) return;
  frame.current = requestAnimationFrame(() => {
    frame.current = null;
    callback();
  });
}

export function cancelTranscriptScrollFrame(frame: TranscriptScrollFrame): void {
  if (frame.current === null) return;
  cancelAnimationFrame(frame.current);
  frame.current = null;
}

export function transcriptDistanceFromBottom(metrics: TranscriptScrollMetrics): number {
  return Math.max(0, metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight);
}

/**
 * Whether sending a prompt takes the reader to the bottom. A reader who is following the bottom
 * goes along with the new prompt; one who has scrolled up (and so sees Scroll to bottom) stays
 * where they are. A transcript that fits its viewport has no place to keep, so it follows.
 */
export function transcriptSubmissionFollowsBottom(input: {
  locked: boolean;
  metrics: TranscriptScrollMetrics | null;
}): boolean {
  if (input.locked || !input.metrics) return true;
  return input.metrics.scrollHeight - input.metrics.clientHeight <= 1;
}

export function transcriptScrollTargetConsumesDelta(
  metrics: TranscriptScrollMetrics,
  delta: number,
): boolean {
  if (delta < 0) return metrics.scrollTop > 1;
  if (delta > 0) return transcriptDistanceFromBottom(metrics) > 1;
  return false;
}

export interface TranscriptBottomLockInput {
  current: boolean;
  metrics: TranscriptScrollMetrics;
  previousScrollTop: number | null;
  intent: TranscriptScrollIntent;
  threshold?: number;
}

/** Read geometry only when a scroll event can change the reader's bottom lock. */
export function readTranscriptScrollUpdate(
  input: TranscriptBottomLockInput,
): { locked: boolean; scrollTop: number } | null {
  // Programmatic bottom-follow/layout scrolls cannot unlock without user intent.
  // Reading even scrollTop here can force style/layout after intervening DOM writes.
  // Bottom-follow records its actual offset; scrollbar gestures capture their own start.
  if (input.current && input.intent === null) return null;
  return { locked: nextTranscriptBottomLock(input), scrollTop: input.metrics.scrollTop };
}

export function nextTranscriptBottomLock(input: TranscriptBottomLockInput): boolean {
  const threshold = input.threshold ?? TRANSCRIPT_BOTTOM_THRESHOLD;
  if (input.intent === "anchor" || input.intent === "up") return false;
  if (
    input.intent === "scrollbar" &&
    input.previousScrollTop !== null &&
    input.metrics.scrollTop < input.previousScrollTop
  ) {
    return false;
  }
  if (transcriptDistanceFromBottom(input.metrics) <= threshold) {
    if (input.current || input.previousScrollTop === null) return true;
    return input.metrics.scrollTop >= input.previousScrollTop;
  }
  return input.current;
}

/**
 * A wheel gesture that scrolls sideways, such as across a wide table or code block. Shift-wheel
 * scrolls sideways, and a trackpad swipe adds a little vertical noise, so it must neither leave
 * the live edge nor count as reading upward (which would load older history).
 */
export function transcriptWheelIsSideways(input: {
  deltaX: number;
  deltaY: number;
  shiftKey: boolean;
}): boolean {
  return input.shiftKey || Math.abs(input.deltaX) > Math.abs(input.deltaY);
}

export function normalizeTranscriptWheelDelta(input: {
  deltaY: number;
  deltaMode: number;
  viewportHeight: number;
}): number {
  if (input.deltaMode === 1) return input.deltaY * 40;
  if (input.deltaMode === 2) return input.deltaY * input.viewportHeight;
  return input.deltaY;
}

/** How close to the viewport a turn outside it must be to stay mounted ahead of scrolling. */
export const TRANSCRIPT_TURN_OVERSCAN_PX = 256;

/**
 * Turns to mount besides the visible range `startIndex … endIndex`: its neighbours whose near edge lies within
 * `distance` pixels of the viewport. A turn holds a prompt and its whole answer, so a count of neighbouring turns
 * would keep a full answer mounted offscreen however far away it is.
 */
export function nearTranscriptTurns(input: {
  startIndex: number;
  endIndex: number;
  items: readonly { start: number; end: number }[];
  scrollOffset: number;
  viewportHeight: number;
  distance?: number;
}): number[] {
  const distance = input.distance ?? TRANSCRIPT_TURN_OVERSCAN_PX;
  const near: number[] = [];
  const before = input.items[input.startIndex - 1];
  if (before && input.scrollOffset - before.end <= distance) near.push(input.startIndex - 1);
  const after = input.items[input.endIndex + 1];
  if (after && after.start - (input.scrollOffset + input.viewportHeight) <= distance)
    near.push(input.endIndex + 1);
  return near;
}
