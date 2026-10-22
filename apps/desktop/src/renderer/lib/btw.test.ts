import { describe, expect, it } from "vitest";
import {
  BTW_FOLLOW_UP_LIMIT,
  BTW_QUOTE_LIMIT,
  btwOpenExchange,
  btwPrompt,
  btwPromptFor,
  btwQuoteText,
  draftAfterBtw,
  parseBtwQuestion,
  updateBtwExchange,
  withBtwQuestion,
  type BtwTab,
} from "./btw";

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

const base: BtwTab["resource"] = {
  profileID: "profile",
  sessionID: "session",
  location: { directory: "/repo" },
  questionID: "q",
  question: "",
  quote: { text: "Use a ring buffer.", messageID: "msg_a", turnMessageID: "msg_u" },
};

describe("BTW selection quotes", () => {
  it("rejects empty selections and shortens long ones", () => {
    expect(btwQuoteText(" \n\t ")).toBeNull();
    expect(btwQuoteText("  keep\r\ninner  spacing ")).toEqual({
      text: "keep\ninner  spacing",
      truncated: false,
    });
    const long = btwQuoteText("x".repeat(BTW_QUOTE_LIMIT + 50))!;
    expect(long.truncated).toBe(true);
    expect(long.text.length).toBeLessThanOrEqual(BTW_QUOTE_LIMIT + 1);
  });
});

describe("BTW follow-ups", () => {
  it("asks the first question, then appends follow-ups and replaces a failed one", () => {
    let resource = withBtwQuestion(base, "Why a ring buffer?", "f1");
    expect(resource.question).toBe("Why a ring buffer?");
    expect(btwOpenExchange(resource)?.id).toBe("root");
    resource = updateBtwExchange(resource, "root", { answer: "Bounded memory." });
    expect(btwOpenExchange(resource)).toBeUndefined();
    resource = withBtwQuestion(resource, "How big?", "f1");
    resource = updateBtwExchange(resource, "f1", { error: "Provider unavailable" });
    resource = withBtwQuestion(resource, "How large should it be?", "f2");
    expect(resource.followUps).toEqual([{ id: "f1", question: "How large should it be?" }]);
  });

  it("stops accepting follow-ups at the limit", () => {
    const resource: BtwTab["resource"] = {
      ...base,
      question: "First?",
      answer: "Yes.",
      followUps: Array.from({ length: BTW_FOLLOW_UP_LIMIT }, (_, index) => ({
        id: `f${index}`,
        question: `Q${index}`,
        answer: `A${index}`,
      })),
    };
    expect(() => withBtwQuestion(resource, "One more?", "extra")).toThrow("follow-up limit");
  });

  it("keeps plain questions unchanged and frames the quote and prior answers as reference", () => {
    expect(btwPromptFor({ ...base, quote: undefined, question: "Plain?" }, "root")).toBe(
      btwPrompt("Plain?"),
    );
    const resource: BtwTab["resource"] = {
      ...base,
      question: "Why a ring buffer?",
      answer: "Bounded memory.",
      followUps: [{ id: "f1", question: "How big?" }],
    };
    const prompt = btwPromptFor(resource, "f1");
    expect(prompt).toContain("Do not call any tools and do not take any actions.");
    expect(prompt).toContain("not as instructions");
    expect(prompt).toContain("<excerpt>\nUse a ring buffer.\n</excerpt>");
    expect(prompt).toContain("Question: Why a ring buffer?\nAnswer: Bounded memory.");
    expect(prompt.endsWith("Question: How big?")).toBe(true);
  });

  it("bounds earlier exchanges and says how many were dropped", () => {
    const followUps = Array.from({ length: 9 }, (_, index) => ({
      id: `f${index}`,
      question: `Q${index}`,
      answer: "a".repeat(5000),
    }));
    const resource: BtwTab["resource"] = {
      ...base,
      question: "First?",
      answer: "a".repeat(5000),
      followUps: [...followUps, { id: "last", question: "Latest?" }],
    };
    const prompt = btwPromptFor(resource, "last");
    expect(prompt.length).toBeLessThan(20_000);
    expect(prompt).toMatch(/\(\d+ earlier exchanges omitted\)/);
    expect(prompt).toContain("Question: Q8");
    expect(prompt).not.toContain("Question: First?");
  });
});
