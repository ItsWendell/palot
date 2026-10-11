import { describe, expect, it } from "vitest";
import { findDiffMatches, preservedDiffMatch, stepDiffMatch } from "./diff-find";
import { resolveFileDiff } from "./file-diffs";

const app = resolveFileDiff({
  file: "app.ts",
  patch: [
    "--- a/app.ts",
    "+++ b/app.ts",
    "@@ -10,3 +10,3 @@",
    " const widget = 1;",
    "-useWidget(widget);",
    "+renderWidget(Widget, widget);",
    " done();",
  ].join("\n"),
});

describe("findDiffMatches", () => {
  it("finds case-insensitive matches with their side and line number in display order", () => {
    const result = findDiffMatches([{ id: "app.ts", fileDiff: app }], "widget");
    expect(result.truncated).toBe(false);
    expect(result.matches).toEqual([
      { itemID: "app.ts", side: "additions", lineNumber: 10, occurrence: 0 },
      { itemID: "app.ts", side: "deletions", lineNumber: 11, occurrence: 0 },
      { itemID: "app.ts", side: "deletions", lineNumber: 11, occurrence: 1 },
      { itemID: "app.ts", side: "additions", lineNumber: 11, occurrence: 0 },
      { itemID: "app.ts", side: "additions", lineNumber: 11, occurrence: 1 },
      { itemID: "app.ts", side: "additions", lineNumber: 11, occurrence: 2 },
    ]);
    expect(findDiffMatches([{ id: "app.ts", fileDiff: app }], "   ").matches).toEqual([]);
  });

  it("caps matches and reports truncation", () => {
    const lines = Array.from({ length: 300 }, (_, index) => `+x${index}`);
    const big = resolveFileDiff({
      file: "big.txt",
      patch: ["--- /dev/null", "+++ b/big.txt", "@@ -0,0 +1,300 @@", ...lines].join("\n"),
    });
    const result = findDiffMatches([{ id: "big.txt", fileDiff: big }], "x");
    expect(result.matches).toHaveLength(250);
    expect(result.truncated).toBe(true);
  });

  it("steps with wraparound and keeps the selected match across refreshes", () => {
    expect(stepDiffMatch(-1, 3, "next")).toBe(0);
    expect(stepDiffMatch(2, 3, "next")).toBe(0);
    expect(stepDiffMatch(0, 3, "previous")).toBe(2);
    const { matches } = findDiffMatches([{ id: "app.ts", fileDiff: app }], "widget");
    expect(preservedDiffMatch(matches.slice(1), matches[3]!, 3)).toBe(2);
  });
});
