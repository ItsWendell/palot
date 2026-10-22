/**
 * Incremental highlighting for a code block that grows while a reply streams.
 *
 * Each update appends the new text to a Highlights `LiveTokenizer` as one edit. A lexer
 * only carries state forward, so lines before the previous last line are final; only
 * that line and the lines after it are tokenized and read again. Anything other than an
 * append (an edited or shortened block) resets the document.
 */

import { LiveTokenizer, type Lang, type Theme } from "@pierre/highlights";

export interface StyledToken {
  value: string;
  color?: string;
  fontStyle?: number;
}

export class StreamingCodeTokens {
  readonly language: Lang;
  readonly theme: string;
  #tokenizer: LiveTokenizer;
  #source = "";
  /** Tokens per line, without line terminators. */
  #lines: StyledToken[][] = [];

  constructor(language: Lang, theme: string, zedTheme: Theme) {
    this.language = language;
    this.theme = theme;
    this.#tokenizer = new LiveTokenizer({ lang: language, theme: zedTheme });
  }

  /** Tokens for `code`, or null when they cannot reproduce it exactly. */
  update(code: string): StyledToken[] | null {
    let first: number;
    if (code.startsWith(this.#source)) {
      first = this.#tokenizer.lineCount - 1;
      const end = { line: first, character: this.#tokenizer.getLineLength(first) };
      const appended = code.slice(this.#source.length);
      if (appended) this.#tokenizer.applyEdits([{ range: { start: end, end }, newText: appended }]);
    } else {
      first = 0;
      this.#tokenizer.reset(code);
    }
    this.#source = code;

    const count = this.#tokenizer.lineCount;
    this.#lines.length = Math.min(this.#lines.length, first);
    for (let line = first; line < count; line += 1) {
      this.#lines[line] = this.#tokenizer
        .getLineTokens(line)
        .tokens.filter((token) => token.content.length > 0)
        .map((token) => ({
          value: token.content,
          ...(token.color ? { color: token.color } : {}),
          ...(token.fontStyle ? { fontStyle: token.fontStyle } : {}),
        }));
    }

    const tokens: StyledToken[] = [];
    this.#lines.forEach((line, index) => {
      if (index > 0) tokens.push({ value: "\n" });
      tokens.push(...line);
    });
    // The tokenizer reads every line break as `\n`. Never lose raw characters to it.
    return tokens.map((token) => token.value).join("") === code ? tokens : null;
  }

  /** Releases the tokenizer's WebAssembly instance. */
  dispose(): void {
    this.#tokenizer.dispose();
  }
}
