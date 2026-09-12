import { getSharedHighlighter } from "@pierre/diffs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getPatchPresentation,
  getPatchSections,
  highlightPatchPage,
  type PatchSection,
} from "./patch-presentation";
import {
  createStreamingPatchDocument,
  createStreamingPatchInputState,
  streamPatchInput,
} from "./streaming-patch-input";

const theme = "github-dark";
const present = (text: string) => getPatchPresentation(createStreamingPatchDocument(text));

afterEach(() => vi.restoreAllMocks());

function sectionRows(section: PatchSection) {
  return Array.from({ length: section.lineCount }, (_, index) => section.getLine(index)!);
}

describe("patch sections", () => {
  it("maps all 2,400 code lines into two files without rendering patch commands", () => {
    const first = Array.from({ length: 1_200 }, (_, index) => `+const first${index} = ${index};`);
    const second = Array.from({ length: 1_200 }, (_, index) => `+second_${index} = ${index}`);
    const original = [
      "*** Begin Patch",
      "*** Add File: first.ts",
      ...first,
      "*** Add File: second.py",
      ...second,
      "*** End Patch\n",
    ].join("\n");
    const document = createStreamingPatchDocument(original);
    const sections = getPatchSections(document);
    expect(
      sections.map((section) => ({
        file: section.file,
        count: section.lineCount,
        additions: section.additions,
        operation: section.operation,
      })),
    ).toEqual([
      { file: "first.ts", count: 1_200, additions: 1_200, operation: "add" },
      { file: "second.py", count: 1_200, additions: 1_200, operation: "add" },
    ]);
    const rows = sections.flatMap(sectionRows);
    expect(rows.every((row) => row.kind === "code")).toBe(true);
    expect(rows.map((row) => (row.kind === "code" ? row.line.code : row.label))).toEqual([
      ...first.map((line) => line.slice(1)),
      ...second.map((line) => line.slice(1)),
    ]);
    expect(sections[0]!.getLine(1199)).toMatchObject({ lineNumber: 1200, sourceLine: 1202 });
    expect(sections[1]!.getLine(0)).toMatchObject({ lineNumber: 1, sourceLine: 1204 });
    expect(sections[1]!.getLine(1199)).toMatchObject({ lineNumber: 1200, sourceLine: 2403 });
    expect(sections[0]!.getLine(1200)).toBeUndefined();
    expect(sections[0]!.getLine(-1)).toBeUndefined();
    expect(getPatchSections(document)).toBe(sections);
    expect(document.text).toBe(original);
  });

  it("keeps long lines and literal plus/minus characters after stripping only the patch prefix", () => {
    const long = `const value = "${"x".repeat(50_000)}";`;
    const section = getPatchSections(
      createStreamingPatchDocument(
        `*** Update File: example.ts\n@@ function example()\n+++counter;\n---counter;\n+${long}\n`,
      ),
    )[0]!;
    expect(
      sectionRows(section).map((row) => (row.kind === "code" ? row.line.code : row.label)),
    ).toEqual(["function example()", "++counter;", "--counter;", long]);
    expect(section.additions).toBe(2);
    expect(section.deletions).toBe(1);
    expect(section.getLine(1)).toMatchObject({ lineNumber: undefined });
  });

  it("hides incomplete commands and keeps prior page references and section IDs during append", () => {
    const initial = streamPatchInput(
      createStreamingPatchInputState(),
      "*** Begin Patch\n*** Add Fi",
    );
    expect(getPatchSections(initial.document)).toEqual([]);
    const first = streamPatchInput(
      initial,
      `le: first.ts\n${Array(260).fill("+const value = 1;\n").join("")}*** Upd`,
    );
    const a = getPatchSections(first.document);
    expect(a).toHaveLength(1);
    expect(a[0]!.lineCount).toBe(260);
    const second = streamPatchInput(first, "ate File: next.py\n@@\n-old\n+ne");
    const b = getPatchSections(second.document);
    expect(b).toHaveLength(2);
    expect(b[0]!.id).toBe(a[0]!.id);
    const firstRow = a[0]!.getLine(0)!;
    const nextRow = b[0]!.getLine(0)!;
    expect(firstRow.kind).toBe("code");
    expect(nextRow.kind).toBe("code");
    if (firstRow.kind === "code" && nextRow.kind === "code") {
      expect(firstRow.page).toBe(nextRow.page);
      expect(firstRow.line).toBe(nextRow.line);
    }
    expect(b[1]!.getLine(2)).toMatchObject({ kind: "code", line: { code: "ne" } });
    const third = streamPatchInput(second, "w\n*** End Patch");
    const c = getPatchSections(third.document);
    expect(c[1]!.id).toBe(b[1]!.id);
    expect(c[1]!.getLine(2)).toMatchObject({ kind: "code", line: { code: "new" } });
    expect(b[1]!.getLine(2)).toMatchObject({ kind: "code", line: { code: "ne" } });
  });

  it("keeps empty deletes and native moves as separate file sections", () => {
    const sections = getPatchSections(
      createStreamingPatchDocument(
        [
          "*** Begin Patch",
          "*** Delete File: gone.ts",
          "*** Update File: old.ts",
          "*** Move to: new.ts",
          "@@",
          "-const old = true;",
          "+const next = true;",
          "*** End Patch",
        ].join("\n"),
      ),
    );
    expect(sections[0]).toMatchObject({
      file: "gone.ts",
      operation: "delete",
      lineCount: 0,
      additions: 0,
      deletions: 0,
    });
    expect(sections[1]).toMatchObject({
      file: "new.ts",
      previousFile: "old.ts",
      operation: "update",
      lineCount: 3,
    });
    expect(sections[1]!.getLine(0)).toEqual({ kind: "hunk", label: "Changed lines" });
    expect(sections[1]!.getLine(1)).toMatchObject({
      kind: "code",
      lineNumber: undefined,
      line: { file: "new.ts" },
    });
    expect(
      getPatchSections(createStreamingPatchDocument("*** Delete File: last.ts"))[0],
    ).toMatchObject({ file: "last.ts", operation: "delete" });
  });

  it("uses actual unified line numbers, retains separate hunk boundaries, and detects add/delete", () => {
    const sections = getPatchSections(
      createStreamingPatchDocument(
        [
          "diff --git a/file.ts b/file.ts",
          "--- a/file.ts",
          "+++ b/file.ts",
          "@@ -10,3 +20,3 @@ function example()",
          " context",
          "-old",
          "+next",
          " context2",
          "@@ -100 +200 @@",
          "-old2",
          "+next2",
          "diff --git a/added.py b/added.py",
          "--- /dev/null",
          "+++ b/added.py",
          "@@ -0,0 +1 @@",
          "+print(True)",
          "diff --git a/deleted.py b/deleted.py",
          "--- a/deleted.py",
          "+++ /dev/null",
          "@@ -5 +0,0 @@",
          "-print(False)\n",
        ].join("\n"),
      ),
    );
    expect(
      sectionRows(sections[0]!).map((row) => (row.kind === "hunk" ? row.label : row.lineNumber)),
    ).toEqual(["function example()", 20, 11, 21, 22, "Changed lines", 100, 200]);
    expect(sections[0]).toMatchObject({ additions: 2, deletions: 2, previousFile: undefined });
    expect(sections[1]).toMatchObject({ file: "added.py", operation: "add" });
    expect(sections[1]!.getLine(1)).toMatchObject({ lineNumber: 1 });
    expect(sections[2]).toMatchObject({ file: "deleted.py", operation: "delete" });
    expect(sections[2]!.getLine(1)).toMatchObject({ lineNumber: 5 });
  });

  it("carries unified counters across pages and separates files without git headers", () => {
    const sections = getPatchSections(
      createStreamingPatchDocument(
        [
          "--- a/first.ts",
          "+++ b/first.ts",
          "@@ -10,131 +20,131 @@",
          ...Array(130).fill(" context"),
          "-old",
          "+next",
          "--- a/second.py",
          "+++ b/second.py",
          "@@ -1 +1 @@",
          "-False",
          "+True\n",
        ].join("\n"),
      ),
    );
    expect(sections).toHaveLength(2);
    expect(sections[0]!.getLine(130)).toMatchObject({ lineNumber: 149 });
    expect(sections[0]!.getLine(131)).toMatchObject({ lineNumber: 140 });
    expect(sections[0]!.getLine(132)).toMatchObject({ lineNumber: 150 });
    expect(sections[1]).toMatchObject({
      file: "second.py",
      lineCount: 3,
      additions: 1,
      deletions: 1,
    });
  });
});

describe("patch presentation", () => {
  it("keeps native metadata separate from code without changing any characters", () => {
    const raw = [
      "*** Begin Patch\r",
      "*** Update File: old.ts\r",
      "*** Move to: new.ts\r",
      "@@ function example()\r",
      "--- not a file header\r",
      "+++ not a file header\r",
      " \tcontext\r",
      "+\r",
      "*** End of File\r",
      "*** Delete File: gone.py\r",
      "*** Add File: added.css\r",
      "+body {}\r",
      "*** End Patch",
    ];
    const presentation = present(raw.join("\n"));
    const lines = presentation.pages.flatMap((page) => page.lines);
    expect(lines.map((line) => line.marker + line.code)).toEqual(raw);
    expect(lines.map((line) => line.text)).toEqual(raw);
    expect(lines.map((line) => line.kind)).toEqual([
      "metadata",
      "metadata",
      "metadata",
      "metadata",
      "deletion",
      "addition",
      "context",
      "addition",
      "metadata",
      "metadata",
      "metadata",
      "addition",
      "metadata",
    ]);
    expect(lines[4]?.file).toBe("new.ts");
    expect(lines[11]?.file).toBe("added.css");
    expect(presentation.getLine(-1)).toBeUndefined();
    expect(presentation.getLine(0.5)).toBeUndefined();
    expect(presentation.getLine(raw.length)).toBeUndefined();
    expect(present("").getLine(0)).toBeUndefined();
  });

  it("recognizes unified file headers, including deleted files and quoted paths", () => {
    const presentation = present(
      [
        'diff --git "a/old file.py" "b/old file.py"',
        "deleted file mode 100644",
        '--- "a/old file.py"',
        "+++ /dev/null",
        "@@ -1 +0,0 @@",
        "-print(True)",
        "diff --git a/new.ts b/new.ts",
        "--- /dev/null",
        "+++ b/new.ts\t2026-09-05",
        "@@ -0,0 +1 @@",
        "+const answer = 42;",
      ].join("\n"),
    );
    expect(presentation.getLine(3)?.line.kind).toBe("metadata");
    expect(presentation.getLine(5)?.line.file).toBe("old file.py");
    expect(presentation.getLine(8)?.line.kind).toBe("metadata");
    expect(presentation.getLine(10)?.line.file).toBe("new.ts");
  });

  it("updates a growing tail without reprocessing or rewriting published pages", () => {
    const prefix = ["*** Begin Patch", "*** Add File: example.ts", ...Array(126).fill("+// line")];
    const first = streamPatchInput(createStreamingPatchInputState(), `${prefix.join("\n")}\n+con`);
    const a = getPatchPresentation(first.document);
    const second = streamPatchInput(first, "st answer = 42;");
    const b = getPatchPresentation(second.document);
    const third = streamPatchInput(second, "\n+next");
    const c = getPatchPresentation(third.document);
    expect(getPatchPresentation(first.document)).toBe(a);
    expect(a.pages[0]).toBe(b.pages[0]);
    expect(b.pages[0]).toBe(c.pages[0]);
    expect(a.getLine(127)?.line).toBe(c.getLine(127)?.line);
    expect(a.getLine(128)?.line.code).toBe("con");
    expect(b.getLine(128)?.line.code).toBe("const answer = 42;");
    expect(c.getLine(128)?.line.code).toBe("const answer = 42;");
    expect(c.getLine(129)).toEqual({
      page: c.pages[2],
      index: 0,
      line: { text: "+next", code: "next", marker: "+", kind: "addition", file: "example.ts" },
    });
    expect(c.pages.every((page) => page.lines.length <= 128)).toBe(true);
  });

  it("keys reused raw pages by incoming file context", () => {
    const ts = createStreamingPatchDocument(
      ["*** Add File: example.ts", ...Array(127).fill("+// line"), "+value\n"].join("\n"),
    );
    const py = createStreamingPatchDocument(
      ["*** Add File: example.py", ...Array(127).fill("+# line"), "+value\n"].join("\n"),
    );
    py.pages[1] = ts.pages[1]!;
    const a = getPatchPresentation(ts);
    const b = getPatchPresentation(py);
    expect(a.getLine(128)?.line.file).toBe("example.ts");
    expect(b.getLine(128)?.line.file).toBe("example.py");
    expect(a.pages[1]).not.toBe(b.pages[1]);
  });
});

describe("patch highlighting", () => {
  it("highlights multiple file languages and carries the filename across a page boundary", async () => {
    const presentation = present(
      [
        "*** Add File: example.ts",
        ...Array(127).fill("+// preceding page"),
        "+const answer: number = 42;",
        "*** Add File: example.py",
        "+def answer(): return True",
        "*** End Patch\n",
      ].join("\n"),
    );
    const page = presentation.pages[1]!;
    const highlighter = await getSharedHighlighter({
      themes: [theme],
      langs: ["typescript", "python"],
    });
    const ts = highlighter.codeToTokens("const answer: number = 42;", {
      theme,
      lang: "typescript",
      tokenizeTimeLimit: 0,
    });
    const py = highlighter.codeToTokens("def answer(): return True", {
      theme,
      lang: "python",
      tokenizeTimeLimit: 0,
    });
    const tokenize = vi.spyOn(highlighter, "codeToTokens");
    const highlighted = await highlightPatchPage(page, theme);
    expect(highlighted.lines[0]).toEqual(ts.tokens[0]);
    expect(highlighted.lines[2]).toEqual(py.tokens[0]);
    expect(highlighted.lines[1]).toEqual([{ content: "*** Add File: example.py" }]);
    expect(highlighted.foreground).toBe(ts.fg);
    expect(tokenize.mock.calls.map(([code]) => code)).toEqual([
      "const answer: number = 42;",
      "def answer(): return True",
    ]);
  });

  it("separates old and new lexical state and resets it at each hunk", async () => {
    const page = present(
      [
        "*** Update File: example.ts",
        "@@",
        "-/* removed comment",
        "+const answer = 42;",
        "-still a comment */",
        "+const next = true;",
        "@@ another hunk",
        "-/* another removed comment",
        "@@ final hunk",
        "+const final = false;\n",
      ].join("\n"),
    ).pages[0]!;
    const highlighter = await getSharedHighlighter({ themes: [theme], langs: ["typescript"] });
    const expected = highlighter.codeToTokens("const answer = 42;\nconst next = true;", {
      theme,
      lang: "typescript",
      tokenizeTimeLimit: 0,
    });
    const deleted = highlighter.codeToTokens("/* removed comment\nstill a comment */", {
      theme,
      lang: "typescript",
      tokenizeTimeLimit: 0,
    });
    const final = highlighter.codeToTokens("const final = false;", {
      theme,
      lang: "typescript",
      tokenizeTimeLimit: 0,
    });
    const highlighted = await highlightPatchPage(page, theme);
    expect(highlighted.lines[3]).toEqual(expected.tokens[0]);
    expect(highlighted.lines[5]).toEqual(expected.tokens[1]);
    expect(highlighted.lines[4]).toEqual(deleted.tokens[1]);
    expect(highlighted.lines[9]).toEqual(final.tokens[0]);
  });

  it("bounds long-line grammar work while preserving long and CRLF text exactly", async () => {
    const long = `const text = "${"x".repeat(50_000)}";`;
    const raw = ["*** Add File: example.ts", `+${long}`, "+const next = true;\r", "+\r"];
    const page = present(`${raw.join("\n")}\n`).pages[0]!;
    const highlighter = await getSharedHighlighter({ themes: [theme], langs: ["typescript"] });
    const tokenize = vi.spyOn(highlighter, "codeToTokens");
    const highlighted = await highlightPatchPage(page, theme);
    expect(
      highlighted.lines.map(
        (tokens, index) => page.lines[index]!.marker + tokens.map((t) => t.content).join(""),
      ),
    ).toEqual(raw);
    expect(tokenize.mock.calls[0]?.[1].tokenizeMaxLineLength).toBeLessThan(long.length);
    expect(highlighted.lines[1]).toHaveLength(1);
  });

  it("falls back to plain text for unknown file types", async () => {
    const page = present("*** Add File: data.unknown-language\n+<unrecognized> & text\n").pages[0]!;
    const highlighter = await getSharedHighlighter({ themes: [theme], langs: [] });
    const tokenize = vi.spyOn(highlighter, "codeToTokens");
    const highlighted = await highlightPatchPage(page, theme);
    expect(highlighted.lines[1]).toEqual([{ content: "<unrecognized> & text" }]);
    expect(tokenize).not.toHaveBeenCalled();
  });

  it("shares pending work, keys the theme, and evicts old page results", async () => {
    const page = present("*** Add File: example.ts\n+const value = true;\n").pages[0]!;
    const dark = highlightPatchPage(page, theme);
    expect(highlightPatchPage(page, theme)).toBe(dark);
    const light = highlightPatchPage(page, "github-light");
    expect(light).not.toBe(dark);
    expect((await light).foreground).not.toBe((await dark).foreground);
    for (let i = 0; i < 25; i++) {
      await highlightPatchPage(present(`*** Add File: ${i}.txt\n+text\n`).pages[0]!, theme);
    }
    const reloaded = highlightPatchPage(page, theme);
    expect(reloaded).not.toBe(dark);
    expect(await reloaded).toEqual(await dark);
  });
});
