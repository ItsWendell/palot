/**
 * The View menu's three knobs, and the prototype's experiments that override them. Both
 * resolve to plain layout parameters of the one list and the one row; nothing downstream
 * knows which knob or experiment asked for what.
 */

import type { ApprovalLines, Grouping, IdleRows, WorkingPlacement } from "./sections";

export type WorkingKnob = WorkingPlacement;
export type RowDetail = "compact" | "comfortable";

export interface ViewKnobs {
  grouping: Grouping;
  working: WorkingKnob;
  rowDetail: RowDetail;
}

/** Prototype-only alternatives; they would not ship unless chosen. */
export interface Experiments {
  idleRows: Extract<IdleRows, "mark" | "title"> | null;
  /** Null: the shipped rule, four lines at 300 px or less. */
  approvalLines: ApprovalLines | null;
}

export const DEFAULT_VIEW: ViewKnobs = {
  grouping: "inbox",
  working: "dock",
  rowDetail: "compact",
};
export const NO_EXPERIMENTS: Experiments = {
  idleRows: null,
  approvalLines: null,
};

export const GROUPING_CHOICES: readonly { value: Grouping; label: string }[] = [
  { value: "inbox", label: "Inbox" },
  { value: "project", label: "Project" },
  { value: "server", label: "Server" },
];
export const WORKING_CHOICES: readonly { value: WorkingKnob; label: string }[] = [
  { value: "dock", label: "Docked at the bottom" },
  { value: "under-needs-you", label: "Under “Needs you”" },
  { value: "after-inbox", label: "After the inbox" },
  { value: "list", label: "In the list" },
];
export const DETAIL_CHOICES: readonly { value: RowDetail; label: string }[] = [
  { value: "compact", label: "Compact" },
  { value: "comfortable", label: "Comfortable" },
];

/** Four-line approval rows where three leave the command too little room. */
export const FOUR_LINE_APPROVALS_AT_PX = 300;

export interface ResolvedView {
  grouping: Grouping;
  workingPlacement: WorkingPlacement;
  idleRows: IdleRows;
  approvalLines: ApprovalLines;
}

export function resolveView(
  knobs: ViewKnobs,
  experiments: Experiments,
  columnPx: number,
): ResolvedView {
  return {
    grouping: knobs.grouping,
    workingPlacement: knobs.working,
    idleRows: experiments.idleRows ?? (knobs.rowDetail === "compact" ? "inline" : "two"),
    approvalLines: experiments.approvalLines ?? (columnPx <= FOUR_LINE_APPROVALS_AT_PX ? 4 : 3),
  };
}

/** Knobs that differ from the defaults: the View button's dot and "Reset to defaults". */
export function customizedKnobs(knobs: ViewKnobs): (keyof ViewKnobs)[] {
  return (Object.keys(DEFAULT_VIEW) as (keyof ViewKnobs)[]).filter(
    (key) => knobs[key] !== DEFAULT_VIEW[key],
  );
}

/** One line under the menu title saying what the current combination does. */
export function describeView(knobs: ViewKnobs): string {
  const grouping =
    knobs.grouping === "inbox"
      ? "One inbox across projects"
      : knobs.grouping === "project"
        ? "Tasks grouped by project"
        : "Tasks grouped by server, then project";
  const working =
    knobs.grouping !== "inbox"
      ? "working tasks in their project"
      : knobs.working === "list"
        ? "working tasks among the others"
        : knobs.working === "under-needs-you"
          ? "working tasks right under Needs you"
          : knobs.working === "dock"
            ? "working tasks docked at the bottom"
            : "working tasks after the inbox";
  const detail =
    knobs.rowDetail === "compact"
      ? knobs.grouping === "project"
        ? "one line per idle task"
        : "one line per idle task with its project"
      : knobs.grouping === "project"
        ? "two lines per task with the branch"
        : "two lines per task with project and branch";
  return `${grouping}; ${working}; ${detail}.`;
}
