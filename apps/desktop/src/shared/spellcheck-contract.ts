/**
 * Chromium spellchecking in Palot's own windows. Task browser pages use their own
 * sessions and are not affected by these settings.
 */

export const SPELLCHECK_IPC_CHANNELS = {
  spellcheckLoad: "palot:spellcheck:load",
  spellcheckUpdate: "palot:spellcheck:update",
} as const;

export interface SpellcheckSettings {
  enabled: boolean;
  /** False on macOS, where the system spellchecker detects the language as you type. */
  chooseLanguages: boolean;
  /** Dictionaries in use, as Chromium language tags. Empty when `chooseLanguages` is false. */
  languages: string[];
  /** True while the languages follow the system's preferred languages, not a saved choice. */
  followsSystem: boolean;
  /** Every dictionary Chromium offers on this platform. */
  available: string[];
}

/** `languages: null` returns to the system languages. */
export type SpellcheckUpdate = { enabled: boolean } | { languages: string[] | null };

export interface PalotSpellcheckApi {
  load(): Promise<SpellcheckSettings>;
  update(update: SpellcheckUpdate): Promise<SpellcheckSettings>;
}
