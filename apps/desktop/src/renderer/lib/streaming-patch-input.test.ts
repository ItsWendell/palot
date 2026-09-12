import { describe, expect, it } from "vitest";
import {
  createStreamingPatchDocument,
  createStreamingPatchInputState,
  getStreamingPatchLine,
  getStreamingPatchLineCount,
  streamPatchInput,
  type StreamingPatchDocument,
} from "./streaming-patch-input";

function lines(document: StreamingPatchDocument) {
  return Array.from({ length: getStreamingPatchLineCount(document) }, (_, index) =>
    getStreamingPatchLine(document, index),
  );
}

describe("streamPatchInput", () => {
  it("retains every line, long lines, headers, moves and the end marker", () => {
    const expected = [
      "*** Begin Patch",
      "*** Update File: src/a.ts",
      "*** Move to: src/renamed.ts",
      "@@",
      "-old",
      ...Array.from({ length: 600 }, (_, index) => `+line ${index}`),
      "*** Add File: src/b.ts",
      `+${"x".repeat(5_000)}`,
      "*** Delete File: src/removed.ts",
      "*** End Patch",
    ];
    const patchText = expected.join("\n");
    const json = JSON.stringify({ patchText });
    let state = createStreamingPatchInputState();
    for (let offset = 0; offset < json.length; offset += 17) {
      state = streamPatchInput(state, json.slice(offset, offset + 17));
    }

    expect(state.document.text).toBe(patchText);
    expect(lines(state.document)).toEqual(expected);
    expect(state.document.targetFiles).toEqual([
      "src/a.ts",
      "src/renamed.ts",
      "src/b.ts",
      "src/removed.ts",
    ]);
  });

  it("ignores patch-like text in unrelated JSON string fields", () => {
    const state = streamPatchInput(
      createStreamingPatchInputState(),
      JSON.stringify({ note: '*** Update File: wrong.ts\\"', patchText: "Index: right.ts\n" }),
    );

    expect(state.document.text).toBe("Index: right.ts\n");
    expect(state.document.targetFiles).toEqual(["right.ts"]);
    expect(lines(state.document)).toEqual(["Index: right.ts"]);
  });

  it("decodes JSON escapes split at every boundary, including surrogate pairs and keys", () => {
    const json =
      '{"patch\\u0054ext":"*** Update File: src/na\\u006de.ts\\r\\n+\\\"quoted\\\" \\\\ \\/ \\b \\f \\t \\uD83D\\uDE80 café 🚀\\n*** End Patch"}';
    const expected =
      '*** Update File: src/name.ts\r\n+"quoted" \\ / \b \f \t 🚀 café 🚀\n*** End Patch';
    for (let boundary = 0; boundary <= json.length; boundary += 1) {
      const first = streamPatchInput(createStreamingPatchInputState(), json.slice(0, boundary));
      const state = streamPatchInput(first, json.slice(boundary));
      expect(state.document.text).toBe(expected);
      expect(lines(state.document)).toEqual(expected.split("\n"));
      expect(state.document.targetFiles).toEqual(["src/name.ts"]);
    }
    let singleCharacters = createStreamingPatchInputState();
    for (let index = 0; index < json.length; index += 1) {
      singleCharacters = streamPatchInput(singleCharacters, json[index]!);
    }
    expect(singleCharacters.document.text).toBe(expected);
  });

  it("publishes the unfinished line without changing earlier snapshots or completed pages", () => {
    const patchText = [
      "*** Begin Patch",
      "*** Add File: src/a.ts",
      ...Array.from({ length: 300 }, (_, index) => `+line ${index}`),
    ].join("\n");
    const first = streamPatchInput(
      createStreamingPatchInputState(),
      JSON.stringify({ patchText }).slice(0, -2),
    );
    const snapshot = JSON.stringify(first);
    for (const page of first.document.pages) Object.freeze(page);
    Object.freeze(first.document.pages);
    Object.freeze(first.document.targetFiles);
    Object.freeze(first.document);
    Object.freeze(first);

    const partial = streamPatchInput(first, " continued");
    expect(getStreamingPatchLine(partial.document, 301)).toBe("+line 299 continued");
    const next = streamPatchInput(partial, '\\n*** Add File: src/b.ts\\n+new\\n*** End Patch"}');

    expect(JSON.stringify(first)).toBe(snapshot);
    expect(lines(first.document)).toEqual(patchText.split("\n"));
    expect(next.document.text).toBe(
      `${patchText} continued\n*** Add File: src/b.ts\n+new\n*** End Patch`,
    );
    expect(next.document.targetFiles).toEqual(["src/a.ts", "src/b.ts"]);
    // Historical rows stay reusable by a virtualized reader during later deltas.
    expect(partial.document.pages).toBe(first.document.pages);
    expect(next.document.pages[0]).toBe(first.document.pages[0]);
  });

  it("recognizes an unambiguous bare patch across prefix chunks without decoding backslashes", () => {
    const patchText =
      "*** Begin Patch\n*** Add File: a.ts\n+const path = 'C:\\new';\n*** End Patch";
    let state = createStreamingPatchInputState();
    for (let offset = 0; offset < patchText.length; offset += 3) {
      state = streamPatchInput(state, patchText.slice(offset, offset + 3));
    }
    expect(state.document.text).toBe(patchText);
    expect(lines(state.document)).toEqual(patchText.split("\n"));
    expect(state.document.targetFiles).toEqual(["a.ts"]);
  });

  it("keeps a final unterminated header and does not invent an empty row for a final newline", () => {
    const state = streamPatchInput(
      createStreamingPatchInputState(),
      '{"patchText":"*** Update File: final.ts"}',
    );
    expect(state.document.targetFiles).toEqual(["final.ts"]);
    expect(lines(state.document)).toEqual(["*** Update File: final.ts"]);
    expect(lines(createStreamingPatchDocument("one\n\ntwo\n"))).toEqual(["one", "", "two"]);
    expect(lines(createStreamingPatchDocument())).toEqual([]);
    expect(getStreamingPatchLine(state.document, -1)).toBeUndefined();
    expect(getStreamingPatchLine(state.document, 1)).toBeUndefined();
  });
});
