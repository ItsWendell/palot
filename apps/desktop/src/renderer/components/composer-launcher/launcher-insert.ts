/**
 * Where a picked launcher item lands in the draft. A typed trigger's range is replaced, as the
 * old suggestion list did; a pick from `+` goes in at the caret the set-aside draft had, and a
 * command goes to the draft's start, where a slash command must be. All of it goes through
 * `insertComposerSelection`, so chips are built one way.
 */

import type { PalotCommand } from "../../../shared";
import {
  applyComposerTextEdit,
  insertComposerSelection,
  normalizeComposerDraft,
  type ComposerDiscoverySelection,
  type ComposerDraft,
  type ComposerInsertion,
} from "../../lib/composer-draft";
import type { ComposerQuery } from "../../lib/composer-query";
import type { LauncherMention } from "./launcher-items";
import type { LauncherTrigger, LauncherTriggerChar } from "./launcher-state";

const QUERY_TRIGGER: Record<ComposerQuery["kind"], LauncherTriggerChar> = {
  command: "/",
  skill: "$",
  file: "@",
};

const TRIGGER_QUERY: Record<LauncherTriggerChar, ComposerQuery["kind"]> = {
  "/": "command",
  $: "skill",
  "@": "file",
};

/**
 * The launcher's `trigger` event for the editor's detected query. `/` that continues into a
 * folder no command lives in (`//`, `/home/me`) is a path, not a trigger.
 */
export function launcherTrigger(
  query: ComposerQuery | null,
  commands: readonly Pick<PalotCommand, "name">[],
): (LauncherTrigger & { query: string }) | null {
  if (!query) return null;
  if (query.kind === "command" && query.query.includes("/")) {
    const folder = query.query.slice(0, query.query.lastIndexOf("/") + 1).toLowerCase();
    if (!commands.some((command) => command.name.toLowerCase().startsWith(folder))) return null;
  }
  return {
    char: QUERY_TRIGGER[query.kind],
    from: query.start,
    to: query.start + 1 + query.query.length,
    query: query.query,
  };
}

/** The range a typed trigger covers now: the detected token when it still starts there. */
export function triggerQuery(trigger: LauncherTrigger, fresh: ComposerQuery | null): ComposerQuery {
  const kind = TRIGGER_QUERY[trigger.char];
  if (fresh && fresh.kind === kind && fresh.start === trigger.from) return fresh;
  return { kind, start: trigger.from, end: trigger.to, query: "" };
}

export function mentionSelection(
  mention: LauncherMention,
  localID: string,
): Exclude<ComposerDiscoverySelection, { kind: "command" }> {
  switch (mention.kind) {
    case "file":
      return mention.origin
        ? { kind: "file", path: mention.path, localID, origin: mention.origin }
        : { kind: "file", path: mention.path, localID };
    case "agent":
      return { kind: "agent", name: mention.name, localID };
    case "task":
      return { kind: "task", id: mention.id, title: mention.title, localID };
    case "reference":
      return { kind: "reference", name: mention.name, path: mention.path, localID };
    case "skill":
      return { kind: "skill", id: mention.id, localID };
  }
}

/** Replaces a typed trigger with the pick; null when the pick does not fit that trigger. */
export function replaceTrigger(
  draft: ComposerDraft,
  query: ComposerQuery,
  selection: ComposerDiscoverySelection,
): ComposerInsertion | null {
  try {
    return insertComposerSelection(draft, query, selection);
  } catch {
    return null;
  }
}

/**
 * Inserts a mention at `caret`, outside any chip or command token, with a space before it
 * when it would otherwise touch the previous word.
 */
export function insertMentionAt(
  draft: ComposerDraft,
  caret: number,
  selection: Exclude<ComposerDiscoverySelection, { kind: "command" }>,
): ComposerInsertion {
  const normalized = normalizeComposerDraft(draft);
  const { text } = normalized;
  let at = Math.max(0, Math.min(Number.isInteger(caret) ? caret : text.length, text.length));
  const inside = normalized.mentions.find((mention) => mention.start < at && at < mention.end);
  if (inside) at = inside.end;
  if (normalized.command && at < normalized.command.end) at = normalized.command.end;
  const before = at > 0 && !/\s/.test(text[at - 1] ?? "") ? " " : "";
  const trigger = selection.kind === "skill" ? "$" : "@";
  const withTrigger = applyComposerTextEdit(normalized, {
    start: at,
    end: at,
    text: `${before}${trigger}`,
  });
  const start = at + before.length;
  return insertComposerSelection(
    withTrigger,
    { kind: selection.kind === "skill" ? "skill" : "file", start, end: start + 1, query: "" },
    selection,
  );
}

/**
 * Puts `/name` at the draft's start, replacing a command already there; the rest of the draft
 * becomes its arguments. The caret lands after the command.
 */
export function insertCommandAtStart(draft: ComposerDraft, name: string): ComposerInsertion {
  const normalized = normalizeComposerDraft(draft);
  const selection = { kind: "command", name } as const;
  if (normalized.command) {
    const { start, end } = normalized.command;
    return insertComposerSelection(
      normalized,
      { kind: "command", start, end, query: "" },
      selection,
    );
  }
  const lead = /^[ \t]*/.exec(normalized.text)?.[0].length ?? 0;
  const withSlash = applyComposerTextEdit(normalized, { start: lead, end: lead, text: "/" });
  return insertComposerSelection(
    withSlash,
    { kind: "command", start: lead, end: lead + 1, query: "" },
    selection,
  );
}
