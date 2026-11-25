import type { FileDiffInfo } from "@opencode/client";
import { createContext, useContext, useMemo } from "react";
import { useTurnDiffs } from "../hooks/use-turn-diffs";
import { sameFilePath, type ToolFileDiff } from "../lib/tool-executions";
import type { ScriptCallDiffTarget } from "../lib/turn-projection";

/** The hunk context the turn's changed-files card asks for, so both share one request. */
const DIFF_CONTEXT = 3;

/**
 * Where a transcript loads turn diffs from. Empty `profileID` when its connection cannot load
 * them; without a scope, a Code Mode script's file-change rows show no diff.
 */
export interface TranscriptDiffScope {
  profileID: string;
  sessionID: string;
}

export const TranscriptDiffScopeContext = createContext<TranscriptDiffScope | null>(null);

export function useTranscriptDiffScope(): TranscriptDiffScope | null {
  const scope = useContext(TranscriptDiffScopeContext);
  return scope?.profileID ? scope : null;
}

/**
 * The turn diff for the files a Code Mode script's file-change call named, since the call reports
 * none of its own. Null until the diff loads; files the diff does not list are left out.
 */
export function useScriptCallDiffs(
  scope: TranscriptDiffScope,
  target: ScriptCallDiffTarget,
): ToolFileDiff[] | null {
  const query = useTurnDiffs(
    scope.profileID,
    scope.sessionID,
    target.userMessageID,
    true,
    DIFF_CONTEXT,
  );
  const diffs = query.available ? query.data : undefined;
  return useMemo(() => (diffs ? matchTurnDiffs(diffs, target.files) : null), [diffs, target]);
}

/** The diffs for `files`, matched by path: the call can name a file relative or absolute. */
export function matchTurnDiffs(diffs: readonly FileDiffInfo[], files: string[]): ToolFileDiff[] {
  return files.flatMap((file) => {
    const diff = diffs.find((candidate) => sameFilePath(candidate.file, file));
    return diff
      ? [
          {
            file: diff.file,
            patch: diff.patch,
            additions: diff.additions,
            deletions: diff.deletions,
            status: diff.status,
          },
        ]
      : [];
  });
}
