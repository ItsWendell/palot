import type { SessionExecutionState, SessionRuntimeStatus } from "../atoms/workspace";
import type { TranscriptProjectionRow } from "./turn-projection";

export const ASK_FOR_REVIEW_PROMPT =
  "Review the changes you made in the previous turn for bugs, regressions and missed edge cases. " +
  "List concrete problems with file and line references and how you would fix each one. " +
  "Don't edit any files yet.";

/**
 * The prompt whose turn may offer a review: the latest settled user turn while the task is
 * idle. Whether that turn changed files is decided by its turn diff, not here.
 */
export function reviewOfferUserMessageID(
  rows: readonly TranscriptProjectionRow[],
  execution: SessionExecutionState | null,
  runtimeStatus: SessionRuntimeStatus | null,
): string | null {
  if (execution?.status === "running") return null;
  if (runtimeStatus?.type === "busy" || runtimeStatus?.type === "retry") return null;
  if (rows.some((row) => row.turn.status === "working")) return null;
  const user = rows.findLast((row) => row.turn.user !== null)?.turn.user;
  if (!user || user.optimistic === true) return null;
  return user.id;
}
