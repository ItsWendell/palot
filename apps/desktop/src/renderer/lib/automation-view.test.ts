import { describe, expect, it } from "vitest";
import type { AutomationRun } from "../../shared";
import {
  automationRunActionLabel,
  automationRunOpenTarget,
  automationRunStateLabel,
  latestAutomationRun,
  runExecutionDuration,
} from "./automation-view";

function run(input: Partial<AutomationRun>): AutomationRun {
  return {
    id: "run-1",
    automationID: "automation-1",
    profileID: "profile-1",
    definitionVersion: 1,
    trigger: "scheduled",
    scheduledFor: 1,
    state: "succeeded",
    rootSessionID: null,
    inboxID: null,
    worktreeDirectory: null,
    sessionCursors: {},
    attention: null,
    summary: null,
    error: null,
    startedAt: null,
    completedAt: null,
    executionStartedAt: null,
    executionCompletedAt: null,
    readAt: null,
    archivedAt: null,
    createdAt: 1,
    updatedAt: 1,
    ...input,
  };
}

describe("runExecutionDuration", () => {
  it("formats authoritative OpenCode execution timing", () => {
    expect(
      runExecutionDuration({
        executionStartedAt: 1_000,
        executionCompletedAt: 66_000,
      } as AutomationRun),
    ).toBe("1m 5s");
  });

  it("stays unknown until both execution boundaries are available", () => {
    expect(
      runExecutionDuration({
        executionStartedAt: 1_000,
        executionCompletedAt: null,
      } as AutomationRun),
    ).toBeNull();
  });
});

describe("automation run navigation", () => {
  it("opens the exact pending request before falling back to the root session", () => {
    expect(
      automationRunOpenTarget(
        run({
          rootSessionID: "root-session",
          state: "needs-attention",
          attention: {
            type: "question",
            sessionID: "child-session",
            requestID: "question-1",
            message: "Choose an option",
          },
        }),
      ),
    ).toEqual({
      type: "request",
      sessionID: "child-session",
      requestID: "question-1",
      requestType: "question",
    });
  });

  it("opens an attention session even when the root session is missing", () => {
    expect(
      automationRunOpenTarget(
        run({
          state: "needs-attention",
          attention: {
            type: "unknown",
            sessionID: "attention-session",
            requestID: null,
            message: "Inspect this task",
          },
        }),
      ),
    ).toEqual({ type: "session", sessionID: "attention-session" });
  });

  it("keeps sessionless setup failures actionable as run details", () => {
    const setupRun = run({
      state: "needs-attention",
      attention: {
        type: "configuration",
        sessionID: null,
        requestID: null,
        message: "The target task is unavailable.",
      },
    });
    expect(automationRunOpenTarget(setupRun)).toEqual({ type: "details" });
    expect(automationRunStateLabel(setupRun)).toBe("Setup required");
    expect(automationRunActionLabel(setupRun)).toBe("View setup issue");
  });

  it("selects the newest run independently of input order", () => {
    expect(
      latestAutomationRun([
        run({ id: "older", createdAt: 10 }),
        run({ id: "newer", createdAt: 20 }),
      ])?.id,
    ).toBe("newer");
  });
});
