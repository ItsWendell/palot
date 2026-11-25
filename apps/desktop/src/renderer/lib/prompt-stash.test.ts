import { afterEach, expect, it, vi } from "vitest";
import { emptyComposerDraft, insertComposerFileMention } from "./composer-draft";
import {
  deletePromptStash,
  loadPromptStash,
  restoredStashFiles,
  restorePromptStash,
  retainedComposerAttachmentURIs,
  savePromptStash,
  stashPrompt,
  withStashedURIs,
} from "./prompt-stash";
import { persistedStorageKey } from "../atoms/persisted";
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
it("deletes one entry and leaves the others", () => {
  const older = stashPrompt("project", { ...emptyComposerDraft(), text: "Keep" }, []);
  const newer = stashPrompt("project", { ...emptyComposerDraft(), text: "Drop" }, []);
  expect(deletePromptStash("project", newer.id)?.draft.text).toBe("Drop");
  expect(deletePromptStash("project", "missing")).toBeNull();
  expect(loadPromptStash("project").map((entry) => entry.id)).toEqual([older.id]);
});
it("reports storage failure before the caller can clear its draft", () => {
  const setItem = vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
    throw new Error("Quota");
  });
  // restoreAllMocks does not undo a spy on the Storage instance; restore it here so later
  // tests can write.
  try {
    expect(() => stashPrompt("project", { ...emptyComposerDraft(), text: "Keep me" }, [])).toThrow(
      "not cleared",
    );
  } finally {
    setItem.mockRestore();
  }
});

const pasted = {
  uri: "file:///data/composer-attachments/staged/screenshot-a.png",
  name: "screenshot-a.png",
  mime: "image/png",
  size: 3,
  previewGrant: "old-grant",
};
const picked = { uri: "file:///home/me/notes.md", name: "notes.md", mime: "text/plain", size: 9 };
it("swaps in durable copies of pasted files and drops their stale preview grants", () => {
  const stashed = "file:///data/composer-attachments/stash/screenshot-b.png";
  expect(withStashedURIs([pasted, picked], [stashed, picked.uri])).toEqual([
    { uri: stashed, name: "screenshot-a.png", mime: "image/png", size: 3 },
    picked,
  ]);
});
it("restores what main staged again and names the files that are gone", () => {
  const gone = { ...pasted, uri: "file:///gone.png", name: "gone.png" };
  expect(
    restoredStashFiles(
      [pasted, gone, picked],
      [
        { status: "restored", uri: "file:///staged/new.png", previewGrant: "new-grant" },
        { status: "missing" },
        { status: "kept" },
      ],
    ),
  ).toEqual({
    files: [{ ...pasted, uri: "file:///staged/new.png", previewGrant: "new-grant" }, picked],
    missing: ["gone.png"],
  });
});
it("collects the local files saved drafts and stashed prompts reference", () => {
  stashPrompt("project", { ...emptyComposerDraft(), text: "Stashed" }, [pasted]);
  savePromptStash("other", []);
  localStorage.setItem(
    persistedStorageKey(`composer.contents:${encodeURIComponent("draft")}`),
    JSON.stringify({
      version: 1,
      value: { files: [picked, { ...picked, uri: "data:text/plain;base64,YQ==" }], edit: null },
    }),
  );
  localStorage.setItem(persistedStorageKey("composer.contents:broken"), "{");
  localStorage.setItem(
    persistedStorageKey("unrelated"),
    JSON.stringify({ uri: "file:///not-a-draft" }),
  );
  expect(retainedComposerAttachmentURIs(localStorage, persistedStorageKey("")).toSorted()).toEqual(
    [picked.uri, pasted.uri].toSorted(),
  );
});
