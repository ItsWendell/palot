import { describe, expect, it } from "vitest";
import { AUTO_SPLIT_MIN_WIDTH, hasTwoSidedChanges, resolveDiffLayout } from "./diff-layout";
import { resolveFileDiff } from "./file-diffs";

const modified = resolveFileDiff({
  file: "a.ts",
  patch: ["--- a/a.ts", "+++ b/a.ts", "@@ -1,2 +1,2 @@", " keep", "-old", "+new"].join("\n"),
});
const added = resolveFileDiff({
  file: "b.ts",
  patch: ["--- /dev/null", "+++ b/b.ts", "@@ -0,0 +1,2 @@", "+one", "+two"].join("\n"),
});
const separate = resolveFileDiff({
  file: "c.ts",
  patch: ["--- a/c.ts", "+++ b/c.ts", "@@ -1,3 +1,3 @@", "-gone", " keep", "+fresh", " also"].join(
    "\n",
  ),
});

describe("Auto diff layout", () => {
  it("treats only replaced lines as two-sided", () => {
    expect(hasTwoSidedChanges(modified)).toBe(true);
    expect(hasTwoSidedChanges(added)).toBe(false);
    // A removal and an addition that never pair leave one split column empty per row.
    expect(hasTwoSidedChanges(separate)).toBe(false);
  });

  it("splits only wide panes with replaced lines", () => {
    const wide = AUTO_SPLIT_MIN_WIDTH;
    expect(resolveDiffLayout("auto", { width: wide, twoSided: true })).toBe("split");
    expect(resolveDiffLayout("auto", { width: wide - 1, twoSided: true })).toBe("unified");
    expect(resolveDiffLayout("auto", { width: wide * 2, twoSided: false })).toBe("unified");
  });

  it("keeps explicit choices regardless of width", () => {
    expect(resolveDiffLayout("split", { width: 200, twoSided: false })).toBe("split");
    expect(resolveDiffLayout("unified", { width: 2000, twoSided: true })).toBe("unified");
  });
});
