/**
 * Joins OpenCode's diff list with Palot's local Git status for the Changes tab.
 *
 * OpenCode lists working-tree diffs by repository-root-relative path, as Git does. Git
 * status paths are always root-relative; when a task directory sits below the root and
 * a diff path is directory-relative, the directory's prefix is tried as well.
 */
import type { FileDiffInfo } from "@opencode/client";
import type { GitFileStatus, GitWorkingTreeStatus } from "../../shared/source-control-contract";

export type StagedState = "staged" | "partial" | "unstaged";

export interface GitFileEntry {
  /** Repository-root-relative path for stage and unstage calls. */
  path: string;
  state: StagedState;
  conflicted: boolean;
}

/** The task directory relative to the repository root, with a trailing slash, or "". */
export function repositoryPrefix(root: string, directory: string): string {
  const normalize = (value: string) => value.replace(/\\/g, "/").replace(/\/+$/, "");
  const base = normalize(root);
  const target = normalize(directory);
  if (!base || target === base || !target.startsWith(`${base}/`)) return "";
  return `${target.slice(base.length + 1)}/`;
}

export function stagedState(file: GitFileStatus): StagedState {
  if (!file.staged) return "unstaged";
  return file.unstaged || file.untracked ? "partial" : "staged";
}

/** Looks up each diff path in Git status. Paths Git does not report are left out. */
export function gitFileEntries(
  status: GitWorkingTreeStatus,
  directory: string,
  diffPaths: readonly string[],
): Map<string, GitFileEntry> {
  const byPath = new Map(status.files.map((file) => [file.path, file]));
  const prefix = repositoryPrefix(status.root, directory);
  const entries = new Map<string, GitFileEntry>();
  for (const diffPath of diffPaths) {
    const file = byPath.get(diffPath) ?? (prefix ? byPath.get(prefix + diffPath) : undefined);
    if (!file) continue;
    entries.set(diffPath, {
      path: file.path,
      state: stagedState(file),
      conflicted: file.conflicted,
    });
  }
  return entries;
}

export function stageablePaths(status: GitWorkingTreeStatus): string[] {
  return status.files.filter((file) => file.unstaged || file.untracked).map((file) => file.path);
}

export function stagedPaths(status: GitWorkingTreeStatus): string[] {
  return status.files.filter((file) => file.staged).map((file) => file.path);
}

/** Keeps the request bounded; the summary line rarely needs more than the first changes. */
const MAX_PROMPT_DIFF = 24_000;

/**
 * Prompt for a commit message from the staged files' diffs. The diffs are OpenCode's
 * working-tree patches, so a partially staged file contributes its unstaged edits too.
 */
export function commitMessagePrompt(files: readonly FileDiffInfo[]): string {
  let diff = "";
  for (const file of files) {
    const next = `${file.patch.trimEnd()}\n`;
    if (diff.length + next.length > MAX_PROMPT_DIFF) {
      diff += `\n[Diff truncated; ${files.length} files changed in total.]\n`;
      break;
    }
    diff += next;
  }
  return [
    "Write a Git commit message for the staged changes below.",
    "Use the Conventional Commits format: `type(optional scope): summary`, with the summary in the imperative mood and at most 72 characters.",
    "Add a short body only when the summary cannot explain why the change was made; wrap it at 72 characters.",
    "Reply with the commit message only, without code fences, quotes, or commentary.",
    "",
    "Changed files:",
    ...files.map(
      (file) => `- ${file.file} (${file.status}, +${file.additions} -${file.deletions})`,
    ),
    "",
    "Diff:",
    diff,
  ].join("\n");
}

/** Strips fences and surrounding quotes models sometimes add despite the prompt. */
export function cleanCommitMessage(text: string): string {
  let value = text.trim();
  const fenced = /^```[^\n]*\n([\s\S]*?)\n?```$/.exec(value);
  if (fenced) value = fenced[1]!.trim();
  if (/^(["'`])[\s\S]*\1$/.test(value) && !value.includes("\n")) value = value.slice(1, -1).trim();
  return value;
}
