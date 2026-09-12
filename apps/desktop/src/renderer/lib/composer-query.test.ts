import { describe, expect, it } from "vitest";
import { detectComposerQuery } from "./composer-query";

describe("detectComposerQuery", () => {
  it.each([
    ["/", 1, { kind: "command", start: 0, end: 1, query: "" }],
    ["  /review", 9, { kind: "command", start: 2, end: 9, query: "review" }],
    ["Use $code-review", 16, { kind: "skill", start: 4, end: 16, query: "code-review" }],
    ["Open (@src/auth.ts", 18, { kind: "file", start: 6, end: 18, query: "src/auth.ts" }],
  ] as const)("detects %s", (text, caret, expected) => {
    expect(detectComposerQuery(text, caret)).toEqual(expected);
  });

  it("uses the caret and replaces the complete token around it", () => {
    expect(detectComposerQuery("See @src/auth.ts later", 8)).toEqual({
      kind: "file",
      start: 4,
      end: 16,
      query: "src",
    });
  });

  it.each([
    ["text /review", 12],
    ["first\n/review", 13],
    ["/review auth", 12],
    ["user@example.com", 16],
    ["total $100", 10],
    ["identifier$skill", 16],
    ["file@src/app.ts", 15],
    ["Use @src/app.ts,", 16],
  ])("does not detect an invalid query in %s", (text, caret) => {
    expect(detectComposerQuery(text, caret)).toBeNull();
  });

  it("closes for a selection or composition", () => {
    expect(detectComposerQuery("@src", 1, 4)).toBeNull();
    expect(detectComposerQuery("@src", 4, 4, { isComposing: true })).toBeNull();
  });
});
