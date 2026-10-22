import type { ComposerQuery } from "./composer-query";

export type ComposerMentionKind = "file" | "skill" | "agent" | "reference";

export interface ComposerMention {
  localID: string;
  kind: ComposerMentionKind;
  value: string;
  /** Absolute directory of a reference mention; its value is the reference name. */
  path?: string;
  text: string;
  start: number;
  end: number;
  attachmentText?: string;
}

export interface ComposerCommandSelection {
  name: string;
  start: number;
  end: number;
}

export interface ComposerDraft {
  text: string;
  mentions: ComposerMention[];
  command: ComposerCommandSelection | null;
}

export interface ComposerTextEdit {
  start: number;
  end: number;
  text: string;
}

export type ComposerDiscoverySelection =
  | { kind: "command"; name: string }
  | { kind: "skill"; id: string; localID: string }
  | { kind: "file"; path: string; localID: string }
  | { kind: "agent"; name: string; localID: string }
  | { kind: "reference"; name: string; path: string; localID: string };

export interface ComposerInsertion {
  draft: ComposerDraft;
  selectionStart: number;
  selectionEnd: number;
}

export interface ComposerProjectedMention {
  start: number;
  end: number;
  text: string;
}

export interface ComposerProjectedFileReference {
  path: string;
  name: string;
  mention: ComposerProjectedMention;
}

export interface ComposerProjectedSkillReference {
  id: string;
  mention: ComposerProjectedMention;
  text?: string;
}

/** A subagent mention, sent as an OpenCode prompt agent part. */
export interface ComposerProjectedAgentReference {
  name: string;
  mention: ComposerProjectedMention;
}

/** An OpenCode reference mention, sent as a directory file part for its absolute path. */
export interface ComposerProjectedDirectoryReference {
  name: string;
  path: string;
  mention: ComposerProjectedMention;
}

interface ComposerSubmissionBase {
  text: string;
  files: ComposerProjectedFileReference[];
  skills: ComposerProjectedSkillReference[];
  agents: ComposerProjectedAgentReference[];
  references: ComposerProjectedDirectoryReference[];
}

export type ComposerSubmission =
  | (ComposerSubmissionBase & { kind: "prompt" })
  | (ComposerSubmissionBase & { kind: "command"; command: string; arguments?: string });

export const emptyComposerDraft = (): ComposerDraft => ({ text: "", mentions: [], command: null });

function validRange(start: number, end: number, length: number): boolean {
  return (
    Number.isInteger(start) && Number.isInteger(end) && start >= 0 && start < end && end <= length
  );
}

function isValidCommand(text: string, command: ComposerCommandSelection): boolean {
  if (!validRange(command.start, command.end, text.length)) return false;
  if (text.slice(command.start, command.end) !== `/${command.name}`) return false;
  if (!/^[ \t]*$/.test(text.slice(0, command.start))) return false;
  const next = text[command.end];
  return next === undefined || /\s/.test(next);
}

export function normalizeComposerDraft(draft: ComposerDraft): ComposerDraft {
  const candidates = [...draft.mentions]
    .sort((left, right) => left.start - right.start || left.end - right.end)
    .filter((mention) => {
      return (
        validRange(mention.start, mention.end, draft.text.length) &&
        draft.text.slice(mention.start, mention.end) === mention.text &&
        mention.text === `${mention.kind === "skill" ? "$" : "@"}${mention.value}` &&
        (mention.kind !== "reference" || Boolean(mention.path))
      );
    });
  const mentions: ComposerMention[] = [];
  for (const mention of candidates) {
    if ((mentions.at(-1)?.end ?? 0) <= mention.start) mentions.push(mention);
  }

  return {
    text: draft.text,
    mentions,
    command: draft.command && isValidCommand(draft.text, draft.command) ? draft.command : null,
  };
}

function transformRange(
  range: { start: number; end: number },
  edit: ComposerTextEdit,
  delta: number,
): { start: number; end: number } | null {
  if (edit.end <= range.start) return { start: range.start + delta, end: range.end + delta };
  if (edit.start >= range.end) return range;
  return null;
}

export function applyComposerTextEdit(draft: ComposerDraft, edit: ComposerTextEdit): ComposerDraft {
  if (
    !Number.isInteger(edit.start) ||
    !Number.isInteger(edit.end) ||
    edit.start < 0 ||
    edit.end < edit.start ||
    edit.end > draft.text.length
  ) {
    throw new RangeError("Composer edit is outside the draft text.");
  }

  const text = draft.text.slice(0, edit.start) + edit.text + draft.text.slice(edit.end);
  const delta = edit.text.length - (edit.end - edit.start);
  const mentions = draft.mentions.flatMap((mention) => {
    const range = transformRange(mention, edit, delta);
    return range ? [{ ...mention, ...range }] : [];
  });
  const commandRange = draft.command ? transformRange(draft.command, edit, delta) : null;

  return normalizeComposerDraft({
    text,
    mentions,
    command: draft.command && commandRange ? { ...draft.command, ...commandRange } : null,
  });
}

export function deriveComposerTextEdit(previousText: string, nextText: string): ComposerTextEdit {
  let start = 0;
  const sharedLength = Math.min(previousText.length, nextText.length);
  while (start < sharedLength && previousText[start] === nextText[start]) start += 1;

  let previousEnd = previousText.length;
  let nextEnd = nextText.length;
  while (
    previousEnd > start &&
    nextEnd > start &&
    previousText[previousEnd - 1] === nextText[nextEnd - 1]
  ) {
    previousEnd -= 1;
    nextEnd -= 1;
  }

  return { start, end: previousEnd, text: nextText.slice(start, nextEnd) };
}

export function applyComposerTextChange(draft: ComposerDraft, nextText: string): ComposerDraft {
  return applyComposerTextEdit(draft, deriveComposerTextEdit(draft.text, nextText));
}

function replacementWithSeparator(text: string, end: number, replacement: string): string {
  return /\s/.test(text[end] ?? "") ? replacement : `${replacement} `;
}

export function insertComposerSelection(
  draft: ComposerDraft,
  query: ComposerQuery,
  selection: ComposerDiscoverySelection,
): ComposerInsertion {
  // `@` queries choose files, subagents, and references alike.
  const selectionQueryKind =
    selection.kind === "agent" || selection.kind === "reference" ? "file" : selection.kind;
  if (query.kind !== selectionQueryKind)
    throw new TypeError("Composer query and selection kinds differ.");
  if (query.start < 0 || query.end > draft.text.length || query.start >= query.end) {
    throw new RangeError("Composer query is outside the draft text.");
  }

  const value =
    selection.kind === "command" || selection.kind === "agent" || selection.kind === "reference"
      ? selection.name
      : selection.kind === "skill"
        ? selection.id
        : selection.path;
  const displayText = `${selection.kind === "command" ? "/" : selection.kind === "skill" ? "$" : "@"}${value}`;
  const replacement = replacementWithSeparator(draft.text, query.end, displayText);
  let next = applyComposerTextEdit(draft, {
    start: query.start,
    end: query.end,
    text: replacement,
  });

  if (selection.kind === "command") {
    next = normalizeComposerDraft({
      ...next,
      command: { name: selection.name, start: query.start, end: query.start + displayText.length },
    });
  } else {
    next = normalizeComposerDraft({
      ...next,
      mentions: [
        ...next.mentions,
        {
          localID: selection.localID,
          kind: selection.kind,
          value,
          text: displayText,
          start: query.start,
          end: query.start + displayText.length,
          ...(selection.kind === "reference" ? { path: selection.path } : {}),
        },
      ],
    });
  }

  const caret = query.start + replacement.length;
  return { draft: next, selectionStart: caret, selectionEnd: caret };
}

/**
 * Inserts a workspace file mention at the caret (outside any `@` query), separated from
 * neighbouring text by spaces. Inside an existing mention, it goes after that mention.
 */
export function insertComposerFileMention(
  draft: ComposerDraft,
  caret: number,
  path: string,
  localID: string,
): ComposerInsertion {
  const normalized = normalizeComposerDraft(draft);
  let at = Math.max(
    0,
    Math.min(Number.isInteger(caret) ? caret : normalized.text.length, normalized.text.length),
  );
  const inside = normalized.mentions.find((mention) => mention.start < at && at < mention.end);
  if (inside) at = inside.end;
  const displayText = `@${path}`;
  const before = at > 0 && !/\s/.test(normalized.text[at - 1] ?? "") ? " " : "";
  const after = replacementWithSeparator(normalized.text, at, "");
  const next = applyComposerTextEdit(normalized, {
    start: at,
    end: at,
    text: `${before}${displayText}${after}`,
  });
  const start = at + before.length;
  const inserted = normalizeComposerDraft({
    ...next,
    mentions: [
      ...next.mentions,
      {
        localID,
        kind: "file",
        value: path,
        text: displayText,
        start,
        end: start + displayText.length,
      },
    ],
  });
  const end = start + displayText.length + after.length;
  return { draft: inserted, selectionStart: end, selectionEnd: end };
}

/** Removes one resolved mention and the single space that separated it from what followed. */
export function removeComposerMention(
  draft: ComposerDraft,
  localID: string,
): ComposerInsertion | null {
  const normalized = normalizeComposerDraft(draft);
  const mention = normalized.mentions.find((item) => item.localID === localID);
  if (!mention) return null;
  const trailing = normalized.text[mention.end] === " " ? 1 : 0;
  const leading =
    !trailing && mention.start > 0 && normalized.text[mention.start - 1] === " " ? 1 : 0;
  const start = mention.start - leading;
  const next = applyComposerTextEdit(normalized, {
    start,
    end: mention.end + trailing,
    text: "",
  });
  return { draft: next, selectionStart: start, selectionEnd: start };
}

function basename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

export function projectComposerSubmission(draft: ComposerDraft): ComposerSubmission {
  const normalized = normalizeComposerDraft(draft);
  const files: ComposerProjectedFileReference[] = [];
  const skills: ComposerProjectedSkillReference[] = [];
  const agents: ComposerProjectedAgentReference[] = [];
  const references: ComposerProjectedDirectoryReference[] = [];

  for (const mention of normalized.mentions) {
    const projected = { start: mention.start, end: mention.end, text: mention.text };
    if (mention.kind === "file") {
      files.push({ path: mention.value, name: basename(mention.value), mention: projected });
    } else if (mention.kind === "agent") {
      agents.push({ name: mention.value, mention: projected });
    } else if (mention.kind === "reference") {
      references.push({ name: mention.value, path: mention.path ?? "", mention: projected });
    } else {
      skills.push({
        id: mention.value,
        mention: projected,
        ...(mention.attachmentText ? { text: mention.attachmentText } : {}),
      });
    }
  }

  const base = { text: normalized.text, files, skills, agents, references };
  if (!normalized.command) return { kind: "prompt", ...base };

  const rawArguments = normalized.text.slice(normalized.command.end).replace(/^[ \t]+/, "");
  const commandText = `/${normalized.command.name}${rawArguments ? ` ${rawArguments}` : ""}`;
  const offset = normalized.command.start;
  const shift = <T extends { mention: ComposerProjectedMention }>(part: T): T => ({
    ...part,
    mention: {
      ...part.mention,
      start: part.mention.start - offset,
      end: part.mention.end - offset,
    },
  });
  return {
    kind: "command",
    text: commandText,
    files: files.map(shift),
    skills: skills.map(shift),
    agents: agents.map(shift),
    references: references.map(shift),
    command: normalized.command.name,
    ...(rawArguments ? { arguments: rawArguments } : {}),
  };
}
