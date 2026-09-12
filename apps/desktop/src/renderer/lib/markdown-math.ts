import type { InlineNode } from "@tanstack/markdown";

const INLINE_MATH_MARKER = "palot-inline-math:";

export function transformInlineMath(nodes: InlineNode[]): InlineNode[] {
  return nodes.flatMap((node) => {
    if (node.type === "text") return splitInlineMath(node.value);
    if (
      node.type === "strong" ||
      node.type === "emphasis" ||
      node.type === "strike" ||
      node.type === "link"
    ) {
      return [{ ...node, children: transformInlineMath(node.children) }];
    }
    return [node];
  });
}

function splitInlineMath(value: string): InlineNode[] {
  const nodes: InlineNode[] = [];
  let textStart = 0;
  let cursor = 0;

  while (cursor < value.length) {
    const next = value[cursor + 1] ?? "";
    if (
      value[cursor] !== "$" ||
      isEscaped(value, cursor) ||
      /\s/.test(next) ||
      (/\d/.test(next) && !hasCompactNumericMathClose(value, cursor + 1))
    ) {
      cursor += 1;
      continue;
    }

    let closing = cursor + 1;
    while (closing < value.length) {
      if (
        value[closing] === "$" &&
        !isEscaped(value, closing) &&
        !/\s/.test(value[closing - 1] ?? "")
      ) {
        break;
      }
      closing += 1;
    }
    if (closing >= value.length) {
      cursor += 1;
      continue;
    }

    pushText(nodes, value.slice(textStart, cursor));
    nodes.push({
      type: "inlineHtml",
      value: `${INLINE_MATH_MARKER}${encodeURIComponent(value.slice(cursor + 1, closing))}`,
    });
    cursor = closing + 1;
    textStart = cursor;
  }

  pushText(nodes, value.slice(textStart));
  return nodes;
}

function hasCompactNumericMathClose(value: string, start: number): boolean {
  for (let cursor = start; cursor < value.length && !/\s/.test(value[cursor] ?? ""); cursor += 1) {
    if (value[cursor] === "$" && !isEscaped(value, cursor)) return true;
  }
  return false;
}

function pushText(nodes: InlineNode[], value: string): void {
  if (!value) return;
  nodes.push({ type: "text", value: value.replaceAll(/\\\$/g, "$") });
}

function isEscaped(value: string, index: number): boolean {
  let slashes = 0;
  for (let cursor = index - 1; cursor >= 0 && value[cursor] === "\\"; cursor -= 1) {
    slashes += 1;
  }
  return slashes % 2 === 1;
}

export function parseInlineMathMarker(value: string): string | null {
  if (!value.startsWith(INLINE_MATH_MARKER)) return null;
  try {
    return decodeURIComponent(value.slice(INLINE_MATH_MARKER.length));
  } catch {
    return null;
  }
}
