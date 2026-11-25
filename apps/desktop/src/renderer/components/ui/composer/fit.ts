/**
 * Pure fitting rules for the composer's measured rows: the tabs on the card's top edge and
 * the control row. They take measured widths and return what to show, so the components
 * only measure and the rules can be tested without layout.
 */

/** A row only grows back when it has this much spare room, so it never flickers at the edge. */
const FIT_HYSTERESIS_PX = 1;

/**
 * How many items fit in `available`, in order. When some must fold, room is kept for the
 * overflow trigger. Growing back past `previous` needs one spare pixel. At least one item
 * always shows.
 */
export function fitCount(
  widths: readonly number[],
  available: number,
  gap: number,
  overflowWidth: number,
  previous = widths.length,
): number {
  const slack = (count: number) => (count > previous ? FIT_HYSTERESIS_PX : 0);
  const total = widths.reduce((sum, width, index) => sum + width + (index ? gap : 0), 0);
  if (total <= available - slack(widths.length)) return widths.length;
  let used = overflowWidth;
  let count = 0;
  for (const width of widths) {
    const next = used + gap + width;
    if (next > available - slack(count + 1)) break;
    used = next;
    count++;
  }
  return Math.max(1, Math.min(count, widths.length));
}

/**
 * Which items show and which fold, given how many fit. The open item always shows: when it
 * would fold, it takes the last visible place and the item there folds instead.
 */
export function splitVisible(
  total: number,
  fitting: number,
  openIndex: number,
): { shown: number[]; folded: number[] } {
  const all = Array.from({ length: total }, (_, index) => index);
  let shown = all.slice(0, fitting);
  let folded = all.slice(fitting);
  if (openIndex >= 0 && folded.includes(openIndex) && shown.length) {
    const displaced = shown.at(-1)!;
    shown = [...shown.slice(0, -1), openIndex];
    folded = [...folded.filter((index) => index !== openIndex), displaced].toSorted(
      (a, b) => a - b,
    );
  }
  return { shown, folded };
}

/**
 * The control row's next level. Level 0 shows everything; level 1 drops labels; each
 * level above folds one more item into the overflow menu, lowest priority first.
 *
 * `natural` is the row's content width at `level`; `known` holds the widths measured at
 * other levels for the same content. A lower level is tried once when its width is
 * unknown; once measured, the row only steps down when it fits with a pixel to spare.
 */
export function nextFooterLevel(
  level: number,
  maxLevel: number,
  natural: number,
  available: number,
  known: ReadonlyMap<number, number>,
): number {
  // A row that overflows here overflows at every lower level too.
  if (natural > available) return Math.min(level + 1, maxLevel);
  if (level > 0) {
    const lower = known.get(level - 1);
    if (lower === undefined || lower <= available - FIT_HYSTERESIS_PX) return level - 1;
  }
  return level;
}

export interface FoldableItem {
  value: string;
  priority: number;
  /** Registration order; later items fold first among equal priorities. */
  order: number;
}

/** The values folded at `level`: none below level 2, then one more per level. */
export function foldedAt(items: readonly FoldableItem[], level: number): Set<string> {
  const order = items.toSorted((a, b) => a.priority - b.priority || b.order - a.order);
  return new Set(order.slice(0, Math.max(0, level - 1)).map((item) => item.value));
}
