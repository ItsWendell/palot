/**
 * The one code highlighter Palot uses: `@pierre/highlights` (WebAssembly), through
 * `@pierre/diffs`. Diffs allows a single highlighter type per thread, so every viewer,
 * worker pool, patch preview and markdown code block must pass this same type.
 */

import { getHighlighterIfLoaded, getSharedHighlighter, type DiffsHighlighter } from "@pierre/diffs";
import { isSupportedLanguage, type Lang, type Theme } from "@pierre/highlights";

export const CODE_HIGHLIGHTER = "highlights" as const;

/** Spread into `@pierre/diffs` viewer options and worker initialization options. */
export const codeHighlighterOptions = { preferredHighlighter: CODE_HIGHLIGHTER } as const;

/** A fence or file language Highlights lexes, or null for plain text. */
export function highlightLanguage(language: string): Lang | null {
  const value = language.trim().toLowerCase();
  if (!value || value === "text" || value === "plain" || value === "plaintext") return null;
  return isSupportedLanguage(value) ? value : null;
}

/** The shared highlighter with `theme` resolved; loads it on first use. */
export function loadCodeHighlighter(theme: string): Promise<DiffsHighlighter> {
  return getSharedHighlighter({
    themes: [theme],
    langs: [],
    preferredHighlighter: CODE_HIGHLIGHTER,
  });
}

/** The shared highlighter when it and `theme` are already loaded, without waiting. */
export function loadedCodeHighlighter(theme: string): DiffsHighlighter | undefined {
  return getHighlighterIfLoaded({ theme });
}

/** The resolved Zed theme a standalone Highlights tokenizer needs, once `theme` is loaded. */
export function loadedZedTheme(theme: string): Theme | undefined {
  return loadedCodeHighlighter(theme)?.getTheme(theme).zed;
}
