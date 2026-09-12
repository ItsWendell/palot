export type ComposerQuery =
  | { kind: "command"; start: number; end: number; query: string }
  | { kind: "skill"; start: number; end: number; query: string }
  | { kind: "file"; start: number; end: number; query: string };

export interface ComposerQueryOptions {
  isComposing?: boolean;
}

const openingBoundary = /[\s([{"'`<]/;
const commandCharacter = /[A-Za-z0-9_-]/;
const skillCharacter = /[A-Za-z0-9._-]/;
const fileCharacter = /[A-Za-z0-9._/\\-]/;

function isCharacter(value: string | undefined, pattern: RegExp): boolean {
  return value !== undefined && pattern.test(value);
}

function tokenEnd(text: string, start: number, pattern: RegExp): number {
  let end = start;
  while (isCharacter(text[end], pattern)) end += 1;
  return end;
}

function hasTokenBoundary(text: string, index: number): boolean {
  return index === 0 || openingBoundary.test(text[index - 1] ?? "");
}

function detectMentionQuery(text: string, caret: number, trigger: "$" | "@"): ComposerQuery | null {
  const pattern = trigger === "$" ? skillCharacter : fileCharacter;
  let start = caret - 1;
  while (start >= 0 && isCharacter(text[start], pattern)) start -= 1;

  if (text[start] !== trigger || !hasTokenBoundary(text, start)) return null;

  const firstCharacter = text[start + 1];
  if (trigger === "$" && firstCharacter !== undefined && /[0-9]/.test(firstCharacter)) return null;

  const end = tokenEnd(text, caret, pattern);
  return {
    kind: trigger === "$" ? "skill" : "file",
    start,
    end,
    query: text.slice(start + 1, caret),
  };
}

function detectCommandQuery(text: string, caret: number): ComposerQuery | null {
  const firstLineEnd = text.indexOf("\n");
  if (firstLineEnd >= 0 && caret > firstLineEnd) return null;

  const lineEnd = firstLineEnd < 0 ? text.length : firstLineEnd;
  let start = 0;
  while (start < lineEnd && /[ \t]/.test(text[start] ?? "")) start += 1;
  if (text[start] !== "/" || caret <= start) return null;

  const end = tokenEnd(text, start + 1, commandCharacter);
  if (caret > end) return null;
  if (caret < start + 1) return null;

  return { kind: "command", start, end, query: text.slice(start + 1, caret) };
}

export function detectComposerQuery(
  text: string,
  selectionStart: number,
  selectionEnd = selectionStart,
  options: ComposerQueryOptions = {},
): ComposerQuery | null {
  if (options.isComposing || selectionStart !== selectionEnd) return null;
  if (selectionStart < 0 || selectionStart > text.length) return null;

  const command = detectCommandQuery(text, selectionStart);
  if (command) return command;

  const skill = detectMentionQuery(text, selectionStart, "$");
  if (skill) return skill;

  return detectMentionQuery(text, selectionStart, "@");
}
