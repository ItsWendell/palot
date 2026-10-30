/** A source-first document: Markdown is never normalized by a rich-text serializer. */
import { Schema, type Node as PMNode } from "prosemirror-model";
import { Decoration, DecorationSet } from "prosemirror-view";
import { normalizeComposerDraft, type ComposerDraft, type ComposerMention } from "./composer-draft";
import type { ReviewComment } from "./review-comments";

export const composerSchema = new Schema({
  nodes: {
    doc: { content: "paragraph" },
    paragraph: {
      content: "inline*",
      whitespace: "pre",
      toDOM: () => ["div", 0],
      parseDOM: [{ tag: "div" }],
    },
    text: { group: "inline" },
    context: {
      inline: true,
      group: "inline",
      atom: true,
      selectable: true,
      attrs: {
        source: { default: "" },
        label: { default: "" },
        kind: { default: "" },
        mention: { default: null },
        comment: { default: null },
      },
      toDOM: (node) => [
        "span",
        {
          "data-composer-chip": node.attrs.kind,
          role: "img",
          contenteditable: "false",
          title: node.attrs.source || node.attrs.comment?.comment,
          "aria-label": `${node.attrs.kind}: ${node.attrs.label}`,
          class:
            "mx-0.5 inline-block max-w-full truncate rounded-md border border-border bg-muted px-1 align-bottom text-compact text-foreground",
        },
        node.attrs.label,
      ],
    },
  },
});

/** Clipboard metadata is untrusted, even when it names this app's private MIME type. */
export function richClipboardDraft(value: unknown): ComposerDraft | null {
  if (!value || typeof value !== "object") return null;
  const draft = value as Partial<ComposerDraft>;
  if (
    typeof draft.text !== "string" ||
    draft.text.length > 100_000 ||
    !Array.isArray(draft.mentions) ||
    draft.mentions.length > 500
  )
    return null;
  if (
    !draft.mentions.every(
      (mention) =>
        mention &&
        typeof mention === "object" &&
        ["file", "task", "agent", "reference", "skill"].includes(mention.kind) &&
        typeof mention.localID === "string" &&
        typeof mention.value === "string" &&
        typeof mention.text === "string" &&
        Number.isSafeInteger(mention.start) &&
        Number.isSafeInteger(mention.end) &&
        (mention.path === undefined || typeof mention.path === "string") &&
        (mention.title === undefined || typeof mention.title === "string") &&
        (mention.attachmentText === undefined || typeof mention.attachmentText === "string"),
    )
  )
    return null;
  return normalizeComposerDraft({ text: draft.text, mentions: draft.mentions, command: null });
}

interface SourceChip {
  start: number;
  end: number;
  label: string;
  kind: string;
  mention?: ComposerMention;
  comment?: ReviewComment;
}

export function richSourceChips(draft: ComposerDraft): SourceChip[] {
  const chips: SourceChip[] = draft.mentions.map((mention) => ({
    ...mention,
    label: mention.kind === "task" ? (mention.title ?? mention.value) : mention.text,
    kind: mention.kind,
    mention,
  }));
  // Terminal quoting already has an exact, portable Markdown representation.
  for (const match of draft.text.matchAll(
    /^> Terminal output\n>\n> (`{3,})text\n[\s\S]*?\n> \1(?=\n|$)/gm,
  )) {
    chips.push({
      start: match.index,
      end: match.index + match[0].length,
      kind: "terminal",
      label: "Terminal output",
    });
  }
  for (const match of draft.text.matchAll(
    /https:\/\/github\.com\/[^\s/]+\/[^\s/]+\/pull\/(\d+)\b/g,
  )) {
    chips.push({
      start: match.index,
      end: match.index + match[0].length,
      kind: "pull request",
      label: `PR #${match[1]}`,
    });
  }
  const accepted: SourceChip[] = [];
  for (const chip of chips.sort((a, b) => a.start - b.start)) {
    if ((accepted.at(-1)?.end ?? 0) <= chip.start) accepted.push(chip);
  }
  return accepted;
}

export function richDocument(draft: ComposerDraft, comments: ReviewComment[] = []): PMNode {
  const nodes: PMNode[] = [];
  let end = 0;
  const chips = richSourceChips(draft);
  for (const comment of comments) {
    let at = Math.max(0, Math.min(comment.composerOffset ?? draft.text.length, draft.text.length));
    const inside = chips.find((chip) => chip.start < at && at < chip.end);
    if (inside) at = inside.end;
    chips.push({
      start: at,
      end: at,
      kind: "review comment",
      label: `${comment.path}:${comment.selection.startLine} · ${comment.comment}`,
      comment,
    });
  }
  for (const chip of chips.sort(
    (left, right) => left.start - right.start || left.end - right.end,
  )) {
    if (chip.start > end) nodes.push(composerSchema.text(draft.text.slice(end, chip.start)));
    nodes.push(
      composerSchema.nodes.context!.create({
        source: draft.text.slice(chip.start, chip.end),
        label: chip.label,
        kind: chip.kind,
        mention: chip.mention ? { ...chip.mention, start: 0, end: 0 } : null,
        comment: chip.comment ? { ...chip.comment, composerOffset: undefined } : null,
      }),
    );
    end = chip.end;
  }
  if (end < draft.text.length) nodes.push(composerSchema.text(draft.text.slice(end)));
  return composerSchema.nodes.doc!.create(
    null,
    composerSchema.nodes.paragraph!.create(null, nodes),
  );
}

export function readRichDocument(doc: PMNode) {
  let text = "";
  const mentions: ComposerMention[] = [];
  const comments: ReviewComment[] = [];
  doc.firstChild!.forEach((node) => {
    if (node.isText) {
      text += node.text;
      return;
    }
    const start = text.length;
    text += node.attrs.source;
    if (node.attrs.mention) mentions.push({ ...node.attrs.mention, start, end: text.length });
    if (node.attrs.comment) comments.push({ ...node.attrs.comment, composerOffset: text.length });
  });
  return { text, mentions, comments };
}

/** Source offsets and editor positions differ only at atomic chips. */
export function richOffset(doc: PMNode, position: number, reverse = false): number {
  let source = 0;
  let result = reverse ? doc.content.size - 1 : 0;
  let found = false;
  doc.firstChild!.forEach((node, offset) => {
    if (found) return;
    const length = node.isText ? node.nodeSize : node.attrs.source.length;
    const from = reverse ? source : offset + 1;
    const size = reverse ? length : node.nodeSize;
    if (position <= from + size) {
      const delta = Math.max(0, position - from);
      result =
        (reverse ? offset + 1 : source) +
        (node.isText ? delta : delta > 0 ? (reverse ? node.nodeSize : length) : 0);
      found = true;
    }
    source += length;
  });
  return result;
}

/** Bounded, synchronous source styling. No syntax highlighter, HTML parser or global store scans. */
export function richDecorations(doc: PMNode): DecorationSet {
  const decorations: Decoration[] = [];
  const add = (from: number, to: number, className: string) => {
    if (to > from) decorations.push(Decoration.inline(from, to, { class: className }));
  };
  doc.firstChild!.forEach((node, offset) => {
    if (!node.isText || !node.text || node.text.length > 32_768) return;
    const text = node.text;
    const base = offset + 1;
    const code: { start: number; end: number }[] = [];
    for (const match of text.matchAll(
      /^(`{3,}|~{3,})([^\n]*)\n[\s\S]*?(?:^\1[ \t]*$|(?![\s\S]))/gm,
    )) {
      code.push({ start: match.index, end: match.index + match[0].length });
      add(
        base + match.index,
        base + match.index + match[0].length,
        "font-mono text-code text-muted-foreground bg-muted/50",
      );
    }
    for (const [pattern, className] of [
      [/\*\*[^\n]+?\*\*|__[^\n]+?__/g, "font-semibold"],
      [/(?<!\*)\*[^*\n]+\*(?!\*)|(?<!_)_[^_\n]+_(?!_)/g, "italic"],
      [/`[^`\n]+`/g, "font-mono text-code bg-muted"],
      [/^#{1,6} .+$/gm, "font-semibold text-foreground"],
      [/^>.*$/gm, "text-muted-foreground italic"],
      [/^[ \t]*(?:[-*+] |\d+\. ).*$/gm, "text-foreground"],
    ] as const) {
      for (const match of text.matchAll(pattern)) {
        if (!code.some((range) => match.index >= range.start && match.index < range.end))
          add(base + match.index, base + match.index + match[0].length, className);
      }
    }
  });
  return DecorationSet.create(doc, decorations);
}
