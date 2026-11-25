/** What a turn's work amounted to, for the line that folds it once the turn ends. */

import { isTool } from "./view-models";
import {
  executeFailureShownByCalls,
  projectToolExecution,
  scriptCallOrigin,
  toolExecutionMachines,
} from "./tool-executions";
import type { TranscriptTurn } from "./turn-projection";

export interface TurnWorkSummary {
  /** Unique files changed by file-change tool calls that completed, made directly or by a script. */
  changedFiles: number;
  /**
   * Null when no counted file-change call reported line counts, or when a Code Mode script edited
   * a file (its calls report none, so a total would leave those lines out).
   */
  additions: number | null;
  deletions: number | null;
  /**
   * Shell commands that ran to an end, whether they succeeded or failed. A script's command
   * reports no exit code, so it counts as failed only when its call threw.
   */
  commands: number;
  /** Subagent calls that started. */
  subagents: number;
  /**
   * Tool calls that failed, a script's calls included, and a script that threw. A call the user
   * or runtime stopped is not a failure.
   */
  failed: number;
  /** OpenCode machines the calls worked on (`devbox:/…` paths), in first-seen order. */
  machines: string[];
}

export function turnWorkSummary(turn: TranscriptTurn): TurnWorkSummary {
  const seen = new Set<string>();
  const files = new Set<string>();
  let additions: number | null = null;
  let deletions: number | null = null;
  let commands = 0;
  let subagents = 0;
  let failed = 0;
  const machines: string[] = [];
  // A Code Mode edit reports no diff, so the line counts would leave its lines out.
  let uncountedLines = false;

  for (const group of turn.activity) {
    for (const entry of group.entries) {
      if (!isTool(entry.part)) continue;
      // The projection may list one part in more than one group; each call counts once.
      const key = `${entry.message.id}:${entry.part.id ?? `#${entry.index}`}`;
      if (seen.has(key)) continue;
      seen.add(key);

      // A Code Mode script's calls are entries of their own. A script that threw is a failed one,
      // unless the calls it made already show where it failed.
      const execution = projectToolExecution(entry.part, entry.index);
      if (execution.status === "error" && !executeFailureShownByCalls(entry.part, entry.index))
        failed += 1;
      for (const machine of toolExecutionMachines(execution))
        if (!machines.includes(machine)) machines.push(machine);

      if (execution.kind === "shell") {
        if (execution.status === "complete" || execution.status === "error") commands += 1;
      } else if (execution.kind === "subagent") {
        if (execution.status !== "pending") subagents += 1;
      } else if (execution.kind === "file-change" && execution.status === "complete") {
        // The reported diffs name files the way the tool resolved them; the input can name the
        // same file another way, so it is only the fallback.
        const targets =
          execution.files.length > 0
            ? execution.files.map((file) => file.file)
            : execution.targetFiles;
        for (const file of targets) files.add(file);
        if (scriptCallOrigin(entry.part) && execution.files.length === 0) uncountedLines = true;
        for (const file of execution.files) {
          additions = (additions ?? 0) + file.additions;
          deletions = (deletions ?? 0) + file.deletions;
        }
      }
    }
  }

  return {
    changedFiles: files.size,
    additions: uncountedLines ? null : additions,
    deletions: uncountedLines ? null : deletions,
    commands,
    subagents,
    failed,
    machines,
  };
}

/** Clauses for the fold line after the duration, most consequential first; empty when there is nothing to say. */
export function turnWorkSummaryClauses(summary: TurnWorkSummary): string[] {
  const clauses: string[] = [];
  if (summary.changedFiles > 0) {
    const lines = [
      ...(summary.additions !== null ? [`+${summary.additions}`] : []),
      ...(summary.deletions !== null ? [`−${summary.deletions}`] : []),
    ];
    clauses.push([`changed ${counted(summary.changedFiles, "file", "files")}`, ...lines].join(" "));
  }
  if (summary.commands > 0) {
    clauses.push(`ran ${counted(summary.commands, "command", "commands")}`);
  }
  if (summary.subagents > 0) {
    clauses.push(counted(summary.subagents, "subagent", "subagents"));
  }
  if (summary.machines.length > 0) clauses.push(`on ${summary.machines.join(", ")}`);
  if (summary.failed > 0) clauses.push(`${summary.failed} failed`);
  return clauses;
}

function counted(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}
