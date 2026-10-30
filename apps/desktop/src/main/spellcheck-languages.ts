// Adapted from OpenCode v2.2.3 (MIT), Copyright (c) 2025 opencode.
// https://github.com/anomalyco/opencode/blob/v2.2.3/packages/desktop/src/main/native/spellcheck-languages.ts
// Palot adds locale normalization, saved-choice resolution, and canonical tag matching.

const base = (tag: string) => tag.split("-")[0]!.toLowerCase();

/** `nl_NL.UTF-8` and `sr@latin` style POSIX locales become `nl-NL` and `sr`; `C` is dropped. */
function normalizeLocale(tag: string): string | undefined {
  const normalized = tag.split(/[.@]/)[0]!.replaceAll("_", "-").trim();
  return normalized && normalized !== "C" && normalized !== "POSIX" ? normalized : undefined;
}

/** Chromium's own tag for each requested language, matched case-insensitively, once each. */
export function matchSpellcheckLanguages(
  available: readonly string[],
  requested: readonly string[],
): string[] {
  const matched: string[] = [];
  for (const tag of requested) {
    const language = available.find((item) => item.toLowerCase() === tag.toLowerCase());
    if (language && !matched.includes(language)) matched.push(language);
  }
  return matched;
}

/**
 * One dictionary per system language, matched exactly or by base language (de-AT -> de).
 * Chromium lists aliases such as de and de-DE separately, so a later tag for the same
 * language is skipped. US English is added when none of them is English, because prompts
 * mix prose with English code terms.
 */
export function defaultSpellcheckLanguages(
  available: readonly string[],
  preferred: readonly string[],
): string[] {
  const find = (tag: string) =>
    available.find((language) => language.toLowerCase() === tag.toLowerCase());

  const languages = preferred
    .flatMap((tag) => {
      const locale = normalizeLocale(tag);
      return locale ? (find(locale) ?? find(base(locale)) ?? []) : [];
    })
    .filter(
      (language, index, all) => all.findIndex((other) => base(other) === base(language)) === index,
    );

  if (languages.some((language) => base(language) === "en") || !available.includes("en-US"))
    return languages;
  return [...languages, "en-US"];
}

/** A saved choice wins while any of it is still available; otherwise follow the system. */
export function resolveSpellcheckLanguages(
  available: readonly string[],
  saved: readonly string[] | undefined,
  preferred: readonly string[],
): { languages: string[]; followsSystem: boolean } {
  const chosen = saved ? matchSpellcheckLanguages(available, saved) : [];
  if (chosen.length) return { languages: chosen, followsSystem: false };
  return { languages: defaultSpellcheckLanguages(available, preferred), followsSystem: true };
}
