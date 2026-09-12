import { createStore } from "jotai";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_APPEARANCE_PREFERENCES } from "../../shared";
import {
  appearancePreferencesAtom,
  committedAppearancePreferencesAtom,
  hydrateAppearancePreferencesAtom,
  replaceAppearancePreferencesAtom,
} from "./appearance";

describe("appearance preference reconciliation", () => {
  afterEach(() => window.localStorage.clear());

  it("hydrates both preference revisions from main before a reload can write its startup snapshot", () => {
    const store = createStore();
    const preferences = {
      ...DEFAULT_APPEARANCE_PREFERENCES,
      darkTheme: "codex" as const,
      uiFontSize: 19,
    };
    window.localStorage.setItem("palot.appearance.mode.v1", JSON.stringify("light"));
    store.set(hydrateAppearancePreferencesAtom, { preferences, hasStoredPreferences: true });
    expect(store.get(appearancePreferencesAtom)).toEqual(preferences);
    expect(store.get(committedAppearancePreferencesAtom)).toEqual(preferences);
  });

  it("only migrates a legacy mode when main still has no saved preferences", () => {
    const store = createStore();
    window.localStorage.setItem("palot.appearance.mode.v1", JSON.stringify("light"));
    store.set(hydrateAppearancePreferencesAtom, {
      preferences: DEFAULT_APPEARANCE_PREFERENCES,
      hasStoredPreferences: false,
    });
    expect(store.get(appearancePreferencesAtom).mode).toBe("light");
    expect(store.get(committedAppearancePreferencesAtom)).toEqual(DEFAULT_APPEARANCE_PREFERENCES);
  });
  it("accepts desktop discovery while preserving an optimistic user edit", () => {
    const store = createStore();
    store.set(appearancePreferencesAtom, { ...DEFAULT_APPEARANCE_PREFERENCES, glassOpacity: 64 });
    store.set(replaceAppearancePreferencesAtom, {
      ...DEFAULT_APPEARANCE_PREFERENCES,
      systemPalette: "omarchy",
    });
    expect(store.get(appearancePreferencesAtom).glassOpacity).toBe(64);
    expect(store.get(appearancePreferencesAtom).systemPalette).toBe("omarchy");
    expect(store.get(committedAppearancePreferencesAtom).systemPalette).toBe("omarchy");
  });
  it("does not replace an optimistic slider value with a stale main-process event", () => {
    const store = createStore();
    store.set(appearancePreferencesAtom, {
      ...DEFAULT_APPEARANCE_PREFERENCES,
      glassOpacity: 64,
    });

    store.set(replaceAppearancePreferencesAtom, {
      ...DEFAULT_APPEARANCE_PREFERENCES,
      glassOpacity: 55,
    });

    expect(store.get(appearancePreferencesAtom).glassOpacity).toBe(64);
  });

  it("accepts a main-process event that confirms the optimistic value", () => {
    const store = createStore();
    const preferences = {
      ...DEFAULT_APPEARANCE_PREFERENCES,
      glassOpacity: 64,
    };
    store.set(appearancePreferencesAtom, preferences);

    store.set(replaceAppearancePreferencesAtom, preferences);

    expect(store.get(committedAppearancePreferencesAtom).glassOpacity).toBe(64);
  });

  it("accepts external changes when there is no optimistic edit", () => {
    const store = createStore();
    store.set(replaceAppearancePreferencesAtom, {
      ...DEFAULT_APPEARANCE_PREFERENCES,
      glassOpacity: 70,
    });

    expect(store.get(appearancePreferencesAtom).glassOpacity).toBe(70);
    expect(store.get(committedAppearancePreferencesAtom).glassOpacity).toBe(70);
  });
});
