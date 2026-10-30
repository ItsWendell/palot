import { useLayoutEffect, useRef, useImperativeHandle } from "react";
import { EditorState, TextSelection } from "prosemirror-state";
import { Slice } from "prosemirror-model";
import { EditorView } from "prosemirror-view";
import { history, undo, redo } from "prosemirror-history";
import { keymap } from "prosemirror-keymap";
import { baseKeymap } from "prosemirror-commands";
import { applyComposerTextChange, normalizeComposerDraft } from "../lib/composer-draft";
import { isReviewComment } from "../lib/review-comments";
import { WORKSPACE_FILE_DRAG_TYPE } from "../lib/workspace-file-drag";
import {
  composerSchema,
  richDocument,
  readRichDocument,
  richOffset,
  richDecorations,
  richClipboardDraft,
} from "../lib/composer-rich-document";
import type { ComposerInputProps } from "./composer-input";
import "./composer-rich-input.css";

const CLIPBOARD_TYPE = "application/x-palot-composer-fragment";

export default function RichComposerInput(props: ComposerInputProps) {
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const latest = useRef(props);
  useLayoutEffect(() => {
    latest.current = props;
  });
  useImperativeHandle(
    props.ref,
    () => ({
      focus: () => viewRef.current?.focus(),
      get selectionStart() {
        const view = viewRef.current;
        return view ? richOffset(view.state.doc, view.state.selection.from) : 0;
      },
      get selectionEnd() {
        const view = viewRef.current;
        return view ? richOffset(view.state.doc, view.state.selection.to) : 0;
      },
      setSelectionRange: (start, end) => {
        const view = viewRef.current;
        if (!view) return;
        view.dispatch(
          view.state.tr
            .setSelection(
              TextSelection.create(
                view.state.doc,
                richOffset(view.state.doc, start, true),
                richOffset(view.state.doc, end, true),
              ),
            )
            .scrollIntoView(),
        );
      },
    }),
    [],
  );

  useLayoutEffect(() => {
    const view = new EditorView(host.current!, {
      state: EditorState.create({
        schema: composerSchema,
        doc: richDocument(latest.current.draft, latest.current.comments),
        plugins: [
          history(),
          keymap({ "Mod-z": undo, "Mod-Shift-z": redo, "Mod-y": redo }),
          keymap(baseKeymap),
        ],
      }),
      editable: () => !latest.current.disabled,
      decorations: (state) => richDecorations(state.doc),
      handleDOMEvents: {
        beforeinput(view, event) {
          const input = event as InputEvent;
          if (
            !input.isComposing &&
            input.inputType === "insertText" &&
            input.data?.includes("\n")
          ) {
            event.preventDefault();
            view.dispatch(view.state.tr.insertText(input.data).scrollIntoView());
            return true;
          }
          return false;
        },
      },
      dispatchTransaction(transaction) {
        view.updateState(view.state.apply(transaction));
        const callbacks = latest.current;
        if (transaction.docChanged) {
          const read = readRichDocument(view.state.doc);
          const draft = normalizeComposerDraft({
            ...applyComposerTextChange(callbacks.draft, read.text),
            mentions: read.mentions,
          });
          callbacks.onDraftChange(draft);
          if (JSON.stringify(read.comments) !== JSON.stringify(callbacks.comments))
            callbacks.onCommentsChange(read.comments);
        }
        callbacks.onSelectionChange({
          start: richOffset(view.state.doc, view.state.selection.from),
          end: richOffset(view.state.doc, view.state.selection.to),
        });
      },
      handleKeyDown(view, event) {
        if (event.isComposing || event.keyCode === 229) return false;
        if (event.key === "Enter") {
          view.dispatch(view.state.tr.insertText("\n").scrollIntoView());
          return true;
        }
        return false;
      },
      // The composer shell owns workspace-file drops, including connection validation.
      handleDrop: (_view, event) =>
        event.dataTransfer?.types.includes(WORKSPACE_FILE_DRAG_TYPE) ?? false,
      handlePaste(view, event) {
        const fragment = event.clipboardData?.getData(CLIPBOARD_TYPE);
        if (fragment && fragment.length <= 200_000) {
          try {
            const value = JSON.parse(fragment);
            const draft = richClipboardDraft(value.draft);
            if (draft && Array.isArray(value.comments) && value.comments.every(isReviewComment)) {
              draft.mentions = draft.mentions.map((mention) => ({
                ...mention,
                localID: crypto.randomUUID(),
              }));
              const document = richDocument(
                draft,
                value.comments.map((comment: import("../lib/review-comments").ReviewComment) => ({
                  ...comment,
                  id: crypto.randomUUID(),
                })),
              );
              view.dispatch(
                view.state.tr
                  .replaceSelection(new Slice(document.firstChild!.content, 0, 0))
                  .scrollIntoView(),
              );
              return true;
            }
          } catch {
            /* Ordinary text remains the safe clipboard fallback. */
          }
        }
        const text = event.clipboardData?.getData("text/plain");
        if (!text) return false;
        view.dispatch(view.state.tr.insertText(text).scrollIntoView());
        return true;
      },
      clipboardTextSerializer: (slice) => {
        let text = "";
        slice.content.descendants((node) => {
          if (node.isText) text += node.text;
          else if (node.type.name === "context") text += node.attrs.source;
        });
        return text;
      },
    });
    viewRef.current = view;
    return () => {
      viewRef.current = null;
      view.destroy();
    };
  }, []);

  useLayoutEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    // Do not rebuild the editor, history or composition DOM during controlled echoes.
    const document = richDocument(props.draft, props.comments);
    if (!view.composing && !document.eq(view.state.doc)) {
      const source = richOffset(view.state.doc, view.state.selection.from);
      const tr = view.state.tr.replaceWith(0, view.state.doc.content.size, document.content);
      tr.setSelection(
        TextSelection.create(
          tr.doc,
          richOffset(tr.doc, Math.min(source, props.draft.text.length), true),
        ),
      );
      view.updateState(view.state.apply(tr));
    }
    view.setProps({
      attributes: {
        class: `palot-rich-input ${props.className ?? ""}`,
        role: "textbox",
        "aria-multiline": "true",
        "aria-label": props["aria-label"] ?? "Message Palot",
        "aria-expanded": String(props["aria-expanded"] ?? false),
        ...(props["aria-controls"] ? { "aria-controls": props["aria-controls"] } : {}),
        ...(props["aria-activedescendant"]
          ? { "aria-activedescendant": props["aria-activedescendant"] }
          : {}),
        "aria-disabled": String(Boolean(props.disabled)),
        "data-placeholder": props.placeholder ?? "",
        "data-palot-composer-input": "",
        "data-slot": "input-group-control",
        spellcheck: "true",
      },
    });
  });

  return (
    <div
      ref={host}
      className="min-h-0 w-full"
      onKeyDownCapture={props.onKeyDown}
      onPasteCapture={props.onPaste}
      onCompositionStart={props.onCompositionStart}
      onCompositionEnd={props.onCompositionEnd}
      onCopyCapture={(event) => copySelection(event, false)}
      onCutCapture={(event) => copySelection(event, true)}
    />
  );

  function copySelection(event: React.ClipboardEvent, cut: boolean) {
    const view = viewRef.current;
    if (!view || view.state.selection.empty || (cut && props.disabled)) return;
    const { from, to } = view.state.selection;
    const read = readRichDocument(view.state.doc.cut(from, to));
    event.preventDefault();
    event.clipboardData.setData("text/plain", read.text);
    event.clipboardData.setData(
      CLIPBOARD_TYPE,
      JSON.stringify({
        draft: { text: read.text, mentions: read.mentions, command: null },
        comments: read.comments,
      }),
    );
    if (cut) view.dispatch(view.state.tr.deleteSelection().scrollIntoView());
  }
}
