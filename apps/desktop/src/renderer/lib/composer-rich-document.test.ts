import { describe, expect, it } from "vitest";
import { EditorState, TextSelection } from "prosemirror-state";
import { history, undo, redo } from "prosemirror-history";
import {
  applyComposerTextChange,
  emptyComposerDraft,
  insertComposerFileMention,
  insertComposerSelection,
  projectComposerSubmission,
} from "./composer-draft";
import {
  composerSchema,
  readRichDocument,
  richDecorations,
  richDocument,
  richOffset,
  richClipboardDraft,
} from "./composer-rich-document";
import { terminalQuote } from "../components/workbench-tabs/terminal-quote";

describe("rich source document", () => {
  it("retains every discovery chip's prompt meaning through a rich document and clipboard", () => {
    let draft = emptyComposerDraft();
    for (const selection of [
      { kind: "file", path: "a.ts", localID: "f" },
      { kind: "skill", id: "review", localID: "s" },
      { kind: "agent", name: "helper", localID: "a" },
      { kind: "reference", name: "source", path: "/reference", localID: "r" },
      { kind: "task", id: "ses_0123456789abcdefghijklmnop", title: "Previous task", localID: "t" },
    ] as const) {
      const start = draft.text.length;
      const kind = selection.kind === "skill" ? "skill" : "file";
      draft = applyComposerTextChange(draft, draft.text + (kind === "skill" ? "$" : "@"));
      draft = insertComposerSelection(
        draft,
        { kind, start, end: draft.text.length, query: "" },
        selection,
      ).draft;
    }
    const read = readRichDocument(richDocument(draft));
    const pasted = richClipboardDraft({ ...read, command: null })!;
    expect(pasted.mentions.map(({ kind }) => kind)).toEqual([
      "file",
      "skill",
      "agent",
      "reference",
      "task",
    ]);
    expect(projectComposerSubmission(pasted)).toEqual(projectComposerSubmission(draft));
  });
  it("validates clipboard metadata and preserves agent and directory prompt parts", () => {
    const draft = {
      text: "@helper @source",
      command: null,
      mentions: [
        { kind: "agent", localID: "a", value: "helper", text: "@helper", start: 0, end: 7 },
        {
          kind: "reference",
          localID: "r",
          value: "source",
          path: "/reference",
          text: "@source",
          start: 8,
          end: 15,
        },
      ],
    };
    const copied = richClipboardDraft(draft)!;
    expect(projectComposerSubmission(copied)).toMatchObject({
      agents: [{ name: "helper" }],
      references: [{ path: "/reference" }],
    });
    expect(
      richClipboardDraft({ ...draft, mentions: [{ ...draft.mentions[0], path: {} }] }),
    ).toBeNull();
    expect(richClipboardDraft(null)).toBeNull();
  });
  it("preserves exact Markdown, file mention offsets, terminal context and PR URLs", () => {
    const original = applyComposerTextChange(
      emptyComposerDraft(),
      `# Title\n**bold** _italic_ \`code\`\n- list\n> quote\n\`\`\`ts\nconst a = 1\n\`\`\`\n${terminalQuote("stderr\n  exact whitespace")!}https://github.com/acme/repo/pull/42\n`,
    );
    const draft = insertComposerFileMention(
      original,
      original.text.length,
      "src/a.ts",
      "file-1",
    ).draft;
    const doc = richDocument(draft);
    const roundtrip = readRichDocument(doc);
    expect(roundtrip.text).toBe(draft.text);
    expect(
      projectComposerSubmission({ ...draft, text: roundtrip.text, mentions: roundtrip.mentions }),
    ).toEqual(projectComposerSubmission(draft));
    expect(
      doc
        .firstChild!.content.content.filter((node) => node.type.name === "context")
        .map((node) => node.attrs.kind),
    ).toEqual(["terminal", "pull request", "file"]);
    expect(richDecorations(doc).find().length).toBeGreaterThan(4);
    for (const mention of draft.mentions) {
      expect(richOffset(doc, richOffset(doc, mention.start, true))).toBe(mention.start);
      expect(richOffset(doc, richOffset(doc, mention.end, true))).toBe(mention.end);
    }
  });

  it("undoes and redoes atomic mention deletion without losing its prompt part", () => {
    const draft = insertComposerFileMention(emptyComposerDraft(), 0, "src/a.ts", "file-1").draft;
    let state = EditorState.create({
      schema: composerSchema,
      doc: richDocument(draft),
      plugins: [history()],
    });
    const dispatch = (transaction: Parameters<typeof state.apply>[0]) => {
      state = state.apply(transaction);
    };
    dispatch(state.tr.setSelection(TextSelection.create(state.doc, 1, 2)).deleteSelection());
    expect(readRichDocument(state.doc).mentions).toEqual([]);
    expect(undo(state, dispatch)).toBe(true);
    expect(readRichDocument(state.doc).mentions).toEqual(draft.mentions);
    expect(redo(state, dispatch)).toBe(true);
    expect(readRichDocument(state.doc).text).toBe(" ");
  });

  it("keeps review context out of Markdown and restores it with editor undo", () => {
    const draft = applyComposerTextChange(emptyComposerDraft(), "Check this");
    const comment = {
      id: "c1",
      path: "a.ts",
      comment: "why?",
      selection: { startLine: 1, endLine: 1, startChar: 0, endChar: 0 },
    };
    const doc = richDocument(draft, [comment]);
    expect(readRichDocument(doc)).toMatchObject({ text: "Check this", comments: [comment] });
    let state = EditorState.create({ schema: composerSchema, doc, plugins: [history()] });
    const dispatch = (transaction: Parameters<typeof state.apply>[0]) => {
      state = state.apply(transaction);
    };
    dispatch(state.tr.delete(doc.content.size - 2, doc.content.size - 1));
    expect(readRichDocument(state.doc).comments).toEqual([]);
    expect(undo(state, dispatch)).toBe(true);
    expect(readRichDocument(state.doc).comments).toMatchObject([comment]);
  });
  it("retains a review chip's position between words without changing submission text", () => {
    const draft = applyComposerTextChange(emptyComposerDraft(), "before after");
    const comment = {
      id: "c1",
      path: "a.ts",
      comment: "why?",
      composerOffset: 7,
      selection: { startLine: 1, endLine: 1, startChar: 0, endChar: 0 },
    };
    const doc = richDocument(draft, [comment]);
    const read = readRichDocument(doc);
    expect(read.text).toBe(draft.text);
    expect(read.comments).toEqual([comment]);
    expect(
      richDocument({ ...draft, text: read.text, mentions: read.mentions }, read.comments).eq(doc),
    ).toBe(true);
  });
  it("keeps mention node identities stable when typing before a chip", () => {
    const draft = insertComposerFileMention(emptyComposerDraft(), 0, "a.ts", "file").draft;
    const state = EditorState.create({ schema: composerSchema, doc: richDocument(draft) });
    const next = state.apply(state.tr.insertText("before ", 1));
    const read = readRichDocument(next.doc);
    expect(richDocument({ ...draft, text: read.text, mentions: read.mentions }).eq(next.doc)).toBe(
      true,
    );
  });
});
