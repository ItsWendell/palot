import type { PermissionRuleset } from "@opencode/client";

export type SessionApprovalMode = "normal" | "full" | "custom";
export type ApprovalPreset = Exclude<SessionApprovalMode, "custom">;

/** Only claim a preset when the authoritative rules exactly match it. */
export function sessionApprovalMode(permissions?: PermissionRuleset): SessionApprovalMode {
  if (!permissions?.length) return "normal";
  const rule = permissions[0];
  return permissions.length === 1 &&
    rule?.action === "*" &&
    rule.resource === "*" &&
    rule.effect === "allow"
    ? "full"
    : "custom";
}

export function approvalPresetRules(mode: ApprovalPreset): PermissionRuleset {
  return mode === "full" ? [{ action: "*", resource: "*", effect: "allow" }] : [];
}
