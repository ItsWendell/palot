/**
 * Review and browser element comments in a sent user message, as quotes the transcript shows
 * as compact chips instead of the sentences the agent received.
 */
import type { PalotMessage } from "../../shared";
import { browserCommentsFromMessage } from "./browser-comments";
import { reviewCommentsFromMessage } from "./review-comments";

export type MessageQuote =
  | {
      kind: "review";
      path: string;
      startLine: number;
      endLine: number;
      /** Removed lines are numbered in the version before the change. */
      removed: boolean;
      comment: string;
    }
  | { kind: "browser"; label: string; url: string; comment: string };

export interface QuotedUserText {
  /** What the person typed, without the comment sentences. */
  text: string;
  quotes: MessageQuote[];
}

/**
 * Splits a user message's text into what was typed and its comments. Palot's own metadata wins;
 * without it (an optimistic message, an older or foreign one) the sentences Palot writes are parsed.
 * Returns null when the message has no comments.
 */
export function quotedUserText(message: PalotMessage, text: string): QuotedUserText | null {
  return structuredQuotes(message, text) ?? parseQuotedText(text);
}

function structuredQuotes(message: PalotMessage, text: string): QuotedUserText | null {
  const comments = reviewCommentsFromMessage(message);
  if (!comments) return null;
  const browser = browserCommentsFromMessage(message);
  if (comments.length === 0 && browser.length === 0) return null;
  const metadata = (message.data as { metadata: { displayText: string } }).metadata;
  const typed = metadata.displayText;
  // Only the message's own text: a part that is not it keeps its sentences.
  if (!text.startsWith(typed.trimEnd())) return null;
  return {
    text: typed,
    quotes: [
      ...comments.map((comment): MessageQuote => ({
        kind: "review",
        path: comment.path,
        startLine: comment.selection.startLine,
        endLine: comment.selection.endLine,
        removed: comment.side === "deletions",
        comment: comment.comment,
      })),
      ...browser.map((comment): MessageQuote => ({
        kind: "browser",
        label: comment.element.label,
        url: comment.url,
        comment: comment.comment,
      })),
    ],
  };
}

const REVIEW_SENTENCE =
  /^The user made the following comment regarding (?:line (\d+)|lines (\d+) through (\d+)) of (.+?)( \(removed lines?, old version\))?: /;
const JSON_STRING = String.raw`"(?:[^"\\]|\\.)*"`;
const BROWSER_SENTENCE = new RegExp(
  `^The user commented on the (${JSON_STRING}) element in browser tab ${JSON_STRING} at (${JSON_STRING})(?: \\((?:${JSON_STRING}|[^"])*?\\))?: `,
);

function startQuote(line: string): { quote: MessageQuote; rest: string } | null {
  const review = REVIEW_SENTENCE.exec(line);
  if (review) {
    const start = Number(review[1] ?? review[2]);
    const end = Number(review[1] ?? review[3]);
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end) return null;
    return {
      quote: {
        kind: "review",
        path: review[4]!,
        startLine: start,
        endLine: end,
        removed: Boolean(review[5]),
        comment: "",
      },
      rest: line.slice(review[0].length),
    };
  }
  const browser = BROWSER_SENTENCE.exec(line);
  if (browser) {
    try {
      const label: unknown = JSON.parse(browser[1]!);
      const url: unknown = JSON.parse(browser[2]!);
      if (typeof label !== "string" || typeof url !== "string") return null;
      return {
        quote: { kind: "browser", label, url, comment: "" },
        rest: line.slice(browser[0].length),
      };
    } catch {
      return null;
    }
  }
  return null;
}

/** Comment sentences follow the typed text, one per line; a comment may span lines. */
export function parseQuotedText(text: string): QuotedUserText | null {
  const lines = text.split("\n");
  const first = lines.findIndex((line) => startQuote(line) !== null);
  if (first === -1) return null;
  const quotes: MessageQuote[] = [];
  for (const line of lines.slice(first)) {
    const started = startQuote(line);
    if (started) quotes.push({ ...started.quote, comment: started.rest });
    else {
      const last = quotes.at(-1)!;
      last.comment = `${last.comment}\n${line}`;
    }
  }
  return {
    text: lines.slice(0, first).join("\n"),
    quotes: quotes.map((quote) => ({ ...quote, comment: quote.comment.trim() })),
  };
}

/** "src/a.ts:L12–18", the label a review quote's chip shows. */
export function quoteLocation(quote: Extract<MessageQuote, { kind: "review" }>): string {
  return quote.startLine === quote.endLine
    ? `${quote.path}:L${quote.startLine}`
    : `${quote.path}:L${quote.startLine}–${quote.endLine}`;
}
