/**
 * What one row shows, as data: the row component renders these fields and decides nothing
 * about grouping or idle forms itself.
 */

import { effectiveIdleRows, type Grouping, type IdleRows, type RowLines } from "./sections";
import type { Placement, TaskStatus } from "./status";

export interface RowFields {
  /** A small project mark before the title (every row, so titles stay aligned). */
  mark: boolean;
  /** The one thing in the trailing slot. */
  trailing: "status" | "snoozed" | "time" | "project-time";
  /** Line 2: nothing, the status sentence, the wake time, or where the task belongs. */
  second: "none" | "status" | "until" | "project-branch" | "branch";
  /** Muted context on the right of a status line. */
  context: "none" | "project-branch" | "branch";
}

export function rowFields({
  status,
  placement,
  lines,
  grouping,
  idleRows,
}: {
  status: TaskStatus;
  placement: Placement;
  lines: RowLines;
  grouping: Grouping;
  idleRows: IdleRows;
}): RowFields {
  const form = effectiveIdleRows(idleRows, grouping);
  const idle = status.kind === "idle" && placement !== "snoozed";
  const trailing =
    placement === "snoozed"
      ? "snoozed"
      : status.rank <= 7
        ? "status"
        : idle && form === "inline"
          ? "project-time"
          : "time";
  const second =
    lines < 2
      ? "none"
      : placement === "snoozed"
        ? "until"
        : idle
          ? grouping === "project"
            ? "branch"
            : "project-branch"
          : "status";
  const context = second !== "status" ? "none" : grouping === "inbox" ? "project-branch" : "branch";
  return { mark: form === "mark", trailing, second, context };
}
