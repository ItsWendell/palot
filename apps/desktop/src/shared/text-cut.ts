/**
 * Cuts text to a length without splitting a character a person sees as one: an emoji with skin
 * tone, a flag, a family joined with ZWJ, a letter with combining marks. Lengths count UTF-16 code
 * units, like `.length`, so a cut is never longer than the plain `.slice` it replaces; it can be
 * shorter by the part of the character at the cut. Without `Intl.Segmenter` only surrogate pairs
 * are kept whole.
 */

const graphemes =
  typeof Intl !== "undefined" && "Segmenter" in Intl
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : null;

/** Code units read on each side of a cut; segmenting all of a long text costs a copy of it. */
const WINDOW = 256;

/** Whether code unit `index` starts a regional indicator, half of a flag. */
function regionalIndicatorAt(text: string, index: number): boolean {
  const code = text.codePointAt(index) ?? 0;
  return code >= 0x1f1e6 && code <= 0x1f1ff;
}

/**
 * The grapheme containing code unit `index`. A window around the cut gives the same answer as
 * the whole text unless the grapheme reaches either edge of the window or the window starts inside
 * a run of flags, whose pairing depends on what came before; then the whole text is segmented.
 */
function graphemeAt(segmenter: Intl.Segmenter, text: string, index: number) {
  const from = Math.max(0, index - WINDOW);
  const to = Math.min(text.length, index + WINDOW);
  if (from > 0 && !regionalIndicatorAt(text, from) && !regionalIndicatorAt(text, from - 1)) {
    const segment = segmenter.segment(text.slice(from, to)).containing(index - from);
    if (
      segment &&
      segment.index > 0 &&
      (to === text.length || segment.index + segment.segment.length < to - from)
    )
      return { index: from + segment.index, length: segment.segment.length };
  }
  const segment = segmenter.segment(text).containing(index);
  return segment ? { index: segment.index, length: segment.segment.length } : null;
}

/** The start of the grapheme that contains code unit `index`. */
function graphemeStart(text: string, index: number): number {
  if (graphemes) return graphemeAt(graphemes, text, index)?.index ?? index;
  const code = text.charCodeAt(index);
  const previous = text.charCodeAt(index - 1);
  return code >= 0xdc00 && code <= 0xdfff && previous >= 0xd800 && previous <= 0xdbff
    ? index - 1
    : index;
}

/** The first at most `limit` code units of `text`, ending between two graphemes. */
export function cutHead(text: string, limit: number): string {
  if (text.length <= limit) return text;
  if (limit <= 0) return "";
  return text.slice(0, graphemeStart(text, limit));
}

/** The last at most `limit` code units of `text`, starting between two graphemes. */
export function cutTail(text: string, limit: number): string {
  if (text.length <= limit) return text;
  if (limit <= 0) return "";
  const start = text.length - limit;
  const boundary = graphemeStart(text, start);
  if (boundary === start) return text.slice(start);
  // The grapheme at the cut started before it; drop the rest of it.
  const segment = graphemes ? graphemeAt(graphemes, text, start) : null;
  return text.slice(segment ? segment.index + segment.length : start + 1);
}

/** `text`, or its head and `ellipsis` within `limit` code units in all. */
export function truncateEnd(text: string, limit: number, ellipsis = "…"): string {
  return text.length <= limit ? text : `${cutHead(text, limit - ellipsis.length)}${ellipsis}`;
}

/** `text`, or its head and tail around `ellipsis`, within `limit` code units in all. */
export function truncateMiddle(text: string, limit: number, ellipsis = "…"): string {
  if (text.length <= limit) return text;
  const room = Math.max(0, limit - ellipsis.length);
  const tail = cutTail(text, Math.floor(room / 2));
  return `${cutHead(text, room - tail.length)}${ellipsis}${tail}`;
}

/** `text` split so the second part is its last at most `tailLength` code units. */
export function splitTail(text: string, tailLength: number): { head: string; tail: string } {
  const tail = cutTail(text, tailLength);
  return { head: text.slice(0, text.length - tail.length), tail };
}
