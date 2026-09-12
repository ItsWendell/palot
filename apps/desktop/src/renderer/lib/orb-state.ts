/** Maps stable turn boundaries to the low-frequency orb animation state. */

import type { OrbState } from "@palot/orbits";
import { isTool } from "./view-models";
import type { TranscriptTurn } from "./turn-projection";

const TOOL_ORB_STATES: Record<string, OrbState> = {
  read: "searching",
  grep: "searching",
  glob: "searching",
  webfetch: "searching",
  websearch: "searching",
  web_search: "searching",
  edit: "shaping",
  write: "shaping",
  patch: "shaping",
  shell: "working",
  local_shell: "working",
  task: "weaving",
  subagent: "weaving",
  skill: "connecting",
  question: "listening",
  execute: "connecting",
};

export function resolveTurnOrbState(turn: TranscriptTurn | undefined): OrbState | null {
  if (!turn || turn.status !== "working") return null;
  if (turn.final) return "composing";
  const group = turn.activity.at(-1);
  const entry = group?.entries.at(-1);
  if (!entry) return "breathing";
  if (entry.part.type === "reasoning") return "solving";
  if (!isTool(entry.part)) return "composing";
  return TOOL_ORB_STATES[entry.part.name?.toLowerCase() ?? ""] ?? "working";
}
