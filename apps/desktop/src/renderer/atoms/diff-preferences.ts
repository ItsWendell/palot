import type { LineDiffTypes } from "@pierre/diffs";
import type { DiffLayoutPreference } from "../lib/diff-layout";
import { persistedAtom } from "./persisted";

/** Inline highlighting inside changed lines. */
export type DiffInlineChanges = Extract<LineDiffTypes, "word" | "char" | "none">;

export interface DiffViewPreferences {
  layout: DiffLayoutPreference;
  inline: DiffInlineChanges;
  hideWhitespace: boolean;
  /** Lockfiles, generated files and migrations start collapsed in multi-file diffs. */
  collapseQuietFiles: boolean;
}

export const DEFAULT_DIFF_VIEW_PREFERENCES: DiffViewPreferences = {
  layout: "auto",
  inline: "word",
  hideWhitespace: false,
  collapseQuietFiles: true,
};

function isDiffViewPreferences(value: unknown): value is DiffViewPreferences {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    (candidate.layout === "auto" ||
      candidate.layout === "split" ||
      candidate.layout === "unified") &&
    (candidate.inline === "word" || candidate.inline === "char" || candidate.inline === "none") &&
    typeof candidate.hideWhitespace === "boolean" &&
    typeof candidate.collapseQuietFiles === "boolean"
  );
}

/** Shared by the Changes, file diff, and turn diff tabs. */
export const diffViewPreferencesAtom = persistedAtom({
  key: "diff.view-preferences",
  initialValue: DEFAULT_DIFF_VIEW_PREFERENCES,
  validate: isDiffViewPreferences,
  // Preferences saved before the collapse setting existed keep their other choices.
  migrate: (value) =>
    typeof value === "object" && value !== null
      ? { ...DEFAULT_DIFF_VIEW_PREFERENCES, ...value }
      : undefined,
});
