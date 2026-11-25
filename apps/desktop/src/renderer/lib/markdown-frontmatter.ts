export interface MarkdownFrontmatter {
  /** The exact frontmatter block, including its fences and trailing line break. */
  raw: string;
  /** The YAML between the fences. */
  yaml: string;
  /** Flat `key: value` properties, or null when the YAML is nested or multi-line. */
  properties: Array<{ key: string; value: string }> | null;
}

const FRONTMATTER = /^---[ \t]*\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/;
const PROPERTY = /^([A-Za-z0-9_.-]+):[ \t]*(.*)$/;
const LIST_ITEM = /^[ \t]+-[ \t]+(.*)$/;

function unquote(value: string): string {
  const trimmed = value.trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  )
    return trimmed.slice(1, -1);
  return trimmed;
}

/** Flat properties only; anything YAML-structured beyond that is shown as source. */
function flatProperties(yaml: string): MarkdownFrontmatter["properties"] {
  const properties: Array<{ key: string; value: string; items?: string[] }> = [];
  for (const line of yaml.split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const item = LIST_ITEM.exec(line);
    const previous = properties.at(-1);
    if (item && previous && previous.value === "") {
      (previous.items ??= []).push(unquote(item[1] ?? ""));
      continue;
    }
    const property = PROPERTY.exec(line);
    const value = property?.[2]?.trim() ?? "";
    // Block scalars (`|`, `>`) and nested maps need a real YAML reader.
    if (!property || /^[|>]/.test(value)) return null;
    properties.push({ key: property[1]!, value: unquote(value) });
  }
  return properties.map(({ key, value, items }) => ({
    key,
    value: items ? items.join(", ") : value,
  }));
}

/** Splits a leading YAML frontmatter block (`---` … `---`) off a Markdown document. */
export function splitMarkdownFrontmatter(text: string): {
  frontmatter: MarkdownFrontmatter | null;
  body: string;
} {
  const match = FRONTMATTER.exec(text);
  if (!match) return { frontmatter: null, body: text };
  const yaml = match[1] ?? "";
  return {
    frontmatter: { raw: match[0], yaml, properties: flatProperties(yaml) },
    body: text.slice(match[0].length),
  };
}
