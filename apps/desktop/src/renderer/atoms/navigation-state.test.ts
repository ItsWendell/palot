import { createStore } from "jotai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { persistedStorageKey } from "./persisted";

const NAVIGATION_STORAGE_KEY = persistedStorageKey("ui.navigation-open");
const INSPECTOR_STORAGE_KEY = persistedStorageKey("ui.inspector-open-sessions");

describe("navigation visibility", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.resetModules();
  });

  it("opens the left navigation by default and persists changes globally", async () => {
    const { navigationOpenAtom } = await import("./ui");
    const store = createStore();

    expect(store.get(navigationOpenAtom)).toBe(true);

    store.set(navigationOpenAtom, false);

    expect(JSON.parse(window.localStorage.getItem(NAVIGATION_STORAGE_KEY) ?? "null")).toEqual({
      version: 1,
      value: false,
    });

    vi.resetModules();
    const { navigationOpenAtom: restoredNavigationOpenAtom } = await import("./ui");
    expect(createStore().get(restoredNavigationOpenAtom)).toBe(false);
  });

  it("defaults the inspector closed and restores visibility when switching sessions", async () => {
    const { inspectorOpenAtom, selectedSessionIDAtom } = await import("./workspace");
    const store = createStore();

    expect(store.get(inspectorOpenAtom)).toBe(false);

    store.set(selectedSessionIDAtom, "session-a");
    expect(store.get(inspectorOpenAtom)).toBe(false);

    store.set(inspectorOpenAtom, (open) => !open);
    expect(store.get(inspectorOpenAtom)).toBe(true);

    store.set(selectedSessionIDAtom, "session-b");
    expect(store.get(inspectorOpenAtom)).toBe(false);

    store.set(inspectorOpenAtom, true);
    store.set(selectedSessionIDAtom, "session-a");
    expect(store.get(inspectorOpenAtom)).toBe(true);

    store.set(inspectorOpenAtom, false);
    store.set(selectedSessionIDAtom, "session-b");
    expect(store.get(inspectorOpenAtom)).toBe(true);
    store.set(selectedSessionIDAtom, "session-a");
    expect(store.get(inspectorOpenAtom)).toBe(false);
  });

  it("restores inspector visibility after a renderer restart", async () => {
    const { inspectorOpenAtom, selectedSessionIDAtom } = await import("./workspace");
    const store = createStore();

    store.set(selectedSessionIDAtom, "persisted-session");
    store.set(inspectorOpenAtom, true);

    vi.resetModules();
    const restored = await import("./workspace");
    const restoredStore = createStore();
    restoredStore.set(restored.selectedSessionIDAtom, "persisted-session");

    expect(restoredStore.get(restored.inspectorOpenAtom)).toBe(true);
  });

  it("bounds persisted inspector entries and removes closed sessions", async () => {
    const { inspectorOpenAtom, selectedSessionIDAtom } = await import("./workspace");
    const store = createStore();

    for (let index = 0; index < 105; index += 1) {
      store.set(selectedSessionIDAtom, `session-${index}`);
      store.set(inspectorOpenAtom, true);
    }

    const persisted = JSON.parse(window.localStorage.getItem(INSPECTOR_STORAGE_KEY) ?? "null") as {
      version: number;
      value: string[];
    };
    expect(persisted.version).toBe(1);
    expect(persisted.value).toHaveLength(100);
    expect(persisted.value[0]).toBe("session-5");
    expect(persisted.value.at(-1)).toBe("session-104");

    store.set(inspectorOpenAtom, false);
    const afterClose = JSON.parse(window.localStorage.getItem(INSPECTOR_STORAGE_KEY) ?? "null") as {
      value: string[];
    };
    expect(afterClose.value).not.toContain("session-104");
  });

  it("migrates shipped pane-width preferences into validated geometry", async () => {
    window.localStorage.setItem("palot.navigation-width", "300");
    window.localStorage.setItem("palot.inspector-width", "400");
    const { paneGeometryAtom } = await import("./workspace");

    expect(createStore().get(paneGeometryAtom)).toEqual({
      navigation: 300,
      right: 400,
      bottom: 280,
    });
  });

  it("persists sidebar section expansion", async () => {
    const { sidebarSectionsAtom } = await import("./attention");
    const store = createStore();

    store.set(sidebarSectionsAtom, (current) => ({ ...current, recents: false }));

    vi.resetModules();
    const { sidebarSectionsAtom: restoredAtom } = await import("./attention");
    expect(createStore().get(restoredAtom).recents).toBe(false);
  });
});
