import { createStore } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  flushScheduledPersistedValues,
  loadScopedPersistedValue,
  persistedAtom,
  persistedStorageKey,
  removeScopedPersistedValue,
  saveScopedPersistedValue,
  scheduleScopedPersistedValue,
  scheduledScopedPersistence,
} from "./persisted";

describe("persistedAtom", () => {
  beforeEach(() => window.localStorage.clear());

  it("loads and updates versioned values", () => {
    window.localStorage.setItem(
      persistedStorageKey("test"),
      JSON.stringify({ version: 1, value: "saved" }),
    );
    const valueAtom = persistedAtom({
      key: "test",
      initialValue: "initial",
      validate: (value): value is string => typeof value === "string",
    });
    const store = createStore();

    expect(store.get(valueAtom)).toBe("saved");
    store.set(valueAtom, (value) => `${value}-next`);
    expect(store.get(valueAtom)).toBe("saved-next");
    expect(JSON.parse(window.localStorage.getItem(persistedStorageKey("test")) ?? "null")).toEqual({
      version: 1,
      value: "saved-next",
    });
  });

  it("ignores invalid and stale values", () => {
    window.localStorage.setItem(
      persistedStorageKey("test"),
      JSON.stringify({ version: 2, value: 42 }),
    );
    const valueAtom = persistedAtom({
      key: "test",
      initialValue: "initial",
      validate: (value): value is string => typeof value === "string",
    });

    expect(createStore().get(valueAtom)).toBe("initial");
  });

  it("falls back when a stored preference contains malformed JSON", () => {
    window.localStorage.setItem(persistedStorageKey("test"), "{");
    const valueAtom = persistedAtom({
      key: "test",
      initialValue: "initial",
      validate: (value): value is string => typeof value === "string",
    });

    expect(createStore().get(valueAtom)).toBe("initial");
  });

  it("rewrites migrated values stored under the current key", () => {
    window.localStorage.setItem(
      persistedStorageKey("test"),
      JSON.stringify({ version: 2, value: "legacy" }),
    );
    const valueAtom = persistedAtom({
      key: "test",
      initialValue: "initial",
      validate: (value): value is string => typeof value === "string" && value.endsWith("-next"),
      migrate: (value) => (typeof value === "string" ? `${value}-next` : undefined),
    });

    expect(createStore().get(valueAtom)).toBe("legacy-next");
    expect(JSON.parse(window.localStorage.getItem(persistedStorageKey("test")) ?? "null")).toEqual({
      version: 1,
      value: "legacy-next",
    });
  });
});

describe("scheduled scoped persistence", () => {
  let persistence: ReturnType<typeof scheduledScopedPersistence<string>>;
  beforeEach(() => {
    window.localStorage.clear();
    vi.useFakeTimers();
    persistence = scheduledScopedPersistence<string>("draft", 2);
  });
  afterEach(() => {
    persistence.flush();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  function saved(scope: string) {
    return JSON.parse(window.localStorage.getItem(persistedStorageKey(`draft:${scope}`)) ?? "null")
      ?.value;
  }

  it("serializes only the latest edit within a bounded window", () => {
    const stringify = vi.spyOn(JSON, "stringify");
    for (let index = 0; index < 100; index++) {
      persistence.save("a", `${"x".repeat(99_997)}${index}`);
    }
    expect(stringify).not.toHaveBeenCalled();
    vi.advanceTimersByTime(249);
    expect(saved("a")).toBeUndefined();
    persistence.save("a", "latest");
    vi.advanceTimersByTime(1);
    expect(saved("a")).toBe("latest");
    expect(stringify).toHaveBeenCalledTimes(2); // Draft and retention index, not each keystroke.
  });

  it("flushes isolated scopes and retains the most recently edited ones", () => {
    persistence.save("a", "old a");
    persistence.save("b", "b");
    persistence.save("c", "c");
    persistence.save("a", "new a");
    persistence.flush();
    expect(saved("a")).toBe("new a");
    expect(saved("b")).toBeUndefined();
    expect(saved("c")).toBe("c");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("never resurrects a cleared draft when a pending save fires", () => {
    persistence.save("a", "submitted");
    persistence.save("b", "keep");
    persistence.remove("a");
    vi.advanceTimersByTime(250);
    expect(saved("a")).toBeUndefined();
    expect(saved("b")).toBe("keep");
    persistence.save("a", "new turn");
    persistence.flush();
    expect(saved("a")).toBe("new turn");
  });

  it("cancels a remote-conflicted pending save even without a mounted subscriber", () => {
    persistence.save("a", "stale local");
    persistence.save("b", "unrelated");
    const key = persistedStorageKey("draft:a");
    const newValue = JSON.stringify({ version: 1, value: "remote winner" });
    window.localStorage.setItem(key, newValue);
    window.dispatchEvent(
      new StorageEvent("storage", {
        key,
        newValue,
        storageArea: window.localStorage,
      }),
    );
    vi.advanceTimersByTime(250);
    expect(saved("a")).toBe("remote winner");
    expect(saved("b")).toBe("unrelated");
  });

  it("cancels unsaved drafts on a remote clear event", () => {
    persistence.save("a", "not saved yet");
    window.localStorage.setItem("unrelated", "ensures clear emits an event");
    window.localStorage.clear();
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: null,
        newValue: null,
        storageArea: window.localStorage,
      }),
    );
    vi.advanceTimersByTime(250);
    expect(saved("a")).toBeUndefined();
  });

  it("shares pending values and cancellation across persistence entry points", () => {
    persistence.save("a", "first edit");
    scheduleScopedPersistedValue("draft", "a", "latest edit", 2);
    persistence.flush();
    expect(saved("a")).toBe("latest edit");
    persistence.save("a", "submitted edit");
    removeScopedPersistedValue("draft", "a");
    vi.runAllTimers();
    persistence.flush();
    expect(saved("a")).toBeUndefined();
  });

  it.each(["pagehide", "beforeunload"])("flushes on %s without leaving pending work", (event) => {
    persistence.save("a", "last edit");
    window.dispatchEvent(new Event(event));
    expect(saved("a")).toBe("last edit");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("flushes before background timer throttling", () => {
    persistence.save("a", "last edit");
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(saved("a")).toBe("last edit");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("persists an async draft restoration when the document is already hidden", () => {
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    persistence.save("a", "restored after a failed submission");
    expect(saved("a")).toBe("restored after a failed submission");
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("scheduled draft persistence", () => {
  function spyOnWrites() {
    const storage = window.localStorage;
    const write = vi.fn(storage.setItem.bind(storage));
    vi.spyOn(window, "localStorage", "get").mockReturnValue({
      get length() {
        return storage.length;
      },
      clear: storage.clear.bind(storage),
      getItem: storage.getItem.bind(storage),
      key: storage.key.bind(storage),
      removeItem: storage.removeItem.bind(storage),
      setItem: write,
    });
    return { write, restore: () => write.mockImplementation(storage.setItem.bind(storage)) };
  }
  beforeEach(() => {
    window.localStorage.clear();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    flushScheduledPersistedValues();
    vi.useRealTimers();
  });

  const read = (scope: string) =>
    loadScopedPersistedValue({
      family: "drafts",
      scope,
      maxEntries: 100,
      initialValue: "",
      validate: (value): value is string => typeof value === "string",
    });
  const stored = (scope: string) =>
    JSON.parse(window.localStorage.getItem(persistedStorageKey(`drafts:${scope}`)) ?? "null");

  it("coalesces large draft updates before serializing and retains independent scopes", () => {
    const { write } = spyOnWrites();
    const text = "large draft ".repeat(6_000);
    for (let i = 0; i < 100; i++)
      scheduleScopedPersistedValue("drafts", "first", `${text}${i}`, 100);
    scheduleScopedPersistedValue("drafts", "second", "another draft", 100);
    expect(write).not.toHaveBeenCalled();
    expect(read("first")).toBe(`${text}99`);
    expect(read("second")).toBe("another draft");
    vi.advanceTimersByTime(250);
    expect(stored("first")).toEqual({ version: 1, value: `${text}99` });
    expect(stored("second")).toEqual({ version: 1, value: "another draft" });
    expect(
      write.mock.calls.filter(([key]) => key === persistedStorageKey("drafts:first")),
    ).toHaveLength(1);
  });

  it("flushes continuous edits without extending the first write deadline", () => {
    scheduleScopedPersistedValue("drafts", "first", "a", 100);
    vi.advanceTimersByTime(200);
    scheduleScopedPersistedValue("drafts", "first", "ab", 100);
    vi.advanceTimersByTime(50);
    expect(stored("first")?.value).toBe("ab");
  });

  it("retains the newest edit when eviction encounters another queued scope", () => {
    saveScopedPersistedValue("drafts", "first", "old", 1);
    scheduleScopedPersistedValue("drafts", "first", "intermediate", 1);
    scheduleScopedPersistedValue("drafts", "second", "older edit", 1);
    scheduleScopedPersistedValue("drafts", "first", "newest edit", 1);
    flushScheduledPersistedValues();
    expect(stored("first")?.value).toBe("newest edit");
    expect(stored("second")).toBeNull();
  });

  it("does not resurrect drafts cleared before a scheduled flush", () => {
    scheduleScopedPersistedValue("drafts", "first", "submitted text", 100);
    removeScopedPersistedValue("drafts", "first");
    vi.runAllTimers();
    window.dispatchEvent(new Event("pagehide"));
    expect(stored("first")).toBeNull();
    expect(read("first")).toBe("");
  });

  it("flushes pending drafts when the renderer hides or navigates away", () => {
    scheduleScopedPersistedValue("drafts", "first", "before hiding", 100);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(stored("first")?.value).toBe("before hiding");
    scheduleScopedPersistedValue("drafts", "first", "before navigation", 100);
    window.dispatchEvent(new Event("pagehide"));
    expect(stored("first")?.value).toBe("before navigation");
  });

  it("retains the latest draft when storage fails and retries on a later flush", () => {
    const { write, restore } = spyOnWrites();
    write.mockImplementation(() => {
      throw new Error("Quota exceeded");
    });
    scheduleScopedPersistedValue("drafts", "first", "recover me", 100);
    vi.advanceTimersByTime(250);
    expect(read("first")).toBe("recover me");
    expect(stored("first")).toBeNull();
    restore();
    flushScheduledPersistedValues();
    expect(stored("first")?.value).toBe("recover me");
  });
});
