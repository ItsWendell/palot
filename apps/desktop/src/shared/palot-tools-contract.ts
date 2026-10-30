import type { PermissionRuleset } from "@opencode/client";

/**
 * Palot's agent tools, served to OpenCode through its client-hosted MCP endpoint. The model
 * sees each tool as `palot_<name>`, which is also its OpenCode permission action.
 */
export const PALOT_TOOL_SERVER = "palot";

/** OpenCode added the client-hosted MCP endpoint in 2.1.4. */
export const PALOT_TOOLS_MIN_OPENCODE_VERSION = "2.1.4";

/**
 * Under Defaults, tools that change what runs later ask the user, unless the user turned off
 * "Ask before agents schedule tasks" or chose "Always allow for this project". Full access
 * tasks never ask, like every other tool there. Reading and organizing tasks never asks, like
 * a person tidying the sidebar.
 */
export const PALOT_TOOL_APPROVALS = {
  schedule_task: "ask",
  list_automations: "allow",
  update_automation: "ask",
  delete_automation: "ask",
  list_tasks: "allow",
  read_task: "allow",
  wait_tasks: "allow",
  settle_task: "allow",
  snooze_task: "allow",
  pin_task: "allow",
  archive_task: "allow",
  link_pull_request: "allow",
  watch_pull_request: "allow",
  unwatch_pull_request: "allow",
  create_pull_request: "ask",
} as const satisfies Record<string, "allow" | "ask">;

export type PalotToolName = keyof typeof PALOT_TOOL_APPROVALS;

export function palotToolAction(name: PalotToolName): string {
  return `${PALOT_TOOL_SERVER}_${name}`;
}

/** The tool a permission action belongs to, or null for other actions. */
export function palotToolName(action: string): PalotToolName | null {
  const prefix = `${PALOT_TOOL_SERVER}_`;
  if (!action.startsWith(prefix)) return null;
  const name = action.slice(prefix.length);
  return Object.hasOwn(PALOT_TOOL_APPROVALS, name) ? (name as PalotToolName) : null;
}

/**
 * Session rules for Palot's tools. Appended after a preset's own rules: OpenCode applies the
 * last matching rule, so these asks win over Full access's blanket allow.
 */
export const PALOT_TOOL_PERMISSIONS: PermissionRuleset = (
  Object.entries(PALOT_TOOL_APPROVALS) as Array<[PalotToolName, "allow" | "ask"]>
).map(([name, effect]) => ({ action: palotToolAction(name), resource: "*", effect }));

/** Whether a rule is one of the rules Palot's presets add for its own tools. */
export function isPalotToolRule(rule: PermissionRuleset[number]): boolean {
  return (
    palotToolName(rule.action) !== null &&
    rule.resource === "*" &&
    (rule.effect === "allow" || rule.effect === "ask")
  );
}

/** A task in Full access: apart from Palot's tool rules, exactly one blanket allow. */
export function isFullAccessRuleset(permissions: PermissionRuleset | undefined): boolean {
  const rules = (permissions ?? []).filter((rule) => !isPalotToolRule(rule));
  const rule = rules[0];
  return (
    rules.length === 1 && rule?.action === "*" && rule.resource === "*" && rule.effect === "allow"
  );
}

/** What a window currently shows, so Palot's tools are attached where its tasks run. */
export interface PalotToolsFocus {
  connectionID: string;
  directories: string[];
}
