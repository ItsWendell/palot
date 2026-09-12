import { atom } from "jotai";
import {
  DEFAULT_APPEARANCE_PREFERENCES,
  normalizeAppearancePreferences,
  type AppearanceColorScheme,
  type AppearancePreferences,
} from "../../shared";
import { resolveAppearance } from "../lib/appearance";
import { persistedStorageKey } from "./persisted";

const LEGACY_APPEARANCE_KEYS = [
  persistedStorageKey("appearance.mode"),
  "palot.appearance.mode.v1",
] as const;

function readLegacyAppearanceMode(
  hasStoredPreferences: boolean,
): AppearancePreferences["mode"] | undefined {
  if (typeof window === "undefined" || hasStoredPreferences) return;
  for (const key of LEGACY_APPEARANCE_KEYS) {
    try {
      const parsed = JSON.parse(window.localStorage.getItem(key) ?? "null") as unknown;
      const value =
        parsed && typeof parsed === "object" && Object.hasOwn(parsed, "value")
          ? (parsed as { value?: unknown }).value
          : parsed;
      if (value === "system" || value === "light" || value === "dark") return value;
    } catch {
      // A corrupt legacy setting should not block startup.
    }
  }
}

export function clearLegacyAppearanceMode(): void {
  if (typeof window === "undefined") return;
  for (const key of LEGACY_APPEARANCE_KEYS) {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // Main already persisted the migration; cleanup is best effort.
    }
  }
}

function initialPreferences(): AppearancePreferences {
  const native = typeof window !== "undefined" ? window.palot?.appearancePreferences : undefined;
  const preferences = normalizeAppearancePreferences(native ?? DEFAULT_APPEARANCE_PREFERENCES);
  const legacyMode = readLegacyAppearanceMode(
    typeof window !== "undefined" && (window.palot?.hasStoredAppearancePreferences ?? false),
  );
  return legacyMode ? { ...preferences, mode: legacyMode } : preferences;
}

const initial = initialPreferences();
const preferencesValueAtom = atom(initial);
const committedPreferencesValueAtom = atom(
  normalizeAppearancePreferences(
    typeof window !== "undefined" ? window.palot?.appearancePreferences : initial,
  ),
);

export const appearancePreferencesAtom = atom(
  (get) => get(preferencesValueAtom),
  (
    get,
    set,
    update: AppearancePreferences | ((value: AppearancePreferences) => AppearancePreferences),
  ) => {
    const next = normalizeAppearancePreferences(
      typeof update === "function" ? update(get(preferencesValueAtom)) : update,
    );
    set(preferencesValueAtom, next);
  },
);

export const committedAppearancePreferencesAtom = atom((get) => get(committedPreferencesValueAtom));

export const commitAppearancePreferencesAtom = atom(
  null,
  (get, set, preferences: AppearancePreferences) => {
    const next = normalizeAppearancePreferences(preferences);
    const serialized = JSON.stringify(next);
    if (JSON.stringify(get(preferencesValueAtom)) !== serialized) {
      set(preferencesValueAtom, next);
    }
    if (JSON.stringify(get(committedPreferencesValueAtom)) !== serialized) {
      set(committedPreferencesValueAtom, next);
    }
  },
);

// Hydrate before mounting AppearanceSync: its first effect writes preferences
// back to main, so a BrowserWindow's immutable startup arguments are not safe.
export const hydrateAppearancePreferencesAtom = atom(
  null,
  (_get, set, snapshot: { preferences: AppearancePreferences; hasStoredPreferences: boolean }) => {
    const preferences = normalizeAppearancePreferences(snapshot.preferences);
    set(commitAppearancePreferencesAtom, preferences);
    const legacyMode = readLegacyAppearanceMode(snapshot.hasStoredPreferences);
    if (legacyMode) set(appearancePreferencesAtom, { ...preferences, mode: legacyMode });
  },
);

export const replaceAppearancePreferencesAtom = atom(
  null,
  (get, set, preferences: AppearancePreferences) => {
    const next = normalizeAppearancePreferences(preferences);
    const current = get(preferencesValueAtom);
    const committed = get(committedPreferencesValueAtom);
    const nextSerialized = JSON.stringify(next);
    const currentSerialized = JSON.stringify(current);
    const committedSerialized = JSON.stringify(committed);

    // Main may echo an older write while a newer local edit is still optimistic.
    if (currentSerialized !== committedSerialized && nextSerialized !== currentSerialized) {
      // Desktop palette discovery is main-owned, independent of pending user edits.
      const desktop = { systemPalette: next.systemPalette, omarchyTheme: next.omarchyTheme };
      const merged = { ...current, ...desktop };
      const confirmed = { ...committed, ...desktop };
      if (JSON.stringify(merged) !== currentSerialized) set(preferencesValueAtom, merged);
      if (JSON.stringify(confirmed) !== committedSerialized)
        set(committedPreferencesValueAtom, confirmed);
      return;
    }
    if (currentSerialized !== nextSerialized) set(preferencesValueAtom, next);
    if (committedSerialized !== nextSerialized) set(committedPreferencesValueAtom, next);
  },
);

export const systemColorSchemeAtom = atom<AppearanceColorScheme>(
  typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light",
);

export const appearanceRestartRequiredAtom = atom(false);

export const resolvedAppearanceAtom = atom((get) => {
  const preferences = get(preferencesValueAtom);
  const systemScheme = get(systemColorSchemeAtom);
  const scheme =
    preferences.source === "system" && preferences.omarchyTheme
      ? preferences.omarchyTheme.mode
      : preferences.source === "system" || preferences.mode === "system"
        ? systemScheme
        : preferences.mode;
  return resolveAppearance(preferences, scheme);
});
