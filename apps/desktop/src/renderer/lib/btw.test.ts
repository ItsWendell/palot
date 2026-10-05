import { describe, expect, it } from "vitest";
import { draftAfterBtw, parseBtwQuestion } from "./btw";

describe("BTW composer input", () => {
  it("recognizes typed commands, including empty and multiline questions, but not lookalikes", () => {
    expect(parseBtwQuestion("/btw")).toBe("");
    expect(parseBtwQuestion(" /BTW  why?\nAnd when? ")).toBe("why?\nAnd when?");
    expect(parseBtwQuestion("/btwice explain")).toBeNull();
    expect(parseBtwQuestion("Explain /btw")).toBeNull();
  });
  it("retains file and skill mentions for the next ordinary turn", () => {
    const draft = draftAfterBtw({
      text: "/btw explain @src/a.ts $skill",
      command: null,
      mentions: [
        { localID: "file", kind: "file", value: "src/a.ts", text: "@src/a.ts", start: 13, end: 22 },
        {
          localID: "skill",
          kind: "skill",
          value: "skill",
          text: "$skill",
          start: 23,
          end: 29,
          attachmentText: "Context",
        },
      ],
    });
    expect(draft.text).toBe("@src/a.ts $skill");
    expect(draft.mentions.map(({ start, end }) => draft.text.slice(start, end))).toEqual([
      "@src/a.ts",
      "$skill",
    ]);
    expect(draft.mentions[1]?.attachmentText).toBe("Context");
  });
});
