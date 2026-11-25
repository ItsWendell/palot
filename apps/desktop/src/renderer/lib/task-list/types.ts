/** What the task list knows about a task without opening it. Ported from the sidebar prototype. */

export interface Server {
  id: string;
  name: string;
  online: boolean;
  /** When the server was last heard from; set while offline. */
  lastSeenAt: number | null;
}

export interface Project {
  id: string;
  name: string;
  serverID: string;
}

interface RequestBase {
  id: string;
  arrivedAt: number;
  /** Set when a subagent asked: its agent name ("explore"), or "" when it has none. */
  from: string | null;
}

export interface PermissionRequest extends RequestBase {
  kind: "permission";
  /** The short form for the status sentence: "bun test". */
  summary: string;
  /** The full command or path, shown in monospace. */
  detail: string;
  /** What "Always allow" would add: "bun test *". */
  rule: string;
}

export interface QuestionRequest extends RequestBase {
  kind: "question";
  question: string;
  options: string[];
}

export type TaskRequest = PermissionRequest | QuestionRequest;

export interface TaskRun {
  startedAt: number;
  /** The last event from the agent; a long silence makes the task stale. */
  lastUpdateAt: number;
  /** What the agent is doing now, when Palot knows ("Running bun test"). */
  detail: string | null;
}

export type PullRequestState = "open" | "draft" | "merged" | "closed";
export type PullRequestChecks = "passing" | "failing" | "pending" | "none";

export interface TaskPullRequest {
  number: number;
  state: PullRequestState;
  checks: PullRequestChecks;
  /** The readiness verdict for an open PR ("Ready to merge", "Still needed: …"), else null. */
  readiness: { ready: boolean; text: string } | null;
}

export interface Task {
  id: string;
  title: string;
  /** Null for a chat without a project. */
  projectID: string | null;
  serverID: string;
  branch: string | null;
  createdAt: number;
  /** The last meaningful event: run start while working, else when the last turn ended. */
  activityAt: number;
  run: TaskRun | null;
  /** When the last run ended; the Working shelf keeps the task briefly after it. */
  runEndedAt: number | null;
  requests: TaskRequest[];
  /** Which pending request the row shows ("1 of 3"). */
  requestIndex: number;
  failure: string | null;
  stopped: boolean;
  unread: boolean;
  /** The last turn's work, for "Worked for 2m 5s · changed 3 files". */
  summary: { durationMs: number; filesChanged: number; commands: number } | null;
  pinnedAt: number | null;
  snoozedUntil: number | null;
  settledAt: number | null;
  pr: TaskPullRequest | null;
  /** Running subagents. */
  subagents: number;
  /** A scheduled task's cadence ("Daily 09:00"); its runs carry a small clock mark. */
  schedule: string | null;
  lastAnswer: string;
  /** When the task started needing you; the row pulses once when this changes. */
  attentionAt: number | null;
  /** An answered request keeps the row in "Needs you" until this time, showing its new state. */
  lingerUntil: number | null;
  /** The task's composer holds something unsent: text, attachments or comments. */
  draft?: boolean;
}
