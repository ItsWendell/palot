import { describe, expect, it } from "vitest";
import { hideWhitespaceChanges } from "./diff-whitespace";
import { resolveFileDiff } from "./file-diffs";

function patch(...hunks: string[][]): string {
  return ["--- a/app.ts", "+++ b/app.ts", ...hunks.flat()].join("\n");
}

describe("hideWhitespaceChanges", () => {
  it("folds re-indented lines into context and keeps real edits", () => {
    const source = patch([
      "@@ -1,4 +1,4 @@",
      " function run() {",
      "-if (ready) {",
      "-  start();",
      "+  if (ready) {",
      "+    begin();",
      " }",
    ]);
    const result = hideWhitespaceChanges(source);
    expect(result).toMatchObject({ additions: 1, deletions: 1, whitespaceOnly: false });
    expect(result.patch.split("\n").slice(2)).toEqual([
      "@@ -1,4 +1,4 @@",
      " function run() {",
      "   if (ready) {",
      "-  start();",
      "+    begin();",
      " }",
    ]);

    // The rewritten hunk still parses with the original line numbers.
    const diff = resolveFileDiff({ file: "app.ts", patch: result.patch })!;
    expect(diff.hunks).toHaveLength(1);
    expect(diff.hunks[0]).toMatchObject({ additionStart: 1, deletionStart: 1 });
    expect(diff.additionLines.map((line) => line.replace(/\n$/, ""))).toContain("    begin();");
  });

  it("drops hunks that only change whitespace and flags whitespace-only files", () => {
    const mixed = patch(
      ["@@ -1,2 +1,2 @@", "-a  =  1", "+a = 1", " b"],
      ["@@ -10,2 +10,2 @@", " c", "-d", "+e"],
    );
    const result = hideWhitespaceChanges(mixed);
    expect(result).toMatchObject({ additions: 1, deletions: 1, whitespaceOnly: false });
    expect(result.patch).not.toContain("@@ -1,2 +1,2 @@");
    expect(result.patch).toContain("@@ -10,2 +10,2 @@");

    const formatting = hideWhitespaceChanges(patch(["@@ -1 +1 @@", "-x\t=1", "+x = 1"]));
    expect(formatting).toMatchObject({ additions: 0, deletions: 0, whitespaceOnly: true });
  });

  it("keeps added blank lines and untouched patches", () => {
    const blank = patch(["@@ -1,2 +1,3 @@", " a", "+", " b"]);
    expect(hideWhitespaceChanges(blank)).toEqual({
      patch: blank,
      additions: 1,
      deletions: 0,
      whitespaceOnly: false,
    });
    const added = patch(["@@ -0,0 +1,2 @@", "+one", "+two"]);
    expect(hideWhitespaceChanges(added).patch).toBe(added);
  });
});
