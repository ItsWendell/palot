import { describe, expect, it } from "vitest";
import { isComposerDraft } from "./ui";

const mention = (kind: string) => ({
  localID: `m-${kind}`,
  kind,
  value: kind,
  text: `@${kind}`,
  start: 0,
  end: kind.length + 1,
});

describe("saved composer drafts", () => {
  it.each(["file", "skill", "task", "agent", "reference"])(
    "keeps a draft with a %s mention after a reload",
    (kind) => {
      expect(isComposerDraft({ text: `@${kind}`, mentions: [mention(kind)], command: null })).toBe(
        true,
      );
    },
  );

  it("rejects unknown mention kinds", () => {
    expect(isComposerDraft({ text: "@x", mentions: [mention("other")], command: null })).toBe(
      false,
    );
  });
});
