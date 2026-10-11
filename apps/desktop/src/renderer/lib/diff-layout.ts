import type { FileDiffMetadata } from "@pierre/diffs";

export type DiffLayoutPreference = "auto" | "split" | "unified";
export type DiffLayout = "split" | "unified";

/** Narrower diff areas leave each split column too little room for typical code lines. */
export const AUTO_SPLIT_MIN_WIDTH = 900;

/**
 * True when some change replaces lines (a block with both removals and additions).
 * Pure additions, pure deletions, and files whose changes never pair up read better
 * unified: split would leave one column empty.
 */
export function hasTwoSidedChanges(diff: FileDiffMetadata | null | undefined): boolean {
  if (!diff) return false;
  return diff.hunks.some((hunk) =>
    hunk.hunkContent.some(
      (content) => content.type === "change" && content.additions > 0 && content.deletions > 0,
    ),
  );
}

/**
 * Auto splits when the diff area is at least {@link AUTO_SPLIT_MIN_WIDTH} wide and the
 * shown changes include replaced lines; otherwise it stays unified. Explicit choices win.
 */
export function resolveDiffLayout(
  preference: DiffLayoutPreference,
  { width, twoSided }: { width: number; twoSided: boolean },
): DiffLayout {
  if (preference !== "auto") return preference;
  return width >= AUTO_SPLIT_MIN_WIDTH && twoSided ? "split" : "unified";
}
