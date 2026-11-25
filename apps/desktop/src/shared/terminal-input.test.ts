import { describe, expect, it } from "vitest";
import { TERMINAL_WRITE_MAX_LENGTH, chunkTerminalWrite } from "./terminal-input";

describe("chunkTerminalWrite", () => {
  it("keeps short input whole and drops nothing from long input", () => {
    expect(chunkTerminalWrite("ls\r")).toEqual(["ls\r"]);
    expect(chunkTerminalWrite("")).toEqual([]);
    const long = "x".repeat(TERMINAL_WRITE_MAX_LENGTH * 2 + 5);
    const chunks = chunkTerminalWrite(long);
    expect(chunks.map((chunk) => chunk.length)).toEqual([
      TERMINAL_WRITE_MAX_LENGTH,
      TERMINAL_WRITE_MAX_LENGTH,
      5,
    ]);
    expect(chunks.join("")).toBe(long);
  });

  it("never splits a surrogate pair", () => {
    const data = `a${"😀".repeat(4)}`;
    const chunks = chunkTerminalWrite(data, 2);
    expect(chunks.join("")).toBe(data);
    for (const chunk of chunks) expect(chunk).not.toMatch(/[\uD800-\uDBFF]$|^[\uDC00-\uDFFF]/);
  });

  it("stays under 64 KB of UTF-8 per piece", () => {
    const encoder = new TextEncoder();
    for (const chunk of chunkTerminalWrite("€".repeat(100_000)))
      expect(encoder.encode(chunk).byteLength).toBeLessThanOrEqual(64 * 1024);
  });
});
