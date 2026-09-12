import { describe, expect, it } from "vitest";
import { approvalPresetRules, sessionApprovalMode } from "./session-permissions";

describe("session approval presets", () => {
  it("uses Defaults only for absent or empty session overrides", () => {
    expect(sessionApprovalMode()).toBe("normal");
    expect(sessionApprovalMode([])).toBe("normal");
    expect(sessionApprovalMode(approvalPresetRules("full"))).toBe("full");
  });

  it("does not mislabel scoped, restricted, or mixed rules as Full access", () => {
    expect(sessionApprovalMode([{ action: "shell", resource: "*", effect: "allow" }])).toBe(
      "custom",
    );
    expect(sessionApprovalMode([{ action: "*", resource: "workspace/*", effect: "allow" }])).toBe(
      "custom",
    );
    expect(sessionApprovalMode([{ action: "*", resource: "*", effect: "ask" }])).toBe("custom");
    expect(
      sessionApprovalMode([
        ...approvalPresetRules("full"),
        { action: "edit", resource: "*.env", effect: "deny" },
      ]),
    ).toBe("custom");
  });
});
