import { createStore } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { persistedStorageKey } from "./persisted";
import {
  activityGroupOpenAtomFamily,
  composerDraftAtomFamily,
  flushComposerDrafts,
  defaultWorktreeBaseAtom,
  defaultWorkspaceModeAtom,
  sessionProjectionPreferenceAtom,
  turnActivityOpenAtomFamily,
} from "./ui";

describe("workspace preference", () => {
  beforeEach(() => window.localStorage.clear());

  it("persists changes between current checkout and new worktree", () => {
    const store = createStore();

    store.set(defaultWorkspaceModeAtom, "current");

    expect(
      JSON.parse(
        window.localStorage.getItem(persistedStorageKey("workspace.default-mode")) ?? "null",
      ),
    ).toEqual({ version: 1, value: "current" });
  });

  it("defaults new worktrees to the repository default branch and persists overrides", () => {
    const store = createStore();

    expect(store.get(defaultWorktreeBaseAtom)).toBe("repository-default");
    store.set(defaultWorktreeBaseAtom, "current");

    expect(
      JSON.parse(
        window.localStorage.getItem(persistedStorageKey("worktree.default-base")) ?? "null",
      ),
    ).toEqual({ version: 1, value: "current" });
  });
});

describe("turn activity disclosure", () => {
  beforeEach(() => window.localStorage.clear());

  it("persists a manual expansion by session and turn", () => {
    const store = createStore();
    const activity = turnActivityOpenAtomFamily("session-1", "turn-1");

    expect(store.get(activity)).toBeNull();
    store.set(activity, true);

    expect(store.get(activity)).toBe(true);
    expect(
      JSON.parse(
        window.localStorage.getItem(persistedStorageKey("timeline.turn-open:session-1%3Aturn-1")) ??
          "null",
      ),
    ).toEqual({ version: 1, value: true });
  });
});

describe("activity group disclosure", () => {
  beforeEach(() => window.localStorage.clear());

  it("persists manual group choices by session and stable group ID", () => {
    const store = createStore();
    const groupAtom = activityGroupOpenAtomFamily("session-group", "phase-entry");

    expect(store.get(groupAtom)).toBeNull();
    store.set(groupAtom, false);

    expect(store.get(groupAtom)).toBe(false);
    expect(
      JSON.parse(
        window.localStorage.getItem(
          persistedStorageKey("timeline.activity-open:session-group%3Aphase-entry"),
        ) ?? "null",
      ),
    ).toEqual({ version: 1, value: false });
  });
});

describe("session projection preference", () => {
  beforeEach(() => window.localStorage.clear());

  it("defaults new users to balanced activity and persists preset changes", () => {
    const store = createStore();

    expect(store.get(sessionProjectionPreferenceAtom)).toEqual({
      version: 2,
      preset: "compact",
    });

    store.set(sessionProjectionPreferenceAtom, { version: 2, preset: "compact" });

    expect(
      JSON.parse(window.localStorage.getItem(persistedStorageKey("timeline.projection")) ?? "null"),
    ).toEqual({ version: 1, value: { version: 2, preset: "compact" } });
  });
});

describe("composer drafts", () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => flushComposerDrafts());

  it("keeps structured drafts isolated by composer scope", () => {
    const store = createStore();
    const first = composerDraftAtomFamily("session:scoped-first");
    const second = composerDraftAtomFamily("session:scoped-second");
    const unsubscribe = store.sub(first, () => {});
    const draft = {
      text: "Review @src/main.ts",
      mentions: [
        {
          localID: "mention-1",
          kind: "file" as const,
          value: "src/main.ts",
          text: "@src/main.ts",
          start: 7,
          end: 19,
        },
      ],
      command: null,
    };

    store.set(first, draft);

    expect(store.get(first)).toEqual(draft);
    expect(store.get(second)).toEqual({ text: "", mentions: [], command: null });
    expect(
      window.localStorage.getItem(persistedStorageKey("composer.draft:session%3Ascoped-first")),
    ).toBeNull();
    // Navigating away flushes the scoped draft even before the scheduled write.
    unsubscribe();
    expect(
      JSON.parse(
        window.localStorage.getItem(persistedStorageKey("composer.draft:session%3Ascoped-first")) ??
          "null",
      ),
    ).toEqual({ version: 1, value: draft });
  });

  it("moves the legacy global string into only the first visible scope", () => {
    window.localStorage.setItem(
      "palot.composer.draft.v1",
      JSON.stringify({ version: 1, value: "legacy text" }),
    );
    const store = createStore();
    const visible = composerDraftAtomFamily("session:legacy-visible");
    const other = composerDraftAtomFamily("session:legacy-other");

    expect(store.get(visible)).toEqual({ text: "legacy text", mentions: [], command: null });
    expect(store.get(other)).toEqual({ text: "", mentions: [], command: null });
    expect(window.localStorage.getItem("palot.composer.draft.v1")).toBeNull();
    expect(
      JSON.parse(
        window.localStorage.getItem(
          persistedStorageKey("composer.draft:session%3Alegacy-visible"),
        ) ?? "null",
      ),
    ).toEqual({
      version: 1,
      value: { text: "legacy text", mentions: [], command: null },
    });
  });

  it("normalizes structured ranges before persisting updates", () => {
    const store = createStore();
    const draft = composerDraftAtomFamily("new:project:/repo:workspace");

    store.set(draft, {
      text: "plain text",
      mentions: [
        {
          localID: "stale",
          kind: "file",
          value: "missing.ts",
          text: "@missing.ts",
          start: 0,
          end: 11,
        },
      ],
      command: { name: "review", start: 0, end: 7 },
    });

    expect(store.get(draft)).toEqual({ text: "plain text", mentions: [], command: null });
  });
});

describe("cross-window composer drafts", () => {
  const subscriptions: (() => void)[] = [];
  const draft = (text: string) => ({ text, mentions: [], command: null });
  const key = (scope: string) => persistedStorageKey(`composer.draft:${encodeURIComponent(scope)}`);
  function remote(scope: string, text: string | null, dispatch = true) {
    const storageKey = key(scope);
    const oldValue = window.localStorage.getItem(storageKey);
    const newValue = text === null ? null : JSON.stringify({ version: 1, value: draft(text) });
    if (newValue === null) window.localStorage.removeItem(storageKey);
    else window.localStorage.setItem(storageKey, newValue);
    const event = new StorageEvent("storage", {
      key: storageKey,
      oldValue,
      newValue,
      storageArea: window.localStorage,
    });
    if (dispatch) window.dispatchEvent(event);
    return event;
  }
  function mount(scope: string) {
    const store = createStore();
    const value = composerDraftAtomFamily(scope);
    const unsubscribe = store.sub(value, () => {});
    subscriptions.push(unsubscribe);
    return { store, value, unsubscribe };
  }
  beforeEach(() => {
    window.localStorage.clear();
    vi.useFakeTimers();
  });
  afterEach(() => {
    subscriptions.splice(0).forEach((unsubscribe) => unsubscribe());
    flushComposerDrafts();
    vi.useRealTimers();
  });

  it("adopts remote edits without echoing them and preserves unrelated pending drafts", () => {
    const first = mount("session:remote-first");
    const second = mount("session:remote-second");
    first.store.set(first.value, draft("stale local"));
    second.store.set(second.value, draft("keep me"));
    remote("session:remote-first", "new remote");
    expect(first.store.get(first.value)).toEqual(draft("new remote"));
    const identity = first.store.get(first.value);
    remote("session:remote-first", "new remote");
    expect(first.store.get(first.value)).toBe(identity);
    vi.advanceTimersByTime(250);
    expect(JSON.parse(window.localStorage.getItem(key("session:remote-first"))!).value).toEqual(
      draft("new remote"),
    );
    expect(JSON.parse(window.localStorage.getItem(key("session:remote-second"))!).value).toEqual(
      draft("keep me"),
    );
  });

  it("propagates remote submission removal and storage clear without resurrecting pending text", () => {
    remote("session:remote-remove", "saved");
    const { store, value } = mount("session:remote-remove");
    store.set(value, draft("pending"));
    remote("session:remote-remove", null);
    expect(store.get(value)).toEqual(draft(""));
    vi.advanceTimersByTime(250);
    expect(window.localStorage.getItem(key("session:remote-remove"))).toBeNull();
    remote("session:remote-remove", "again");
    store.set(value, draft("pending again"));
    window.localStorage.clear();
    window.dispatchEvent(
      new StorageEvent("storage", { key: null, storageArea: window.localStorage }),
    );
    expect(store.get(value)).toEqual(draft(""));
    flushComposerDrafts();
    expect(window.localStorage.length).toBe(0);
  });

  it("reconciles a cached unmounted draft when it mounts again", () => {
    const { store, value, unsubscribe } = mount("session:remote-remount");
    store.set(value, draft("before"));
    unsubscribe();
    remote("session:remote-remount", "while away");
    subscriptions.push(store.sub(value, () => {}));
    expect(store.get(value)).toEqual(draft("while away"));
  });

  it("checks storage before flushing even when the remote event has not arrived", () => {
    const { store, value } = mount("session:remote-race");
    store.set(value, draft("stale"));
    const event = remote("session:remote-race", "newer", false);
    flushComposerDrafts();
    expect(store.get(value)).toEqual(draft("newer"));
    store.set(value, draft("intentional next edit"));
    window.dispatchEvent(event);
    expect(store.get(value)).toEqual(draft("intentional next edit"));
    flushComposerDrafts();
    expect(JSON.parse(window.localStorage.getItem(key("session:remote-race"))!).value).toEqual(
      draft("intentional next edit"),
    );
  });

  it("ignores sessionStorage events", () => {
    const { store, value } = mount("session:remote-storage-area");
    store.set(value, draft("local"));
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: key("session:remote-storage-area"),
        newValue: null,
        storageArea: window.sessionStorage,
      }),
    );
    expect(store.get(value)).toEqual(draft("local"));
  });
});
