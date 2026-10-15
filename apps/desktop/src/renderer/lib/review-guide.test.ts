import { describe, expect, it } from "vitest";
import type { PullRequestFile } from "../../shared/source-control-contract";
import {
  buildGuideInput,
  buildGuidePrompt,
  changedRanges,
  isGuideStale,
  MAX_EXCERPT_LINES,
  normalizeGuide,
  readGuideResponse,
  SKIM_STOP_TITLE,
  type ReviewGuideStop,
} from "./review-guide";

/** Lines 10–12 context, 13–14 replaced by 13–16, then context 17–18 (new side). */
const PATCH = [
  "@@ -10,7 +10,9 @@ function setup() {",
  " ten",
  " eleven",
  " twelve",
  "-old thirteen",
  "-old fourteen",
  "+new thirteen",
  "+new fourteen",
  "+new fifteen",
  "+new sixteen",
  " fifteen",
  " sixteen",
  "@@ -40,3 +42,4 @@",
  " forty",
  "+added forty-three",
  " forty-one",
  " forty-two",
].join("\n");

function file(path: string, overrides: Partial<PullRequestFile> = {}): PullRequestFile {
  return {
    path,
    previousPath: null,
    status: "modified",
    additions: 5,
    deletions: 2,
    patch: PATCH,
    viewed: "unviewed",
    ...overrides,
  };
}

const detail = {
  url: "https://github.com/acme/web/pull/7",
  number: 7,
  title: "Add widgets",
  body: "Adds **widgets**.",
  baseBranch: "main",
  headBranch: "feature",
  headOid: "head123",
};

function stop(overrides: Partial<ReviewGuideStop> = {}): ReviewGuideStop {
  return {
    title: "The service",
    summary: "",
    attention: null,
    excerpts: [],
    files: [],
    notes: [],
    questions: [],
    ...overrides,
  };
}

describe("buildGuideInput", () => {
  it("numbers every patch line on both sides", () => {
    const input = buildGuideInput(detail, {
      headOid: "head123",
      files: [file("src/a.ts")],
      truncated: false,
    });
    const lines = input.files[0]!.patch!.split("\n");
    expect(lines).toContain("10 10   ten");
    expect(lines).toContain("13    - old thirteen");
    expect(lines).toContain("   16 + new sixteen");
    expect(lines).toContain("   43 + added forty-three");
    // Each hunk is marked so the model never reads across one.
    expect(lines.filter((line) => line === "@@")).toHaveLength(2);
    expect(input.headSha).toBe("head123");
  });

  it("caps patches per file and in total, and says which files were cut or left out", () => {
    const big = Array.from({ length: 200 }, (_, index) => `+line ${index + 1}`);
    const bigPatch = ["@@ -0,0 +1,200 @@", ...big].join("\n");
    const input = buildGuideInput(
      detail,
      {
        headOid: "head123",
        files: [
          file("src/big.ts", { patch: bigPatch }),
          file("src/next.ts"),
          file("bun.lock"),
          file("logo.png", { patch: null }),
          file("src/late.ts"),
        ],
        truncated: true,
      },
      { maxPatchChars: 2_000, maxFileChars: 2_000, maxBodyChars: 5 },
    );
    const [big1, next, lock, logo, late] = input.files;
    expect(big1!.truncated).toBe(true);
    expect(big1!.patch!.length).toBeLessThanOrEqual(2_000 + 40);
    expect(big1!.patch).toMatch(/more lines not shown$/);
    expect(next!.omitted).toBe("budget");
    expect(lock!.omitted).toBe("lockfile");
    expect(logo!.omitted).toBe("binary");
    expect(late!.omitted).toBe("budget");
    expect(input.body).toBe("Adds \n… (cut)");
    expect(input.listTruncated).toBe(true);

    // Every file is still named in the prompt, so the guide can account for it.
    const prompt = buildGuidePrompt(input);
    for (const path of ["src/big.ts", "src/next.ts", "bun.lock", "logo.png", "src/late.ts"])
      expect(prompt).toContain(`- ${path}:`);
    expect(prompt).toContain("patch left out (size budget)");
  });
});

describe("readGuideResponse", () => {
  const valid = JSON.stringify({ stops: [{ title: "The contract", summary: "Why." }] });

  it("reads a fenced reply with prose around it and fills missing fields", () => {
    const result = readGuideResponse(`Here is the guide:\n\`\`\`json\n${valid}\n\`\`\`\nDone.`);
    expect(result).toEqual({
      ok: true,
      guide: {
        stops: [
          {
            title: "The contract",
            summary: "Why.",
            attention: null,
            excerpts: [],
            files: [],
            notes: [],
            questions: [],
          },
        ],
      },
    });
  });

  it("explains what is wrong so the repair prompt can say so", () => {
    expect(readGuideResponse("I could not do that.")).toEqual({
      ok: false,
      error: "The reply contains no JSON object.",
    });
    expect(readGuideResponse('{"stops": [ {"title": }')).toMatchObject({ ok: false });
    expect(readGuideResponse('{"tour": []}')).toEqual({
      ok: false,
      error: 'The object has no "stops" array.',
    });
    expect(readGuideResponse('{"stops": [{"summary": "untitled"}]}')).toEqual({
      ok: false,
      error: "No stop has a title.",
    });
  });

  it("drops malformed entries and an unknown attention kind", () => {
    const result = readGuideResponse(
      JSON.stringify({
        stops: [
          {
            title: "A",
            attention: { kind: "nit", note: "rename it" },
            excerpts: [{ path: "src/a.ts", start: "13", end: 14 }, { path: "src/a.ts" }],
            notes: [{ path: "src/a.ts", line: 0, title: "Bad line" }],
            questions: ["Why?", 3, ""],
          },
        ],
      }),
    );
    expect(result.ok && result.guide.stops[0]).toMatchObject({
      attention: null,
      excerpts: [{ path: "src/a.ts", side: "new", start: 13, end: 14, caption: "" }],
      notes: [],
      questions: ["Why?"],
    });
  });
});

describe("normalizeGuide", () => {
  it("clamps excerpts to changed lines on their side and drops ones outside the change", () => {
    const stops = normalizeGuide(
      {
        stops: [
          stop({
            excerpts: [
              // Starts on context lines: narrowed to the first changed line.
              { path: "src/a.ts", side: "new", start: 10, end: 15, caption: "" },
              // Only context lines: not part of the change.
              { path: "src/a.ts", side: "new", start: 17, end: 18, caption: "" },
              { path: "src/a.ts", side: "old", start: 1, end: 13, caption: "removed" },
              // A file the change does not touch.
              { path: "src/elsewhere.ts", side: "new", start: 1, end: 5, caption: "" },
              // A stray prefix still finds the file.
              { path: "b/src/a.ts", side: "new", start: 43, end: 43, caption: "" },
            ],
          }),
        ],
      },
      [file("src/a.ts")],
    );
    expect(stops[0]!.excerpts).toEqual([
      { path: "src/a.ts", side: "new", start: 13, end: 15, caption: "" },
      { path: "src/a.ts", side: "old", start: 13, end: 13, caption: "removed" },
      { path: "src/a.ts", side: "new", start: 43, end: 43, caption: "" },
    ]);
  });

  it("merges touching excerpts and caps their length", () => {
    const long = Array.from({ length: 80 }, (_, index) => `+line ${index + 1}`);
    const stops = normalizeGuide(
      {
        stops: [
          stop({
            excerpts: [
              { path: "src/new.ts", side: "new", start: 1, end: 10, caption: "head" },
              { path: "src/new.ts", side: "new", start: 11, end: 70, caption: "" },
            ],
          }),
        ],
      },
      [file("src/new.ts", { status: "added", patch: ["@@ -0,0 +1,80 @@", ...long].join("\n") })],
    );
    expect(stops[0]!.excerpts).toEqual([
      { path: "src/new.ts", side: "new", start: 1, end: MAX_EXCERPT_LINES, caption: "head" },
    ]);
  });

  it("keeps notes only inside the stop's excerpts and drops untitled stops", () => {
    const stops = normalizeGuide(
      {
        stops: [
          stop({ title: "  " }),
          stop({
            excerpts: [{ path: "src/a.ts", side: "new", start: 13, end: 16, caption: "" }],
            notes: [
              { path: "src/a.ts", line: 14, title: "Why two calls", body: "" },
              { path: "src/a.ts", line: 43, title: "Outside", body: "" },
              { path: "src/other.ts", line: 14, title: "Wrong file", body: "" },
            ],
            attention: { kind: "risk", note: "   " },
          }),
        ],
      },
      [file("src/a.ts")],
    );
    expect(stops).toHaveLength(1);
    expect(stops[0]!.notes.map((note) => note.title)).toEqual(["Why two calls"]);
    expect(stops[0]!.attention).toBeNull();
  });

  it("accounts for every changed file: listed once, the rest in a closing skim stop", () => {
    const stops = normalizeGuide(
      {
        stops: [
          stop({
            title: "Contract",
            excerpts: [{ path: "src/a.ts", side: "new", start: 13, end: 14, caption: "" }],
            // Excerpted files need no entry; unknown ones are dropped.
            files: [{ path: "src/a.ts" }, { path: "src/ghost.ts" }, { path: "docs/a.md" }],
          }),
          stop({ title: "Docs", files: [{ path: "docs/a.md", note: "again" }] }),
        ],
      },
      [file("src/a.ts"), file("docs/a.md"), file("src/b.ts"), file("assets/logo.png")],
    );
    expect(stops.map((entry) => entry.title)).toEqual(["Contract", "Docs", SKIM_STOP_TITLE]);
    expect(stops[0]!.files).toEqual([{ path: "docs/a.md" }]);
    expect(stops[1]!.files).toEqual([]);
    expect(stops[2]!.files).toEqual([{ path: "src/b.ts" }, { path: "assets/logo.png" }]);
  });
});

describe("guide state", () => {
  it("is stale only when the pull request moved to another head", () => {
    expect(isGuideStale({ headSha: "a" }, "a")).toBe(false);
    expect(isGuideStale({ headSha: "a" }, "b")).toBe(true);
    expect(isGuideStale(null, "b")).toBe(false);
  });

  it("reads changed ranges per side from a patch", () => {
    expect(changedRanges(PATCH)).toEqual({
      new: [
        { start: 13, end: 16 },
        { start: 43, end: 43 },
      ],
      old: [{ start: 13, end: 14 }],
    });
  });
});
