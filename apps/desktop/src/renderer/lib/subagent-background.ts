import type { SubagentExecution } from "./tool-executions";

/**
 * Whether the connected OpenCode runs every subagent in the background. Releases after 2.2.7
 * do; a prerelease build (such as one from `dev`) is treated as newer. Unknown means 2.2.7.
 */
export function opencodeAlwaysBackgroundsSubagents(version: string | null | undefined): boolean {
  const match = version?.trim().match(/^v?(\d+)\.(\d+)\.(\d+)(-.+)?$/);
  if (!match) return false;
  const [major, minor, patch] = match.slice(1, 4).map(Number) as [number, number, number];
  if (match[4]) return true;
  if (major !== 2) return major > 2;
  if (minor !== 2) return minor > 2;
  return patch > 7;
}

/**
 * Whether a subagent row says "background". It tells a background child apart from foreground
 * ones, so it shows only where both exist: a call that asked for the background, or (on 2.2.7)
 * one the user moved there. The call data cannot tell a moved 2.2.7 call from a newer
 * always-background launch, so the version decides that case.
 */
export function subagentShowsBackgroundChip(
  view: Partial<Pick<SubagentExecution, "requestedBackground" | "launchOnly">>,
  version: string | null | undefined,
): boolean {
  if (view.requestedBackground) return true;
  return view.launchOnly === true && !opencodeAlwaysBackgroundsSubagents(version);
}
