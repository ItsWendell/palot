import { LiveTokenizer, type Theme } from "@pierre/highlights";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { loadCodeHighlighter, loadedZedTheme } from "./code-highlighter";
import { StreamingCodeTokens, type StyledToken } from "./streaming-code-tokens";

const THEME = "pierre-dark-soft";
let zed: Theme;

beforeAll(async () => {
  await loadCodeHighlighter(THEME);
  zed = loadedZedTheme(THEME)!;
});

/** The tokens a fresh tokenizer produces for the whole block in one pass. */
function whole(code: string): StyledToken[] | null {
  const stream = new StreamingCodeTokens("ts", THEME, zed);
  try {
    return stream.update(code);
  } finally {
    stream.dispose();
  }
}

const code = `/* A block comment
   spanning lines */
export function add(a: number, b: number) {
  const message = \`sum: \${a + b}\`;
  return message.length > 3 ? message : "short";
}
`;

describe("StreamingCodeTokens", () => {
  it.each([1, 3, 7, 32])(
    "matches whole-block highlighting when streamed in %i-char chunks",
    (size) => {
      const stream = new StreamingCodeTokens("ts", THEME, zed);
      let last: StyledToken[] | null = null;
      for (let end = size; end < code.length + size; end += size) {
        const prefix = code.slice(0, Math.min(end, code.length));
        last = stream.update(prefix);
        // Every intermediate render must be exactly what a full pass would show.
        expect(last).toEqual(whole(prefix));
      }
      expect(last?.map((token) => token.value).join("")).toBe(code);
      expect(last?.some((token) => token.color)).toBe(true);
      stream.dispose();
    },
  );

  it("carries lexer state from earlier chunks into later lines", () => {
    const stream = new StreamingCodeTokens("ts", THEME, zed);
    stream.update("/* still a\n");
    const tokens = stream.update("/* still a\ncomment */ const x = 1;")!;
    const comment = tokens.find((token) => token.value.startsWith("comment"));
    const keyword = tokens.find((token) => token.value.trim() === "const");
    expect(comment?.color).toBe(tokens[0]!.color);
    expect(keyword?.color).not.toBe(comment?.color);
    stream.dispose();
  });

  it("re-reads only from the previous last line on append", () => {
    const stream = new StreamingCodeTokens("ts", THEME, zed);
    stream.update("const a = 1;\nconst b = 2;\nconst c");
    const read = vi.spyOn(LiveTokenizer.prototype, "getLineTokens");
    const next = "const a = 1;\nconst b = 2;\nconst c = 3;\nconst d";
    const tokens = stream.update(next);
    // Lines 0 and 1 were final; line 2 grew and line 3 is new.
    expect(read.mock.calls.map(([line]) => line)).toEqual([2, 3]);
    read.mockRestore();
    expect(tokens).toEqual(whole(next));
    stream.dispose();
  });

  it("resets when the block is edited or shortened instead of appended", () => {
    const stream = new StreamingCodeTokens("ts", THEME, zed);
    stream.update("const value = 1;\nconst other = 2;");
    expect(stream.update("let value = 1;")).toEqual(whole("let value = 1;"));
    expect(stream.update("let")).toEqual(whole("let"));
    expect(stream.update("")).toEqual([]);
    stream.dispose();
  });

  it("refuses token runs that would lose carriage returns", () => {
    const stream = new StreamingCodeTokens("ts", THEME, zed);
    expect(stream.update("const a = 1;\r\nconst b = 2;")).toBeNull();
    stream.dispose();
  });
});
