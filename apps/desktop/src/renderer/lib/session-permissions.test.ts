import { describe, expect, it } from "vitest";
import { approvalPresetRules, sessionApprovalMode } from "./session-permissions";

describe("session approval presets", () => {
  it("uses Defaults only for absent or empty session overrides", () => {
    expect(sessionApprovalMode()).toBe("normal");
    expect(sessionApprovalMode([])).toBe("normal");
    expect(sessionApprovalMode(approvalPresetRules("full"))).toBe("full");
  });

  it("asks before Palot's scheduling tools in Defaults and never in Full access", () => {
    // OpenCode applies the last matching rule.
    const effect = (mode: "normal" | "full", action: string) =>
      approvalPresetRules(mode).findLast((rule) => rule.action === action || rule.action === "*")
        ?.effect;
    expect(effect("normal", "palot_schedule_task")).toBe("ask");
    expect(effect("normal", "palot_read_task")).toBe("allow");
    expect(effect("full", "palot_schedule_task")).toBe("allow");
    for (const mode of ["normal", "full"] as const)
      expect(sessionApprovalMode(approvalPresetRules(mode))).toBe(mode);
    // Full access tasks created with yesterday's ask rules are still Full access.
    expect(
      sessionApprovalMode([
        { action: "*", resource: "*", effect: "allow" },
        { action: "palot_schedule_task", resource: "*", effect: "ask" },
      ]),
    ).toBe("full");
    expect(
      sessionApprovalMode([{ action: "palot_schedule_task", resource: "*", effect: "deny" }]),
    ).toBe("custom");
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
