import type { JsonValue, PalotMessage, PalotMessageContent } from "../../../shared";
import { isTool } from "../../lib/view-models";

export type PlanItemStatus = "pending" | "in_progress" | "completed" | "cancelled";

export interface PlanItem {
  id: string;
  content: string;
  status: PlanItemStatus;
}

export interface AgentPlan {
  /** The tool call that last replaced the list. */
  sourceID: string;
  items: PlanItem[];
  done: number;
  /** Items that still count toward progress (cancelled items do not). */
  total: number;
  inProgress: PlanItem | null;
  complete: boolean;
}

/**
 * OpenCode 2 has no todo API. Agents that still call a `todowrite` tool
 * (migrated V1 history or a plugin providing it) replace the whole list on
 * every call, so the latest successful call is the plan.
 */
export const PLAN_TOOL_NAMES = new Set(["todowrite", "todo_write"]);

function record(value: JsonValue | undefined): Record<string, JsonValue> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function planStatus(value: JsonValue | undefined): PlanItemStatus {
  const status = typeof value === "string" ? value.toLowerCase().replaceAll("-", "_") : "";
  if (status === "completed" || status === "complete" || status === "done") return "completed";
  if (status === "in_progress" || status === "active" || status === "running") {
    return "in_progress";
  }
  if (status === "cancelled" || status === "canceled" || status === "skipped") return "cancelled";
  return "pending";
}

export function isPlanToolPart(part: PalotMessageContent): boolean {
  return isTool(part) && PLAN_TOOL_NAMES.has((part.name ?? "").toLowerCase());
}

/** Parsed plan items from one plan tool call, or null when its input is not a list yet. */
export function planItems(part: PalotMessageContent): PlanItem[] | null {
  if (!isPlanToolPart(part)) return null;
  const state = record(part.state);
  if (state.status === "error" || state.status === "failed") return null;
  const todos = record(state.input).todos;
  if (!Array.isArray(todos)) return null;
  return todos.flatMap((value, index) => {
    const todo = record(value);
    const content = typeof todo.content === "string" ? todo.content.trim() : "";
    if (!content) return [];
    return [
      {
        id: typeof todo.id === "string" && todo.id ? todo.id : `${index}`,
        content,
        status: planStatus(todo.status),
      },
    ];
  });
}

export function summarizePlan(sourceID: string, items: PlanItem[]): AgentPlan | null {
  if (items.length === 0) return null;
  const counted = items.filter((item) => item.status !== "cancelled");
  const done = counted.filter((item) => item.status === "completed").length;
  return {
    sourceID,
    items,
    done,
    total: counted.length,
    inProgress: items.find((item) => item.status === "in_progress") ?? null,
    complete: done === counted.length,
  };
}

export function latestPlan(messages: readonly PalotMessage[]): AgentPlan | null {
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const message = messages[messageIndex]!;
    for (let partIndex = message.content.length - 1; partIndex >= 0; partIndex -= 1) {
      const part = message.content[partIndex]!;
      const items = planItems(part);
      if (items === null) continue;
      return summarizePlan(part.id ?? `${message.id}:${partIndex}`, items);
    }
  }
  return null;
}
