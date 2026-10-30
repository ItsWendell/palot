import { describe, expect, it } from "vitest";
import { parseDelimitedPreview } from "./delimited-preview-model";

describe("delimited file parsing", () => {
  it("preserves escaped quotes, delimiters, embedded newlines, blank fields and CRLF", () => {
    expect(
      parseDelimitedPreview(
        '\uFEFFname,value,notes\r\n"Doe, Jane",42,"line 1\r\nline ""2"""\r\n,,\r\n',
        ",",
      ),
    ).toEqual({
      rows: [
        ["name", "value", "notes"],
        ["Doe, Jane", "42", 'line 1\r\nline "2"'],
        ["", "", ""],
      ],
      truncated: false,
    });
    expect(parseDelimitedPreview('a\tb\n"x\ty"\tz', "\t")?.rows).toEqual([
      ["a", "b"],
      ["x\ty", "z"],
    ]);
    expect(parseDelimitedPreview("a,b,", ",")?.rows).toEqual([["a", "b", ""]]);
  });

  it.each(['"open', 'a,b"c', '"closed"garbage', '"a""'])(
    "rejects malformed quoting: %s",
    (source) => {
      expect(parseDelimitedPreview(source, ",")).toBeNull();
    },
  );

  it("caps rows and columns with an explicit truncation signal", () => {
    const source = `header\n${"row\n".repeat(50_002)}`;
    const result = parseDelimitedPreview(source, ",");
    expect(result?.rows).toHaveLength(50_001);
    expect(result?.truncated).toBe(true);
    const wide = parseDelimitedPreview(
      Array.from({ length: 101 }, (_, i) => String(i)).join(","),
      ",",
    );
    expect(wide?.rows[0]).toHaveLength(100);
    expect(wide?.truncated).toBe(true);
    expect(parseDelimitedPreview("", ",")).toEqual({ rows: [], truncated: false });
  });
});
