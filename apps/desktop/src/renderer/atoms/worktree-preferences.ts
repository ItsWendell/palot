import { persistedAtom } from "./persisted";

export const worktreeBranchPrefixAtom = persistedAtom({
  key: "worktrees.branch-prefix",
  initialValue: "palot/",
  validate: (value: unknown): value is string => typeof value === "string" && value.length <= 100,
});
export const automaticWorktreeCleanupAtom = persistedAtom({
  key: "worktrees.automatic-cleanup",
  initialValue: false,
  validate: (value: unknown): value is boolean => typeof value === "boolean",
});

export interface WorktreeCleanupEntry {
  directory: string;
  at: number;
  pullRequest: string;
}
export const worktreeCleanupLogAtom = persistedAtom({
  key: "worktrees.cleanup-log",
  initialValue: [] as WorktreeCleanupEntry[],
  validate: (value: unknown): value is WorktreeCleanupEntry[] =>
    Array.isArray(value) &&
    value.length <= 100 &&
    value.every(
      (entry) =>
        entry &&
        typeof entry.directory === "string" &&
        typeof entry.at === "number" &&
        typeof entry.pullRequest === "string",
    ),
});
