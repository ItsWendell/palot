import { parseMarkdown, type ParseOptions } from "@tanstack/markdown";

function tasks(node: unknown): boolean[] {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap(tasks);
  const item = node as Record<string, unknown>;
  return [
    ...(typeof item.checked === "boolean" ? [item.checked] : []),
    ...Object.values(item).flatMap((value) => (typeof value === "object" ? tasks(value) : [])),
  ];
}

/** Verify each candidate against the parser, so fences, inline code and nested lists
 * cannot make a rendered checkbox edit a different source marker. */
export function toggleMarkdownTask(source: string, index: number, options?: ParseOptions): string {
  const before = tasks(parseMarkdown(source, options));
  if (before[index] === undefined) return source;
  for (const match of source.matchAll(/\[[ xX]\]/g)) {
    const at = match.index + 1;
    const next = source.slice(0, at) + (before[index] ? " " : "x") + source.slice(at + 1);
    const after = tasks(parseMarkdown(next, options));
    if (
      after.length === before.length &&
      after.every((value, i) => value === (i === index ? !before[i] : before[i]))
    )
      return next;
  }
  return source;
}
