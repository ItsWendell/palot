import { parsePatchFiles } from "@pierre/diffs";
import { describe, expect, it } from "vitest";
import {
  diffItemMarks,
  diffLineRow,
  layoutRailMarks,
  railScrollTop,
  type DiffRailItem,
} from "./diff-change-markers";

// Two hunks: a pure addition after line 2, then a replacement and a removal near line 20.
const PATCH = `diff --git a/a.ts b/a.ts
--- a/a.ts
+++ b/a.ts
@@ -1,4 +1,5 @@
 one
 two
+added
 three
 four
@@ -20,6 +21,5 @@
 twenty
-old
+new
 keep
-gone
 tail
 end
`;

function fileDiff() {
  const diff = parsePatchFiles(PATCH)[0]?.files[0];
  if (!diff) throw new Error("patch did not parse");
  return diff;
}

describe("diffItemMarks", () => {
  it("classifies change blocks and counts rows with one row per folded gap", () => {
    const { marks, rows } = diffItemMarks(fileDiff(), {
      layout: "unified",
      expandUnchanged: false,
    });
    expect(marks.map(({ kind, line }) => ({ kind, line }))).toEqual([
      { kind: "added", line: 3 },
      { kind: "modified", line: 22 },
      { kind: "removed", line: 23 },
    ]);
    // Hunk 1: 5 rows. Gap before hunk 2: 1 row. Hunk 2 unified: 7 rows.
    expect(rows).toBe(13);
    expect(marks.map((mark) => [mark.row, mark.rows])).toEqual([
      [2, 1],
      [7, 2],
      [10, 1],
    ]);
  });

  it("pairs deletions with additions in split rows and expands gaps on request", () => {
    const { marks, rows } = diffItemMarks(fileDiff(), { layout: "split", expandUnchanged: true });
    // The gap before hunk 2 is 15 unchanged lines; the replacement takes one split row.
    expect(rows).toBe(5 + 15 + 6);
    expect(marks[1]).toMatchObject({ kind: "modified", row: 21, rows: 1 });
  });

  it("finds the row of a line on either side", () => {
    const options = { layout: "unified" as const, expandUnchanged: false };
    expect(diffLineRow(fileDiff(), "additions", 3, options)).toBe(2);
    expect(diffLineRow(fileDiff(), "deletions", 21, options)).toBe(7);
    // Unified rows list the deletion before its replacement.
    expect(diffLineRow(fileDiff(), "additions", 22, options)).toBe(8);
    expect(diffLineRow(fileDiff(), "additions", 10, options)).toBeNull();
  });
});

describe("layoutRailMarks", () => {
  it("maps rows onto each item's content below its header and skips folded items", () => {
    const diff = fileDiff();
    const items: DiffRailItem[] = [
      {
        id: "a.ts",
        top: 100,
        height: 32 + 130,
        headerHeight: 32,
        fileDiff: diff,
        collapsed: false,
      },
      { id: "b.ts", top: 300, height: 32, headerHeight: 32, fileDiff: diff, collapsed: true },
    ];
    const marks = layoutRailMarks(items, { layout: "unified", expandUnchanged: false }, [
      { itemID: "a.ts", side: "additions", lineNumber: 3 },
      { itemID: "b.ts", side: "additions", lineNumber: 3 },
    ]);
    // 13 rows over 130px: 10px a row.
    expect(marks).toEqual([
      { kind: "added", top: 152, height: 10, itemID: "a.ts", line: 3 },
      { kind: "modified", top: 202, height: 20, itemID: "a.ts", line: 22 },
      { kind: "removed", top: 232, height: 10, itemID: "a.ts", line: 23 },
      { kind: "match", top: 152, height: 10, itemID: "a.ts", line: 3 },
    ]);
  });
});

describe("railScrollTop", () => {
  it("centres the viewport on the pressed point and clamps to the scroll range", () => {
    // A 200px rail over 2000px of content in a 400px viewport.
    expect(railScrollTop(100, 200, 2000, 400)).toBe(800);
    expect(railScrollTop(0, 200, 2000, 400)).toBe(0);
    expect(railScrollTop(200, 200, 2000, 400)).toBe(1600);
    expect(railScrollTop(-20, 200, 2000, 400)).toBe(0);
    expect(railScrollTop(10, 0, 2000, 400)).toBe(0);
  });
});
