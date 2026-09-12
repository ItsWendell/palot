import type { ModelRef } from "@opencode/client";

export type AutomationStatus = "active" | "paused";

export type AutomationWorkspace =
  | { type: "current" }
  | { type: "new-worktree" }
  | { type: "existing-worktree"; directory: string };

export type AutomationDestination =
  | {
      type: "standalone";
      projectID: string;
      sourceDirectory: string;
      workspace: AutomationWorkspace;
    }
  | {
      type: "session";
      sessionID: string;
    };

export type AutomationTrigger =
  | {
      version: 1;
      type: "once";
      at: number;
      timezone: string;
    }
  | {
      version: 1;
      type: "recurring";
      dtstart: number;
      timezone: string;
      rrule: string;
    };

export type AutomationMissedRunPolicy =
  | { type: "catch-up-once"; maxAgeMs: number }
  | { type: "skip" };

export type AutomationNotificationPolicy = "all-runs" | "background-only" | "failures-only";

export interface AutomationAction {
  prompt: string;
  agent: string | null;
  model: ModelRef | null;
  skills: string[];
}

export interface AutomationDraft {
  name: string;
  status: AutomationStatus;
  action: AutomationAction;
  destination: AutomationDestination;
  trigger: AutomationTrigger;
  missedRuns: AutomationMissedRunPolicy;
  notifications: AutomationNotificationPolicy;
  createdFromSessionID: string | null;
}

export interface AutomationDefinition extends AutomationDraft {
  version: 1;
  id: string;
  profileID: string;
  createdAt: number;
  updatedAt: number;
}

export interface AutomationRecord extends AutomationDefinition {
  definitionVersion: number;
  nextRunAt: number | null;
  lastRunAt: number | null;
  activeRunID: string | null;
  consecutiveStartFailures: number;
}

export type AutomationRunTrigger = "scheduled" | "catch-up" | "manual" | "retry";

export type AutomationRunState =
  | "pending"
  | "preparing"
  | "queued"
  | "running"
  | "needs-attention"
  | "settling"
  | "succeeded"
  | "failed"
  | "interrupted"
  | "cancelled"
  | "skipped"
  | "unknown";

export interface AutomationRunAttention {
  type: "permission" | "form" | "question" | "configuration" | "unknown";
  sessionID: string | null;
  requestID: string | null;
  message: string;
}

export interface AutomationRunError {
  code: string;
  message: string;
}

export interface AutomationRun {
  id: string;
  automationID: string;
  profileID: string;
  definitionVersion: number;
  trigger: AutomationRunTrigger;
  scheduledFor: number;
  state: AutomationRunState;
  rootSessionID: string | null;
  inboxID: string | null;
  worktreeDirectory: string | null;
  sessionCursors: Record<string, number>;
  attention: AutomationRunAttention | null;
  summary: string | null;
  error: AutomationRunError | null;
  startedAt: number | null;
  completedAt: number | null;
  executionStartedAt: number | null;
  executionCompletedAt: number | null;
  readAt: number | null;
  archivedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface AutomationSnapshot {
  profileID: string;
  automations: AutomationRecord[];
  runs: AutomationRun[];
}

export interface AutomationSchedulePreview {
  summary: string;
  occurrences: number[];
}

export type AutomationCommand =
  | { type: "create"; profileID: string; draft: AutomationDraft }
  | { type: "update"; profileID: string; automationID: string; draft: AutomationDraft }
  | { type: "pause"; profileID: string; automationID: string }
  | { type: "resume"; profileID: string; automationID: string }
  | { type: "run-now"; profileID: string; automationID: string }
  | { type: "delete"; profileID: string; automationID: string }
  | { type: "cancel-run"; profileID: string; runID: string }
  | { type: "mark-read"; profileID: string; runID: string }
  | { type: "mark-unread"; profileID: string; runID: string }
  | { type: "archive-run"; profileID: string; runID: string }
  | { type: "unarchive-run"; profileID: string; runID: string }
  | { type: "mark-all-read"; profileID: string };

export interface AutomationChangedEvent {
  profileID: string;
}

export interface AutomationNotificationTarget {
  automationID: string;
  runID: string;
  sessionID: string | null;
  requestID: string | null;
  requestType: "permission" | "form" | "question" | null;
}

export interface AutomationHostSettings {
  launchAtLogin: boolean;
  preventSleepWhileRunning: boolean;
}
