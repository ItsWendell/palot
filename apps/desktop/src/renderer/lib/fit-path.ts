/**
 * Shortens a path to fit `fits`: as many leading segments as fit, then "…", then the last two segments.
 * The cut always lands on a separator, so the project folder and its parent stay readable. When even
 * the root and the last two segments don't fit, it drops the root, then the parent, so the final
 * folder survives. Adapted from OpenCode's location picker (#59397).
 */
export function fitPath(value: string, fits: (text: string) => boolean): string {
  if (fits(value)) return value;
  const separator = value.includes("/") ? "/" : "\\";
  const parts = value.split(separator);
  // Keep the root: "" before a leading "/", or a Windows drive such as "C:".
  const first = parts[0] === "" ? 2 : 1;
  const candidates = Array.from({ length: Math.max(0, parts.length - 2 - first) }, (_, index) =>
    [...parts.slice(0, parts.length - 3 - index), "…", ...parts.slice(-2)].join(separator),
  );
  const tail = parts.slice(-2).filter(Boolean);
  if (tail.length === 2) candidates.push(["…", ...tail].join(separator));
  if (tail.length > 0) candidates.push(["…", tail.at(-1)].join(separator));
  const shorter = candidates.filter((candidate) => candidate.length < value.length);
  return shorter.find(fits) ?? shorter.at(-1) ?? value;
}
