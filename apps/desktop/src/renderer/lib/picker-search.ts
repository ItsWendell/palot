/**
 * Search matching shared by composer pickers and the `/model` command. Punctuation and
 * spacing are ignored, so "gpt 5", "gpt-5" and "gpt5" all find "GPT-5.1". Matches
 * OpenCode's model search (`packages/app/src/providers/models/search.ts`).
 */

export function normalizePickerSearch(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function compactPickerSearch(value: string): string {
  return normalizePickerSearch(value).replaceAll(" ", "");
}

/** True when the query is empty or any value contains it, ignoring punctuation and spacing. */
export function matchesPickerSearch(
  query: string,
  values: readonly (string | null | undefined)[],
): boolean {
  const search = normalizePickerSearch(query);
  if (!search) return true;
  const compact = search.replaceAll(" ", "");
  return values.some((value) => {
    if (!value) return false;
    const normalized = normalizePickerSearch(value);
    return normalized.includes(search) || normalized.replaceAll(" ", "").includes(compact);
  });
}
