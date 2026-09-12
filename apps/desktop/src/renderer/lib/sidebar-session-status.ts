import type { SessionExecutionState } from "../atoms/workspace";

export type SidebarSessionStatus = "failed" | "interrupted" | "running" | null;
export type SidebarSessionState =
  | "attention"
  | Exclude<SidebarSessionStatus, null>
  | "unread"
  | null;

export function sidebarSessionStatus(
  execution: SessionExecutionState | null | undefined,
  outcome?: "succeeded" | "failed" | "interrupted",
): SidebarSessionStatus {
  if (execution?.status === "running") return "running";
  if (execution?.status === "failed") return "failed";
  if (execution?.status === "interrupted") return "interrupted";
  if (outcome === "failed" || outcome === "interrupted") return outcome;
  return null;
}

export function sidebarSessionState(
  status: SidebarSessionStatus,
  attention: boolean,
  unread: boolean,
): SidebarSessionState {
  if (attention) return "attention";
  return status ?? (unread ? "unread" : null);
}
