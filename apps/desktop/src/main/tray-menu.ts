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
      const key = JSON.stringify([
        item.target.type === "session" ? item.target.profileID : undefined,
        item.sessionID,
      ]);
      if (claimed.has(key)) continue;
      claimed.add(key);
      output[section].push(item);
      remaining -= 1;
    }
  }

  return output;
}

export function formatTrayRelativeTime(timestamp: number, now = Date.now()): string {
  const elapsed = Math.max(0, now - timestamp);
  if (elapsed < 60_000) return "now";
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}m ago`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}h ago`;
  if (elapsed < 604_800_000) return `${Math.floor(elapsed / 86_400_000)}d ago`;
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(timestamp);
}
