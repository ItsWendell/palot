import { expect, it } from "vitest";
import {
  compareGitHubPaths,
  isFileCollapsed,
  presentPullRequestFile,
} from "./pull-request-code-model";
import { prFile } from "./test-support";

it("orders paths like GitHub's file tree: folders first, then case-insensitive names", () => {
  const paths = ["README.md", "src/z.ts", "src/lib/a.ts", ".github/ci.yml", "Makefile", "src/B.ts"];
  expect(paths.toSorted(compareGitHubPaths)).toEqual([
    ".github/ci.yml",
    "src/lib/a.ts",
    "src/B.ts",
    "src/z.ts",
    "Makefile",
    "README.md",
  ]);
});

it("gives GitHub's header-less patches the header their status implies", () => {
  const added = presentPullRequestFile(
    prFile("new.ts", { status: "added", patch: "@@ -0,0 +1,2 @@\n+a\n+b" }),
    false,
  );
  expect(added.fileDiff?.type).toBe("new");

  const removed = presentPullRequestFile(
    prFile("old.ts", { status: "removed", patch: "@@ -1,2 +0,0 @@\n-a\n-b" }),
    false,
  );
  expect(removed.fileDiff?.type).toBe("deleted");

  const renamed = presentPullRequestFile(
    prFile("src/new.ts", { status: "renamed", previousPath: "src/old.ts" }),
    false,
  );
  expect(renamed.fileDiff).toMatchObject({
    type: "rename-changed",
    name: "src/new.ts",
    prevName: "src/old.ts",
  });

  const moved = presentPullRequestFile(
    prFile("b.ts", {
      status: "renamed",
      previousPath: "a.ts",
      patch: null,
      additions: 0,
      deletions: 0,
    }),
    false,
  );
  expect(moved.fileDiff?.type).toBe("rename-pure");
});

it("hides whitespace-only changes while keeping counts honest", () => {
  const file = prFile("a.ts", { patch: "@@ -1,1 +1,1 @@\n-a  b\n+a b" });
  expect(presentPullRequestFile(file, false).fileDiff).not.toBeNull();
  expect(presentPullRequestFile(file, true)).toMatchObject({
    fileDiff: null,
    whitespaceOnly: true,
    additions: 0,
    deletions: 0,
  });
});

it("folds viewed and very large files until the reader says otherwise", () => {
  const none = new Map<string, boolean>();
  expect(isFileCollapsed(prFile("a.ts"), none)).toBe(false);
  expect(isFileCollapsed(prFile("a.ts", { viewed: "viewed" }), none)).toBe(true);
  expect(isFileCollapsed(prFile("a.ts", { additions: 1_200, deletions: 400 }), none)).toBe(true);
  expect(isFileCollapsed(prFile("a.ts", { viewed: "viewed" }), new Map([["a.ts", false]]))).toBe(
    false,
  );
});
