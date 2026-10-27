import type { PermissionRuleset } from "@opencode/client";
import {
  isFullAccessRuleset,
  isPalotToolRule,
  PALOT_TOOL_PERMISSIONS,
} from "../../shared/palot-tools-contract";

export type SessionApprovalMode = "normal" | "full" | "custom";
export type ApprovalPreset = Exclude<SessionApprovalMode, "custom">;

/**
 * Only claim a preset when the authoritative rules exactly match it. Rules for Palot's own
 * tools are part of Defaults; tasks with or without them still match their preset.
 */
export function sessionApprovalMode(permissions?: PermissionRuleset): SessionApprovalMode {
  if (!(permissions ?? []).some((rule) => !isPalotToolRule(rule))) return "normal";
  return isFullAccessRuleset(permissions) ? "full" : "custom";
}

/** Full access allows everything, Palot's scheduling tools included, as ChatGPT's Full access does. */
export function approvalPresetRules(mode: ApprovalPreset): PermissionRuleset {
  return mode === "full"
    ? [{ action: "*", resource: "*", effect: "allow" }]
    : [...PALOT_TOOL_PERMISSIONS];
}
