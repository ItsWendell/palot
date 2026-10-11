import { describe, expect, it } from "vitest";
import type { GitFileStatus } from "../../shared/source-control-contract";
import { cleanCommitMessage, gitFileEntries, repositoryPrefix } from "./git-staging";

function file(path: string, change: Partial<GitFileStatus>): GitFileStatus {
  return {
    path,
    originalPath: null,
    index: ".",
    worktree: ".",
    staged: false,
    unstaged: false,
    untracked: false,
    conflicted: false,
    ...change,
  };
}

describe("gitFileEntries", () => {
  it("maps diff paths to repository paths and staged state, below the root too", () => {
    expect(repositoryPrefix("/repo", "/repo")).toBe("");
    expect(repositoryPrefix("/repo/", "/repo/packages/web")).toBe("packages/web/");
    expect(repositoryPrefix("/repo", "/elsewhere")).toBe("");

    const status = {
      root: "/repo",
      truncated: false,
      branch: { name: "main", oid: null, upstream: null, ahead: 0, behind: 0 },
      files: [
        file("README.md", { staged: true }),
        file("packages/web/src/a.ts", { staged: true, unstaged: true }),
        file("packages/web/new.ts", { untracked: true }),
      ],
    };
    const entries = gitFileEntries(status, "/repo/packages/web", [
      "README.md",
      "src/a.ts",
      "new.ts",
      "missing.ts",
    ]);
    expect(Object.fromEntries(entries)).toEqual({
      "README.md": { path: "README.md", state: "staged", conflicted: false },
      "src/a.ts": { path: "packages/web/src/a.ts", state: "partial", conflicted: false },
      "new.ts": { path: "packages/web/new.ts", state: "unstaged", conflicted: false },
    });
  });
});

describe("cleanCommitMessage", () => {
  it("removes fences and wrapping quotes", () => {
    expect(cleanCommitMessage("```text\nfeat: add x\n\nBody\n```")).toBe("feat: add x\n\nBody");
    expect(cleanCommitMessage('"fix: y"')).toBe("fix: y");
    expect(cleanCommitMessage("  chore: z  ")).toBe("chore: z");
  });
});
