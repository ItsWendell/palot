/**
 * OpenCode's `/goal` plugin (built in since 2.2.1): a Session keeps working until a reviewer
 * judges its objective met. Clients read the state with the `opencode.goal` RPC `get` and keep
 * it current from its `changed` event (`rpc.opencode.goal.changed`), which the plugin publishes
 * in the Session's location on every write. Parsed by hand so the renderer needs no Effect
 * schema runtime; the shape mirrors `@opencode/schema/goal` `State`.
 */
export const GOAL_RPC_ID = "opencode.goal";
export const GOAL_CHANGED_EVENT = `rpc.${GOAL_RPC_ID}.changed`;

export type SessionGoalStatus = "active" | "paused" | "complete";

export interface SessionGoal {
  id: string;
  objective: string;
  status: SessionGoalStatus;
  /** Why the goal last changed: the reviewer's reason, or what paused it. */
  reason?: string;
  /** Continuations sent since the goal was set or last resumed. */
  rounds: number;
  maxRounds: number;
  /** Rounds in a row without progress. */
  stalls?: number;
  updatedAt: number;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

/** A goal from the RPC or event payload; null for no goal or a shape this client can't read. */
export function parseSessionGoal(value: unknown): SessionGoal | null {
  const goal = record(value);
  if (!goal) return null;
  const { id, objective, status, reason, rounds, maxRounds, stalls, updatedAt } = goal;
  if (typeof id !== "string" || typeof objective !== "string") return null;
  if (status !== "active" && status !== "paused" && status !== "complete") return null;
  if (!finite(rounds) || !finite(maxRounds) || !finite(updatedAt)) return null;
  return {
    id,
    objective,
    status,
    ...(typeof reason === "string" && reason.trim() ? { reason: reason.trim() } : {}),
    rounds,
    maxRounds,
    ...(finite(stalls) ? { stalls } : {}),
    updatedAt,
  };
}

/** The session and goal a `rpc.opencode.goal.changed` event carries, or null for other events. */
export function goalChangedEvent(event: {
  type: string;
  data?: unknown;
}): { sessionID: string; goal: SessionGoal | null } | null {
  if (event.type !== GOAL_CHANGED_EVENT) return null;
  const data = record(event.data);
  if (!data || typeof data.sessionID !== "string") return null;
  return { sessionID: data.sessionID, goal: parseSessionGoal(data.goal) };
}

const GOAL_CONTROLS = new Set(["", "pause", "resume", "clear"]);

/**
 * `/goal <objective>` while a goal is still active or paused replaces it (OpenCode starts the
 * new one from round 1). Controls, a bare `/goal`, and a met goal replace nothing.
 */
export function replacesGoal(goal: SessionGoal | null, args: string | undefined): boolean {
  if (!goal || goal.status === "complete") return false;
  const text = (args ?? "")
    .trim()
    .replace(/^["']|["']$/g, "")
    .trim()
    .toLowerCase();
  return !GOAL_CONTROLS.has(text);
}
