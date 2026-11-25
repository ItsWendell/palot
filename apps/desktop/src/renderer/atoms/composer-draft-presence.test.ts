import { createStore } from "jotai";
import { afterEach, expect, it } from "vitest";
import { emptyComposerDraft } from "../lib/composer-draft";
import { composerScope } from "../lib/composer-scope";
import { composerDraftPresenceAtom } from "./composer-draft-presence";
import { composerStateAtomFamily } from "./composer-state";
import {
  flushScheduledPersistedValues,
  persistedStorageKey,
  saveScopedPersistedValue,
} from "./persisted";
import { composerDraftAtomFamily } from "./ui";

afterEach(() => {
  flushScheduledPersistedValues();
  localStorage.clear();
});

it("reads drafts and attachments an earlier run left in storage", () => {
  const typed = composerScope("profile", "session:typed");
  const attached = composerScope("profile", "session:attached");
  const blank = composerScope("profile", "session:blank");
  saveScopedPersistedValue("composer.draft", typed, { ...emptyComposerDraft(), text: "Hi" }, 100);
  saveScopedPersistedValue("composer.draft", blank, { ...emptyComposerDraft(), text: "  " }, 100);
  saveScopedPersistedValue(
    "composer.contents",
    attached,
    { files: [{ uri: "file:///a.png", name: "a.png", mime: "image/png", size: 1 }], edit: null },
    100,
  );
  const presence = createStore().get(composerDraftPresenceAtom);
  expect([...presence.keys()].toSorted()).toEqual([attached, typed].toSorted());
});

it("changes only when a scope's draft empties or fills", () => {
  const store = createStore();
  const scope = composerScope("profile", "session:one");
  const draftAtom = composerDraftAtomFamily(scope);
  const stateAtom = composerStateAtomFamily(scope);
  const type = (text: string) => store.set(draftAtom, { ...emptyComposerDraft(), text });
  const initial = store.get(composerDraftPresenceAtom);
  expect(initial.has(scope)).toBe(false);

  type("a");
  const filled = store.get(composerDraftPresenceAtom);
  expect(filled.has(scope)).toBe(true);
  type("ab");
  type("abc");
  expect(store.get(composerDraftPresenceAtom)).toBe(filled);

  store.set(stateAtom, (state) => ({
    ...state,
    comments: [
      {
        id: "c1",
        path: "src/a.ts",
        side: "additions",
        startLine: 1,
        endLine: 1,
        body: "Why?",
        createdAt: 1,
      } as never,
    ],
  }));
  type("");
  // The comment still waits to be sent.
  expect(store.get(composerDraftPresenceAtom).has(scope)).toBe(true);
  store.set(stateAtom, (state) => ({ ...state, comments: [] }));
  expect(store.get(composerDraftPresenceAtom).has(scope)).toBe(false);
});

it("follows another window's drafts through storage events", () => {
  const store = createStore();
  const scope = composerScope("profile", "session:elsewhere");
  const unsubscribe = store.sub(composerDraftPresenceAtom, () => {});
  const key = persistedStorageKey(`composer.draft:${encodeURIComponent(scope)}`);
  const send = (value: unknown) =>
    window.dispatchEvent(
      new StorageEvent("storage", {
        key,
        newValue: value === null ? null : JSON.stringify({ version: 1, value }),
        storageArea: localStorage,
      }),
    );
  send({ ...emptyComposerDraft(), text: "From the other window" });
  expect(store.get(composerDraftPresenceAtom).has(scope)).toBe(true);
  send(null);
  expect(store.get(composerDraftPresenceAtom).has(scope)).toBe(false);
  unsubscribe();
});
