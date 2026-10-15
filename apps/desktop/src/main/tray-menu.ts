import type { PalotOpenTarget } from "../shared/opencode-contract";

export type TrayTaskSection = "attention" | "pinned" | "running" | "recent";

export interface TrayTaskItem {
  sessionID: string;
  title: string;
  detail: string;
  target: PalotOpenTarget;
}

export interface TrayTaskSections {
  attention: TrayTaskItem[];
  pinned: TrayTaskItem[];
  running: TrayTaskItem[];
  recent: TrayTaskItem[];
}

export interface TrayTaskCounts {
  attention: number;
  running: number;
}

const SECTION_ORDER = ["attention", "pinned", "running", "recent"] as const;
const SECTION_LIMIT = 3;
const TOTAL_LIMIT = 10;

export function prioritizeTrayTasks(input: TrayTaskSections): TrayTaskSections {
  const output: TrayTaskSections = { attention: [], pinned: [], running: [], recent: [] };
  const claimed = new Set<string>();
  let remaining = TOTAL_LIMIT;

  for (const section of SECTION_ORDER) {
    const limit = section === "recent" ? remaining : Math.min(SECTION_LIMIT, remaining);
    for (const item of input[section]) {
      if (remaining === 0 || output[section].length === limit) break;
      const key = trayTaskKey(item);
      if (claimed.has(key)) continue;
      claimed.add(key);
      output[section].push(item);
      remaining -= 1;
    }
  }

  return output;
}

/** Counts every task before the menu caps its sections; running excludes blocked tasks. */
export function countTrayTasks(input: TrayTaskSections): TrayTaskCounts {
  const attention = new Set(input.attention.map(trayTaskKey));
  const running = new Set(input.running.map(trayTaskKey).filter((key) => !attention.has(key)));
  return { attention: attention.size, running: running.size };
}

export function trayToolTip(displayName: string, counts: TrayTaskCounts): string {
  const parts: string[] = [];
  if (counts.attention === 1) parts.push("1 task needs input");
  else if (counts.attention > 1) parts.push(`${counts.attention} tasks need input`);
  if (counts.running > 0) parts.push(`${counts.running} running`);
  return parts.length ? `${displayName}: ${parts.join(", ")}` : displayName;
}

function trayTaskKey(item: TrayTaskItem): string {
  return JSON.stringify([
    item.target.type === "session" ? item.target.profileID : undefined,
    item.sessionID,
  ]);
}

export function formatTrayRelativeTime(timestamp: number, now = Date.now()): string {
  const elapsed = Math.max(0, now - timestamp);
  if (elapsed < 60_000) return "now";
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}m ago`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}h ago`;
  if (elapsed < 604_800_000) return `${Math.floor(elapsed / 86_400_000)}d ago`;
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(timestamp);
}
