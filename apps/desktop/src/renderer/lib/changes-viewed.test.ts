import { beforeEach, describe, expect, it } from "vitest";
import {
  changesViewedScope,
  diffFingerprint,
  loadViewedMarks,
  resetViewedMarksCache,
  setFileViewed,
  viewedState,
} from "./changes-viewed";

const narrow = [
  "--- a/src/a.ts",
  "+++ b/src/a.ts",
  "@@ -10,3 +10,3 @@",
  " const a = 1;",
  "-const b = 2;",
  "+const b = 3;",
  " const c = 4;",
].join("\n");

const wide = [
  "--- a/src/a.ts",
  "+++ b/src/a.ts",
  "@@ -1,20 +1,20 @@",
  " import x from 'x';",
  " const a = 1;",
  "-const b = 2;",
  "+const b = 3;",
  " const c = 4;",
  " export {};",
].join("\n");

beforeEach(() => {
  window.localStorage.clear();
  resetViewedMarksCache();
});

describe("changes viewed marks", () => {
  it("keeps a fingerprint across context size and hunk position, not across edits", () => {
    expect(diffFingerprint(wide, "modified")).toBe(diffFingerprint(narrow, "modified"));
    expect(diffFingerprint(narrow.replace("+const b = 3;", "+const b = 5;"), "modified")).not.toBe(
      diffFingerprint(narrow, "modified"),
    );
    expect(diffFingerprint(narrow, "added")).not.toBe(diffFingerprint(narrow, "modified"));
  });

  it("reads a mark as changed once the file's diff moves on", () => {
    const scope = changesViewedScope("local", "ses_1", "working");
    setFileViewed(scope, "src/a.ts", diffFingerprint(narrow));
    const marks = loadViewedMarks(scope);
    expect(viewedState(marks, "src/a.ts", diffFingerprint(narrow))).toBe("viewed");
    expect(viewedState(marks, "src/a.ts", diffFingerprint(`${narrow}\n+more`))).toBe("changed");
    expect(viewedState(marks, "src/b.ts", "x")).toBe("unviewed");
  });

  it("persists per task and mode, and drops marks for files that left the diff", () => {
    const working = changesViewedScope("local", "ses_1", "working");
    const branch = changesViewedScope("local", "ses_1", "branch");
    setFileViewed(working, "src/a.ts", "f1");
    setFileViewed(working, "src/b.ts", "f2", ["src/a.ts", "src/b.ts"]);
    resetViewedMarksCache();
    expect(loadViewedMarks(working)).toEqual({ "src/a.ts": "f1", "src/b.ts": "f2" });
    expect(loadViewedMarks(branch)).toEqual({});

    setFileViewed(working, "src/b.ts", null, ["src/b.ts"]);
    expect(loadViewedMarks(working)).toEqual({});
  });
});
