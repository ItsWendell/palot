import { projectToolExecution } from "./tool-executions";
import type { TranscriptTurn } from "./turn-projection";
import { isTool } from "./view-models";

/** Names concurrent tool work in a working turn, e.g. "Reading 3 files". Null for 0 or 1 tool. */
export function parallelActivityLabel(turn: TranscriptTurn): string | null {
  const kinds: string[] = [];
  for (const group of turn.activity) {
    for (const entry of group.entries) {
      if (!isTool(entry.part)) continue;
      const view = projectToolExecution(entry.part, entry.index);
      if (view.status === "running" || view.status === "pending") kinds.push(view.kind);
    }
  }
  const count = kinds.length;
  if (count < 2) return null;
  const only = (kind: string) => kinds.every((candidate) => candidate === kind);
  if (only("read")) return `Reading ${count} files`;
  if (only("subagent")) return `Running ${count} subagents`;
  if (only("shell")) return `Running ${count} commands`;
  return `Running ${count} tools`;
}
