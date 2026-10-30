import { afterEach, expect, it, vi } from "vitest";
import { emptyComposerDraft, insertComposerFileMention } from "./composer-draft";
import { loadPromptStash, restorePromptStash, stashPrompt } from "./prompt-stash";
afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});
it("persists text, resolved mentions, and attachments newest first without crossing projects", () => {
  stashPrompt("project-a", { ...emptyComposerDraft(), text: "Older" }, []);
  const draft = insertComposerFileMention(
    { ...emptyComposerDraft(), text: "Review " },
    7,
    "src/a.ts",
    "mention",
  ).draft;
  const files = [
    { uri: "data:text/plain;base64,YQ==", name: "a.txt", mime: "text/plain", size: 1 },
  ];
  const entry = stashPrompt("project-a", draft, files);
  expect(loadPromptStash("project-a").map((item) => item.draft.text)).toEqual([
    draft.text,
    "Older",
  ]);
  expect(loadPromptStash("project-b")).toEqual([]);
  expect(restorePromptStash("project-a", entry.id, emptyComposerDraft(), [])).toMatchObject({
    draft,
    files,
  });
  expect(loadPromptStash("project-a")).toHaveLength(1);
});
it("swaps the current draft safely even with a full stash", () => {
  for (let index = 0; index < 25; index++)
    stashPrompt("project", { ...emptyComposerDraft(), text: `Prompt ${index}` }, []);
  const newest = loadPromptStash("project")[0]!;
  expect(
    restorePromptStash("project", newest.id, { ...emptyComposerDraft(), text: "Unsaved work" }, [])
      .draft.text,
  ).toBe("Prompt 24");
  expect(loadPromptStash("project")).toHaveLength(25);
  expect(loadPromptStash("project")[0]?.draft.text).toBe("Unsaved work");
});
it("reports storage failure before the caller can clear its draft", () => {
  vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
    throw new Error("Quota");
  });
  expect(() => stashPrompt("project", { ...emptyComposerDraft(), text: "Keep me" }, [])).toThrow(
    "not cleared",
  );
});
