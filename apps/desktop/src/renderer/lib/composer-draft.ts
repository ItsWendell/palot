import type { ComposerQuery } from "./composer-query";

export interface ComposerMention {
  localID: string;
  kind: "file" | "skill";
  value: string;
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
  | { kind: "file"; path: string; localID: string };

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

interface ComposerSubmissionBase {
  text: string;
  files: ComposerProjectedFileReference[];
  skills: ComposerProjectedSkillReference[];
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
        mention.text === `${mention.kind === "file" ? "@" : "$"}${mention.value}`
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
  if (query.kind !== selection.kind)
    throw new TypeError("Composer query and selection kinds differ.");
  if (query.start < 0 || query.end > draft.text.length || query.start >= query.end) {
    throw new RangeError("Composer query is outside the draft text.");
  }

  const value =
    selection.kind === "command"
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
        },
      ],
    });
  }

  const caret = query.start + replacement.length;
  return { draft: next, selectionStart: caret, selectionEnd: caret };
}

function basename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

export function projectComposerSubmission(draft: ComposerDraft): ComposerSubmission {
  const normalized = normalizeComposerDraft(draft);
  const files: ComposerProjectedFileReference[] = [];
  const skills: ComposerProjectedSkillReference[] = [];

  for (const mention of normalized.mentions) {
    const projected = { start: mention.start, end: mention.end, text: mention.text };
    if (mention.kind === "file") {
      files.push({ path: mention.value, name: basename(mention.value), mention: projected });
    } else {
      skills.push({
        id: mention.value,
        mention: projected,
        ...(mention.attachmentText ? { text: mention.attachmentText } : {}),
      });
    }
  }

  const base = { text: normalized.text, files, skills };
  if (!normalized.command) return { kind: "prompt", ...base };

  const rawArguments = normalized.text.slice(normalized.command.end).replace(/^[ \t]+/, "");
  const commandText = `/${normalized.command.name}${rawArguments ? ` ${rawArguments}` : ""}`;
  const offset = normalized.command.start;
  const commandFiles = files.map((file) => ({
    ...file,
    mention: {
      ...file.mention,
      start: file.mention.start - offset,
      end: file.mention.end - offset,
    },
  }));
  const commandSkills = skills.map((skill) => ({
    ...skill,
    mention: {
      ...skill.mention,
      start: skill.mention.start - offset,
      end: skill.mention.end - offset,
    },
  }));
  return {
    kind: "command",
    text: commandText,
    files: commandFiles,
    skills: commandSkills,
    command: normalized.command.name,
    ...(rawArguments ? { arguments: rawArguments } : {}),
  };
}
