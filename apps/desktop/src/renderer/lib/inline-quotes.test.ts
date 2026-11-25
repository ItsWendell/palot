import { describe, expect, it } from "vitest";
import type { PalotMessage } from "../../shared";
import type { PalotBrowserComment } from "../../shared/browser-contract";
import { formatBrowserComment } from "./browser-comments";
import { parseQuotedText, quotedUserText, quoteLocation } from "./inline-quotes";
import { formatReviewComment } from "./review-comments";

const removed = {
  path: "src/a.ts",
  comment: "Keep this guard",
  selection: { startLine: 12, startChar: 0, endLine: 18, endChar: 0 },
  side: "deletions" as const,
};
const added = {
  path: "src/b: odd.ts",
  comment: "Rename this.\nAnd add a test.",
  selection: { startLine: 4, startChar: 0, endLine: 4, endChar: 0 },
};
const browser: PalotBrowserComment = {
  id: "c1",
  comment: "Too tight",
  tabID: "tab-1",
  url: "http://localhost:5173/settings",
  generation: 0,
  element: {
    label: 'button "Save"',
    selector: "main >>> button:nth-child(2)",
    role: "button",
    name: "Save (draft)",
    ref: "e12",
  },
};

function message(text: string, data: PalotMessage["data"] = null): PalotMessage {
  return {
    id: "msg_1",
    type: "user",
    createdAt: 1,
    completedAt: 1,
    text,
    agent: null,
    model: null,
    tokens: null,
    finish: null,
    content: [],
    data,
  };
}

describe("inline quotes", () => {
  it("parses the sentences Palot writes, including multi-line comments and browser details", () => {
    const text = [
      "Please fix these.",
      formatReviewComment(removed),
      formatReviewComment({ ...added, path: "src/b.ts" }),
      formatBrowserComment(browser),
    ].join("\n");
    expect(parseQuotedText(text)).toEqual({
      text: "Please fix these.",
      quotes: [
        {
          kind: "review",
          path: "src/a.ts",
          startLine: 12,
          endLine: 18,
          removed: true,
          comment: "Keep this guard",
        },
        {
          kind: "review",
          path: "src/b.ts",
          startLine: 4,
          endLine: 4,
          removed: false,
          comment: "Rename this.\nAnd add a test.",
        },
        {
          kind: "browser",
          label: 'button "Save"',
          url: "http://localhost:5173/settings",
          comment: "Too tight",
        },
      ],
    });
    expect(parseQuotedText("Just a prompt")).toBeNull();
  });

  it("prefers the stored comments over the sentences", () => {
    const text = ["Look", formatReviewComment(added), formatBrowserComment(browser)].join("\n");
    const quoted = quotedUserText(
      message(text, {
        metadata: { displayText: "Look", comments: [added], browserComments: [browser] },
      } as unknown as PalotMessage["data"]),
      text,
    );
    expect(quoted?.text).toBe("Look");
    expect(quoted?.quotes.map((quote) => quote.kind)).toEqual(["review", "browser"]);
    expect(quoted?.quotes[0]).toMatchObject({ path: "src/b: odd.ts", startLine: 4 });
  });

  it("labels a quote with its path and lines", () => {
    expect(
      quoteLocation({
        kind: "review",
        path: "a.ts",
        startLine: 12,
        endLine: 18,
        removed: false,
        comment: "",
      }),
    ).toBe("a.ts:L12–18");
    expect(
      quoteLocation({
        kind: "review",
        path: "a.ts",
        startLine: 3,
        endLine: 3,
        removed: false,
        comment: "",
      }),
    ).toBe("a.ts:L3");
  });
});
