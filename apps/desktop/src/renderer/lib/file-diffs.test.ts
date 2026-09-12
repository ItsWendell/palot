import { describe, expect, it } from "vitest";
import { resolveFileDiff, resolveFileReadDiff, resolveFileSnippetDiff } from "./file-diffs";

describe("resolveFileDiff", () => {
  it("changes the Pierre cache key when streamed contents change", () => {
    const first = resolveFileDiff({ file: "src/a.ts", before: "old\n", after: "new\n" });
    const repeated = resolveFileDiff({ file: "src/a.ts", before: "old\n", after: "new\n" });
    const updated = resolveFileDiff({
      file: "src/a.ts",
      before: "old\nolder\n",
      after: "new\nnewer\n",
    });

    expect(first?.cacheKey).toBe(repeated?.cacheKey);
    expect(repeated).toBe(first);
    expect(updated?.cacheKey).not.toBe(first?.cacheKey);
  });

  it("changes the Pierre cache key when patch contents change", () => {
    const first = resolveFileDiff({
      file: "src/a.ts",
      patch: "@@ -1 +1 @@\n-old\n+new",
    });
    const repeated = resolveFileDiff({
      file: "src/a.ts",
      patch: "@@ -1 +1 @@\n-old\n+new",
    });
    const updated = resolveFileDiff({
      file: "src/a.ts",
      patch: "@@ -1 +1 @@\n-old\n+newer",
    });

    expect(first?.cacheKey).toBe(repeated?.cacheKey);
    expect(repeated).toBe(first);
    expect(updated?.cacheKey).not.toBe(first?.cacheKey);
  });

  it("changes the Pierre cache key when file-read contents change", () => {
    const first = resolveFileReadDiff("src/a.ts", 1, [{ number: 1, text: "old" }]);
    const repeated = resolveFileReadDiff("src/a.ts", 1, [{ number: 1, text: "old" }]);
    const updated = resolveFileReadDiff("src/a.ts", 1, [{ number: 1, text: "new" }]);

    expect(first?.cacheKey).toBe(repeated?.cacheKey);
    expect(repeated).toBe(first);
    expect(updated?.cacheKey).not.toBe(first?.cacheKey);
  });

  it("renders sparse source lines as separate highlighted hunks", () => {
    const diff = resolveFileSnippetDiff("src/a.ts", [
      { number: 2, text: "const first = true;" },
      { number: 3, text: "const second = true;" },
      { number: 20, text: "return second;" },
    ]);

    expect(diff?.hunks).toMatchObject([
      { deletionStart: 2, additionStart: 2 },
      { deletionStart: 20, additionStart: 20 },
    ]);
    expect(diff?.additionLines).toEqual([
      "const first = true;\n",
      "const second = true;\n",
      "return second;",
    ]);
  });

  it("parses a complete unified patch without rendering patch headers as source lines", () => {
    const diff = resolveFileDiff({
      file: "src/app.ts",
      patch: [
        "Index: src/app.ts",
        "===================================================================",
        "--- src/app.ts\t",
        "+++ src/app.ts\t",
        "@@ -12,3 +12,3 @@",
        " const before = true;",
        "-const value = 'old';",
        "+const value = 'new';",
        " export { value };",
      ].join("\n"),
    });

    expect(diff).toMatchObject({
      name: "src/app.ts",
      hunks: [
        expect.objectContaining({
          deletionStart: 12,
          additionStart: 12,
          deletionLines: 1,
          additionLines: 1,
        }),
      ],
    });
    expect(diff?.deletionLines.join("")).not.toContain("Index:");
    expect(diff?.additionLines.join("")).not.toContain("---");
  });

  it("adds file headers to a headerless tool hunk", () => {
    const diff = resolveFileDiff({
      file: "src/app.ts",
      patch: "@@ -4,2 +4,2 @@\n-old\n+new\n unchanged",
    });

    expect(diff).toMatchObject({
      name: "src/app.ts",
      hunks: [expect.objectContaining({ deletionStart: 4, additionStart: 4 })],
    });
  });

  it("computes unchanged and changed rows from before and after contents", () => {
    const diff = resolveFileDiff({
      file: "src/app.ts",
      before: "first\nold\nlast\n",
      after: "first\nnew\nlast\n",
    });

    expect(diff?.hunks).toHaveLength(1);
    expect(diff?.hunks[0]).toMatchObject({ deletionLines: 1, additionLines: 1 });
    expect(diff?.deletionLines).toEqual(["first\n", "old\n", "last\n"]);
    expect(diff?.additionLines).toEqual(["first\n", "new\n", "last\n"]);
  });

  it("does not fabricate a deleted line for a new file", () => {
    const diff = resolveFileDiff({ file: "src/new.ts", after: "export const value = true;\n" });

    expect(diff).toMatchObject({ type: "new" });
    expect(diff?.deletionLines).toEqual([]);
    expect(diff?.additionLines).toEqual(["export const value = true;\n"]);
  });

  it("does not fabricate an added line for a deleted file", () => {
    const diff = resolveFileDiff({ file: "src/old.ts", before: "export const value = true;\n" });

    expect(diff).toMatchObject({ type: "deleted" });
    expect(diff?.deletionLines).toEqual(["export const value = true;\n"]);
    expect(diff?.additionLines).toEqual([]);
  });

  it("falls back to file contents when a patch is invalid", () => {
    const diff = resolveFileDiff({
      file: "src/app.ts",
      patch: "not a unified patch",
      before: "old\n",
      after: "new\n",
    });

    expect(diff?.hunks[0]).toMatchObject({ deletionLines: 1, additionLines: 1 });
  });
});
