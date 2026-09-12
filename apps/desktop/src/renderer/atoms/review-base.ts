import type { LocationRef } from "@opencode/client";
import { atom } from "jotai";
import {
  loadScopedPersistedValue,
  saveScopedPersistedValue,
  removeScopedPersistedValue,
} from "./persisted";

export function reviewBaseScope(connectionID: string, location: LocationRef) {
  return JSON.stringify([connectionID, location.directory, location.workspaceID ?? null]);
}

const choicesAtom = atom<Record<string, string | null>>({});
export const reviewBaseChoiceAtom = atom(
  (get) => {
    const choices = get(choicesAtom);
    return (scope: string): string | null => {
      if (Object.hasOwn(choices, scope)) return choices[scope] ?? null;
      return loadScopedPersistedValue({
        family: "review-base",
        scope,
        maxEntries: 100,
        initialValue: null,
        validate: (value): value is string | null =>
          value === null || (typeof value === "string" && value.trim().length > 0),
      });
    };
  },
  (get, set, scope: string, value: string | null) => {
    const choice = value?.trim() || null;
    set(choicesAtom, { ...get(choicesAtom), [scope]: choice });
    if (choice) saveScopedPersistedValue("review-base", scope, choice, 100);
    else removeScopedPersistedValue("review-base", scope);
  },
);
