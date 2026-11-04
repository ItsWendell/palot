/** Plain-text URL detection shared by Markdown autolinks and plain text such as errors. */

/** GFM-style trailing punctuation backtracking, matching OpenCode's marked autolinks. */
export function trimAutoLinkLiteral(value: string): string {
  let end = value.length;
  let previous = -1;
  while (end !== previous) {
    previous = end;
    while (/[.,!?;:*_'"~]$/.test(value.slice(0, end))) end -= 1;
    while (value[end - 1] === ")" && unbalancedClosing(value.slice(0, end), "(", ")")) end -= 1;
    while (value[end - 1] === "]" && unbalancedClosing(value.slice(0, end), "[", "]")) end -= 1;
  }
  return value.slice(0, end);
}

function unbalancedClosing(value: string, open: string, close: string): boolean {
  return value.split(close).length > value.split(open).length;
}

export type TextSegment = { text: string; href?: undefined } | { text: string; href: string };

/**
 * Splits plain text into runs, marking each http(s) URL with its link target. Text inside
 * backticks is code and stays plain; nothing else is interpreted as Markdown.
 */
export function linkSegments(text: string): TextSegment[] {
  const segments: TextSegment[] = [];
  let plain = "";
  let offset = 0;
  for (const match of text.matchAll(/`[^`\n]*`|https?:\/\/[^\s<>"'`]+/gi)) {
    const value = match[0];
    if (value.startsWith("`")) continue;
    const literal = trimAutoLinkLiteral(value);
    // Like GFM, a web link needs a host right after its scheme.
    if (!/^https?:\/\/[A-Za-z0-9-]/i.test(literal) || !URL.canParse(literal)) continue;
    plain += text.slice(offset, match.index);
    if (plain) segments.push({ text: plain });
    plain = "";
    segments.push({ text: literal, href: literal });
    offset = match.index + literal.length;
  }
  plain += text.slice(offset);
  if (plain) segments.push({ text: plain });
  return segments;
}
