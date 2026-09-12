import { describe, expect, it } from "vitest";
import {
  validateAutomationSearch,
  validateChangesSearch,
  validateProjectSearch,
  validateSessionSearch,
  validateUsageSearch,
} from "./route-search";

describe("route search validation", () => {
  it("keeps only valid new-task projects", () => {
    expect(validateProjectSearch({ projectID: "project-1" })).toEqual({ projectID: "project-1" });
    expect(validateProjectSearch({ projectID: "" })).toEqual({ projectID: undefined });
  });

  it("requires a complete request focus target", () => {
    expect(
      validateSessionSearch({
        focus: "request",
        requestID: "request-1",
        requestType: "permission",
      }),
    ).toEqual({ focus: "request", requestID: "request-1", requestType: "permission" });
    expect(validateSessionSearch({ focus: "request", requestID: "request-1" })).toEqual({});
  });

  it("bounds selected diff file paths", () => {
    expect(validateChangesSearch({ file: "src/app.tsx", mode: "branch" })).toEqual({
      file: "src/app.tsx",
      mode: "branch",
    });
    expect(validateChangesSearch({ file: "x".repeat(32_769), mode: "invalid" })).toEqual({
      file: undefined,
      mode: "working",
    });
  });

  it("keeps bounded scheduled task and continuation targets", () => {
    expect(
      validateAutomationSearch({
        mode: "create",
        automationID: "automation-1",
        runID: "run-1",
        sessionID: "session-1",
      }),
    ).toEqual({
      mode: "create",
      automationID: "automation-1",
      runID: "run-1",
      sessionID: "session-1",
    });
    expect(validateAutomationSearch({ mode: "edit", sessionID: "" })).toEqual({});
  });

  it("normalizes usage ranges and project scope", () => {
    expect(validateUsageSearch({ days: "7", projectID: "project-1" })).toEqual({
      days: 7,
      projectID: "project-1",
    });
    expect(validateUsageSearch({ days: 365, projectID: "" })).toEqual({ days: 7 });
    expect(validateUsageSearch({ days: 1 })).toEqual({ days: 1 });
  });
});
