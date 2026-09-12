import { createStore } from "jotai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { emptyComposerDraft } from "../lib/composer-draft";
import { composerScope } from "../lib/composer-scope";

beforeEach(() => {
  window.localStorage.clear();
  vi.resetModules();
});

describe("composer contents persistence", () => {
  it.each(["session:duplicate", "new:project:/repo:workspace"])(
    "persists independent profile contents for %s",
    async (localScope) => {
      const { composerStateAtomFamily } = await import("./composer-state");
      const { composerDraftAtomFamily } = await import("./ui");
      const store = createStore();
      const expected = ["profile-a", "profile-b"].map((profileID) => {
        const scope = composerScope(profileID, localScope);
        const draft = { ...emptyComposerDraft(), text: `${profileID} draft` };
        const files = [
          {
            uri: `file:///${profileID}.txt`,
            name: `${profileID}.txt`,
            mime: "text/plain",
            size: 1,
          },
        ];
        const edit = {
          id: "same-pending-input",
          delivery: "queue" as const,
          draft: { ...emptyComposerDraft(), text: `${profileID} edit` },
          files,
        };
        store.set(composerDraftAtomFamily(scope), draft);
        store.set(composerStateAtomFamily(scope), () => ({
          files,
          edit,
          sending: true,
          cancelingID: "same-pending-input",
        }));
        return { scope, draft, files, edit };
      });
      window.dispatchEvent(new Event("pagehide"));
      vi.resetModules();
      const reloaded = await import("./composer-state");
      const reloadedUI = await import("./ui");
      const nextStore = createStore();
      for (const { scope, draft, files, edit } of expected) {
        expect(nextStore.get(reloadedUI.composerDraftAtomFamily(scope))).toEqual(draft);
        expect(nextStore.get(reloaded.composerStateAtomFamily(scope))).toEqual({
          files,
          edit,
          sending: false,
          cancelingID: null,
        });
      }
    },
  );

  it("coalesces pending-edit typing, flushes on unmount, and does not resurrect cleared contents", async () => {
    const { composerStateAtomFamily } = await import("./composer-state");
    const { persistedStorageKey, flushScheduledPersistedValues } = await import("./persisted");
    const store = createStore();
    const state = composerStateAtomFamily("session:pending-edit");
    const unsubscribe = store.sub(state, () => {});
    const key = persistedStorageKey("composer.contents:session%3Apending-edit");
    for (let index = 0; index < 100; index++) {
      store.set(state, (current) => ({
        ...current,
        edit: {
          id: "pending",
          delivery: "queue",
          draft: { ...emptyComposerDraft(), text: `edit ${index}` },
          files: [],
        },
      }));
    }
    expect(window.localStorage.getItem(key)).toBeNull();
    unsubscribe();
    expect(JSON.parse(window.localStorage.getItem(key)!).value.edit.draft.text).toBe("edit 99");
    store.set(state, (current) => ({
      ...current,
      edit: { ...current.edit!, draft: { ...emptyComposerDraft(), text: "submitted" } },
    }));
    store.set(state, (current) => ({ ...current, edit: null }));
    flushScheduledPersistedValues();
    expect(window.localStorage.getItem(key)).toBeNull();
  });

  it("reloads the original and edited draft attachments without replaying request flags", async () => {
    const { composerStateAtomFamily } = await import("./composer-state");
    const { composerDraftAtomFamily } = await import("./ui");
    const store = createStore();
    const scope = "session:persisted-edit";
    const original = { ...emptyComposerDraft(), text: "Original draft" };
    const file = {
      uri: "file:///original.txt",
      name: "original.txt",
      mime: "text/plain",
      size: 10,
    };
    const edit = {
      id: "canceled-message",
      delivery: "queue" as const,
      draft: {
        text: "Read @file.ts",
        mentions: [
          {
            localID: "file",
            kind: "file" as const,
            value: "file.ts",
            text: "@file.ts",
            start: 5,
            end: 13,
          },
        ],
        command: null,
      },
      files: [{ ...file, uri: "file:///edited.txt", name: "edited.txt" }],
    };
    store.set(composerDraftAtomFamily(scope), original);
    store.set(composerStateAtomFamily(scope), () => ({
      files: [file],
      edit,
      sending: true,
      cancelingID: "canceling",
    }));

    window.dispatchEvent(new Event("pagehide"));
    vi.resetModules();
    const reloaded = await import("./composer-state");
    const reloadedUI = await import("./ui");
    const nextStore = createStore();
    const nextState = reloaded.composerStateAtomFamily(scope);
    expect(nextStore.get(reloadedUI.composerDraftAtomFamily(scope))).toEqual(original);
    expect(nextStore.get(nextState)).toEqual({
      files: [file],
      edit,
      sending: false,
      cancelingID: null,
    });

    nextStore.set(nextState, (current) => ({ ...current, edit: null }));
    window.dispatchEvent(new Event("pagehide"));
    vi.resetModules();
    const afterDiscard = await import("./composer-state");
    expect(createStore().get(afterDiscard.composerStateAtomFamily(scope))).toEqual({
      files: [file],
      edit: null,
      sending: false,
      cancelingID: null,
    });
  });
});
