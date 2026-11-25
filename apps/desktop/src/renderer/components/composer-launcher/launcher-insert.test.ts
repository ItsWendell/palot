import { describe, expect, it } from "vitest";
import { insertComposerFileMention, type ComposerDraft } from "../../lib/composer-draft";
import {
  insertCommandAtStart,
  insertMentionAt,
  launcherTrigger,
  triggerQuery,
} from "./launcher-insert";

const draft = (text: string): ComposerDraft => ({ text, mentions: [], command: null });

describe("launcherTrigger", () => {
  it("maps the detected query to its trigger with the caret as its end", () => {
    expect(launcherTrigger({ kind: "file", start: 4, end: 8, query: "sr" }, [])).toEqual({
      char: "@",
      from: 4,
      to: 7,
      query: "sr",
    });
    expect(launcherTrigger({ kind: "skill", start: 0, end: 1, query: "" }, [])?.char).toBe("$");
  });

  it("treats a slash path no command folder holds as text", () => {
    const commands = [{ name: "git/commit" }];
    const command = (query: string) => ({ kind: "command" as const, start: 0, end: 1, query });
    expect(launcherTrigger(command("git/co"), commands)?.char).toBe("/");
    expect(launcherTrigger(command("home/me"), commands)).toBeNull();
    expect(launcherTrigger(command("/"), commands)).toBeNull();
  });
});

describe("triggerQuery", () => {
  it("prefers the token detected now, and falls back to the range the trigger opened with", () => {
    const fresh = { kind: "file" as const, start: 2, end: 9, query: "src" };
    expect(triggerQuery({ char: "@", from: 2, to: 6 }, fresh)).toBe(fresh);
    expect(triggerQuery({ char: "@", from: 2, to: 6 }, null)).toEqual({
      kind: "file",
      start: 2,
      end: 6,
      query: "",
    });
  });
});

describe("insertMentionAt", () => {
  it("inserts at the caret with a space before a word and none doubled after", () => {
    const inserted = insertMentionAt(draft("Hello world"), 5, {
      kind: "agent",
      name: "explore",
      localID: "a",
    });
    expect(inserted.draft.text).toBe("Hello @explore world");
    expect(inserted.selectionStart).toBe("Hello @explore".length);
    expect(inserted.draft.mentions).toMatchObject([
      { kind: "agent", value: "explore", start: 6, end: 14 },
    ]);
  });

  it("never lands inside a chip", () => {
    const withFile = insertComposerFileMention(draft("See "), 4, "a.ts", "f").draft;
    const inserted = insertMentionAt(withFile, 6, { kind: "skill", id: "review", localID: "s" });
    expect(inserted.draft.text).toBe("See @a.ts $review ");
    expect(inserted.draft.mentions.map((mention) => mention.text)).toEqual(["@a.ts", "$review"]);
  });
});

describe("insertCommandAtStart", () => {
  it("puts the command first, the draft becoming its arguments", () => {
    const inserted = insertCommandAtStart(draft("fix the login"), "review");
    expect(inserted.draft.text).toBe("/review fix the login");
    expect(inserted.draft.command).toEqual({ name: "review", start: 0, end: 7 });
    expect(inserted.selectionStart).toBe(8);
    expect(insertCommandAtStart(draft(""), "goal").draft.text).toBe("/goal ");
  });

  it("replaces a command already there", () => {
    const first = insertCommandAtStart(draft("args"), "review").draft;
    expect(insertCommandAtStart(first, "goal").draft).toMatchObject({
      text: "/goal args",
      command: { name: "goal", start: 0, end: 5 },
    });
  });
});
