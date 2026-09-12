import { describe, expect, it } from "vitest";
import { sidebarSessionState, sidebarSessionStatus } from "./sidebar-session-status";

describe("sidebarSessionStatus", () => {
  it.each(["running", "failed", "interrupted"] as const)("shows %s", (status) => {
    expect(sidebarSessionStatus({ status, startedAt: 1, completedAt: null })).toBe(status);
  });

  it.each(["inactive", "succeeded"] as const)("keeps %s quiet", (status) => {
    expect(sidebarSessionStatus({ status, startedAt: 1, completedAt: 2 })).toBeNull();
  });

  it("restores persisted failure outcomes when no live execution is retained", () => {
    expect(sidebarSessionStatus(undefined, "failed")).toBe("failed");
    expect(sidebarSessionStatus(undefined, "interrupted")).toBe("interrupted");
    expect(sidebarSessionStatus(undefined, "succeeded")).toBeNull();
  });

  it("uses attention and execution state before unread", () => {
    expect(sidebarSessionState("running", true, true)).toBe("attention");
    expect(sidebarSessionState("failed", false, true)).toBe("failed");
    expect(sidebarSessionState("running", false, true)).toBe("running");
    expect(sidebarSessionState("interrupted", false, true)).toBe("interrupted");
  });

  it("shows unread only for an otherwise idle task", () => {
    expect(sidebarSessionState(null, false, true)).toBe("unread");
    expect(sidebarSessionState(null, false, false)).toBeNull();
  });
});
