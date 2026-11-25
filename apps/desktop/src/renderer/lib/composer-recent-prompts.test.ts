import { beforeEach, describe, expect, it } from "vitest";
import type { PalotFileAttachment } from "../../shared";
import {
  MAX_RECENT_PROMPT_CHARS,
  MAX_RECENT_PROMPT_EMBEDDED,
  MAX_RECENT_PROMPTS,
  MAX_RECENT_PROMPTS_WITH_FILES,
  loadRecentPrompts,
  portableComposerFiles,
  recentPromptFromSubmission,
  recentPromptHistory,
  recentPromptScope,
  rememberRecentPrompt,
  saveRecentPrompt,
  type RecentPrompt,
} from "./composer-recent-prompts";
import { persistedStorageKey } from "../atoms/persisted";

const embedded = (name: string, bytes = "aGk="): PalotFileAttachment => ({
  uri: `data:text/plain;base64,${bytes}`,
  name,
  mime: "text/plain",
  size: 2,
  previewGrant: "grant-123",
});

function prompt(text: string, overrides: Partial<RecentPrompt> = {}): RecentPrompt {
  return {
    text,
    mentions: [],
    comments: [],
    files: [],
    omittedFiles: [],
    createdAt: 1,
    ...overrides,
  };
}

beforeEach(() => window.localStorage.clear());

describe("recent prompt scope", () => {
  it("needs both a connection profile and a project", () => {
    expect(recentPromptScope("profile", "project")).not.toBeNull();
    expect(recentPromptScope(null, "project")).toBeNull();
    expect(recentPromptScope("profile", "")).toBeNull();
  });

  it("keeps projects and connection profiles apart", () => {
    const here = recentPromptScope("profile-a", "project-1");
    saveRecentPrompt(here, prompt("Ship it"));
    expect(loadRecentPrompts(here).map((item) => item.text)).toEqual(["Ship it"]);
    expect(loadRecentPrompts(recentPromptScope("profile-a", "project-2"))).toEqual([]);
    expect(loadRecentPrompts(recentPromptScope("profile-b", "project-1"))).toEqual([]);
  });
});

describe("recent prompt contents", () => {
  it("stores text, mentions and comments but only embedded attachments, without grants", () => {
    const entry = recentPromptFromSubmission({
      draft: {
        text: "Read @src/a.ts",
        mentions: [
          {
            localID: "m1",
            kind: "file",
            value: "src/a.ts",
            text: "@src/a.ts",
            start: 5,
            end: 14,
          },
        ],
        command: null,
      },
      files: [
        embedded("note.txt"),
        { uri: "palot-attachment://grant/1", name: "local.pdf", mime: "application/pdf", size: 9 },
        { uri: "https://example.com/x.png", name: "remote.png", mime: "image/png", size: 9 },
      ],
      comments: [
        {
          id: "c1",
          path: "src/a.ts",
          comment: "Check",
          selection: { startLine: 1, startChar: 0, endLine: 1, endChar: 0 },
        },
      ],
      createdAt: 5,
    })!;
    expect(entry.mentions).toHaveLength(1);
    expect(entry.comments).toHaveLength(1);
    expect(entry.files).toEqual([
      { uri: "data:text/plain;base64,aGk=", name: "note.txt", mime: "text/plain", size: 2 },
    ]);
    expect(entry.omittedFiles).toEqual(["local.pdf", "remote.png"]);
  });

  it("skips empty and oversized prompts", () => {
    const draft = (text: string) => ({ text, mentions: [], command: null });
    const input = { files: [], comments: [], createdAt: 1 };
    expect(recentPromptFromSubmission({ ...input, draft: draft("   ") })).toBeNull();
    expect(recentPromptFromSubmission({ ...input, draft: draft("x".repeat(5_000)) })).toBeNull();
  });

  it("keeps the newest prompts once each and drops bytes from older entries first", () => {
    let entries: RecentPrompt[] = [];
    for (let index = 0; index < MAX_RECENT_PROMPTS + 5; index += 1) {
      entries = rememberRecentPrompt(entries, prompt(`p${index}`));
    }
    entries = rememberRecentPrompt(entries, prompt("p3"));
    expect(entries).toHaveLength(MAX_RECENT_PROMPTS);
    expect(entries[0]?.text).toBe("p3");
    expect(entries.filter((item) => item.text === "p3")).toHaveLength(1);

    const big = "A".repeat(Math.floor(MAX_RECENT_PROMPT_EMBEDDED * 0.6));
    const withOld = rememberRecentPrompt([], prompt("old", { files: [embedded("old.txt", big)] }));
    const withNew = rememberRecentPrompt(
      withOld,
      prompt("new", { files: [embedded("new.txt", big)] }),
    );
    expect(withNew[0]?.files.map((file) => file.name)).toEqual(["new.txt"]);
    expect(withNew[1]?.files).toEqual([]);
    expect(withNew[1]?.omittedFiles).toEqual(["old.txt"]);
  });

  it("keeps 200 prompts, with attachments only on the newest 100", () => {
    let entries: RecentPrompt[] = [];
    for (let index = 0; index < 210; index += 1) {
      entries = rememberRecentPrompt(
        entries,
        prompt(`p${index}`, { files: [embedded(`f${index}.txt`)] }),
      );
    }
    expect(MAX_RECENT_PROMPTS).toBe(200);
    expect(entries).toHaveLength(200);
    expect(entries[0]?.text).toBe("p209");
    expect(entries[199]?.text).toBe("p10");
    const newest = entries[MAX_RECENT_PROMPTS_WITH_FILES - 1]!;
    expect(newest.files.map((file) => file.name)).toEqual([
      `f${210 - MAX_RECENT_PROMPTS_WITH_FILES}.txt`,
    ]);
    const older = entries[MAX_RECENT_PROMPTS_WITH_FILES]!;
    expect(older.text).toBe(`p${209 - MAX_RECENT_PROMPTS_WITH_FILES}`);
    expect(older.files).toEqual([]);
    expect(older.omittedFiles).toEqual([`f${209 - MAX_RECENT_PROMPTS_WITH_FILES}.txt`]);
    // Recall names what the text-only entry no longer carries.
    expect(recentPromptHistory([older])[0]?.omittedFiles).toEqual([older.omittedFiles[0]]);
  });

  it("drops the oldest prompts once a scope's stored text passes its budget", () => {
    let entries: RecentPrompt[] = [];
    for (let index = 0; index < 100; index += 1) {
      entries = rememberRecentPrompt(entries, prompt(`${index} ${"x".repeat(3_990)}`));
    }
    expect(entries.length).toBeGreaterThan(20);
    expect(entries.length).toBeLessThan(40);
    expect(entries[0]?.text.startsWith("99 ")).toBe(true);
    expect(JSON.stringify(entries).length).toBeLessThanOrEqual(MAX_RECENT_PROMPT_CHARS);
  });

  it("still loads history saved with the old 25-prompt limit and adds to it", () => {
    const scope = recentPromptScope("profile", "project")!;
    const key = persistedStorageKey(`composer.recent-prompts:${encodeURIComponent(scope)}`);
    const saved = Array.from({ length: 25 }, (_, index) =>
      prompt(`old ${index}`, { files: [embedded(`o${index}.txt`)], createdAt: index }),
    );
    window.localStorage.setItem(key, JSON.stringify({ version: 1, value: saved }));
    expect(loadRecentPrompts(scope)).toHaveLength(25);
    saveRecentPrompt(scope, prompt("new"));
    const loaded = loadRecentPrompts(scope);
    expect(loaded.map((item) => item.text)).toEqual(["new", ...saved.map((item) => item.text)]);
    expect(loaded[25]?.files.map((file) => file.name)).toEqual(["o24.txt"]);
  });

  it("revalidates stored entries before they can be recalled", () => {
    const scope = recentPromptScope("profile", "project")!;
    saveRecentPrompt(scope, prompt("Hello @x", { createdAt: 9 }));
    const key = persistedStorageKey(`composer.recent-prompts:${encodeURIComponent(scope)}`);
    const stored = JSON.parse(window.localStorage.getItem(key)!) as { value: RecentPrompt[] };
    // Tampered storage: a grant-backed file and a mention that no longer matches the text.
    stored.value[0]!.files = [
      { uri: "file:///etc/passwd", name: "passwd", mime: "text/plain", size: 1 },
    ];
    stored.value[0]!.mentions = [
      { localID: "m", kind: "file", value: "y", text: "@y", start: 6, end: 8 },
    ];
    window.localStorage.setItem(key, JSON.stringify(stored));

    const [recalled] = recentPromptHistory(loadRecentPrompts(scope));
    expect(recalled?.draft.text).toBe("Hello @x");
    expect(recalled?.draft.mentions).toEqual([]);
    expect(recalled?.files).toEqual([]);
    expect(recalled?.omittedFiles).toEqual(["passwd"]);
    expect(recalled?.createdAt).toBe(9);
  });

  it("ignores malformed storage", () => {
    const scope = recentPromptScope("profile", "project")!;
    const key = persistedStorageKey(`composer.recent-prompts:${encodeURIComponent(scope)}`);
    window.localStorage.setItem(key, JSON.stringify({ version: 1, value: [{ text: 4 }] }));
    expect(loadRecentPrompts(scope)).toEqual([]);
  });

  it("filters portable files within a budget", () => {
    const result = portableComposerFiles([embedded("a"), embedded("b")], 30);
    expect(result.files.map((file) => file.name)).toEqual(["a"]);
    expect(result.omitted).toEqual(["b"]);
  });
});
