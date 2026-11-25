import type { MarkdownExtension } from "@tanstack/markdown";

/**
 * Keeps a single `~` literal. GFM strikes text between single tildes, which hides parts of what
 * people type, such as `move ~/foo to (~/bar)`. Only for text the user wrote: `~~double~~` still
 * strikes, and code spans and blocks are never inline-parsed. The `~` becomes its own text node;
 * the HTML extension's `transformInline` joins it with the text around it.
 */
export function literalSingleTildeExtension(): MarkdownExtension {
  return {
    name: "palot-literal-single-tilde",
    inlineParser: {
      markers: "~",
      parse: ({ source, index }) =>
        source[index + 1] === "~" || source[index - 1] === "~"
          ? undefined
          : { node: { type: "text", value: "~" }, length: 1 },
    },
  };
}
