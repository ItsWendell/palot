import type { LocationRef } from "@opencode/client";
import { useAtomValue, useStore } from "jotai";
import { MessageCircleQuestion } from "lucide-react";
import { useEffect, useEffectEvent, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { askAboutSelection } from "../atoms/btw";
import { workbenchStateAtom } from "../atoms/workbench";
import { runtimeAtom } from "../atoms/workspace";
import { btwQuoteText } from "../lib/btw";
import {
  captureResponseQuoteSource,
  highlightResponseQuote,
  sameResponseQuoteSource,
  type ResponseQuoteSource,
} from "../lib/response-quote-highlight";
import { showErrorToast } from "../lib/toast-error";
import type { TranscriptProjectionRow } from "../lib/turn-projection";
import { workbenchScopeKey, type BtwQuote, type WorkbenchScope } from "../lib/workbench-tabs";
import { Button } from "./ui/button";

const RESPONSE = "data-palot-response-message";
const ACTION = "data-palot-selection-ask";

/** Marks one assistant response as a source for "Ask about selection" and a jump anchor. */
export function responseSelectionSource(messageID: string) {
  return { [RESPONSE]: messageID };
}

export function responseAnchorSelector(messageID: string): string {
  return `[${RESPONSE}="${CSS.escape(messageID)}"]`;
}

/** Index of the projected row that shows `messageID` as its response, or -1. */
export function responseRowIndex(
  rows: readonly TranscriptProjectionRow[],
  messageID: string,
): number {
  return rows.findIndex(({ turn }) => turn.final?.message.id === messageID);
}

/**
 * The prompt a response answered. Chronological projection puts prompts and replies
 * in separate rows, so this is the nearest user message at or before the response.
 */
export function responsePromptID(
  rows: readonly TranscriptProjectionRow[],
  messageID: string,
): string | undefined {
  for (let index = responseRowIndex(rows, messageID); index >= 0; index--) {
    const user = rows[index]!.turn.user;
    if (user) return user.id;
  }
  return undefined;
}

type Anchor = { top: number; left: number };
export type ResponseSelection =
  | {
      kind: "quote";
      element: HTMLElement;
      quote: BtwQuote;
      anchor: Anchor;
      source: ResponseQuoteSource;
    }
  /** The selection leaves its response; asking about it would be ambiguous. */
  | { kind: "outside"; element: HTMLElement; anchor: Anchor };

/** Reads the document selection when it touches a response inside `root`. */
export function readResponseSelection(
  selection: Selection | null,
  root: HTMLElement | null,
): ResponseSelection | null {
  if (!root || !selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  const responseOf = (node: Node) => {
    const element = (node instanceof Element ? node : node.parentElement)?.closest<HTMLElement>(
      `[${RESPONSE}]`,
    );
    return element && root.contains(element) ? element : null;
  };
  const start = responseOf(range.startContainer);
  const end = responseOf(range.endContainer);
  const element = start ?? end;
  if (!element) return null;
  const anchor = anchorFor(range, element);
  if (start !== end) return { kind: "outside", element, anchor };
  const quote = btwQuoteText(selection.toString());
  const messageID = element.getAttribute(RESPONSE);
  if (!quote || !messageID) return null;
  return {
    kind: "quote",
    element,
    anchor,
    source: captureResponseQuoteSource(element, range),
    quote: {
      text: quote.text,
      ...(quote.truncated ? { truncated: true } : {}),
      messageID,
    },
  };
}

const ACTION_HALF_WIDTH = 84;

/** Places the action under the selection's last line, kept inside the response. */
function anchorFor(range: Range, element: HTMLElement): Anchor {
  const box = element.getBoundingClientRect();
  const rects =
    typeof range.getClientRects === "function"
      ? Array.from(range.getClientRects()).filter(
          (rect) =>
            (rect.width > 0 || rect.height > 0) &&
            rect.top >= box.top - 1 &&
            rect.bottom <= box.bottom + 1,
        )
      : [];
  const last = rects.at(-1);
  const x = last ? last.right - box.left : 0;
  const maxLeft = Math.max(ACTION_HALF_WIDTH, box.width - ACTION_HALF_WIDTH);
  return {
    top: Math.round(last ? last.bottom - box.top + 4 : box.height),
    left: Math.round(Math.min(Math.max(x, ACTION_HALF_WIDTH), maxLeft)),
  };
}

function sameSelection(left: ResponseSelection | null, right: ResponseSelection | null) {
  if (left === right) return true;
  if (!left || !right) return false;
  return (
    left.kind === right.kind &&
    left.element === right.element &&
    left.anchor.top === right.anchor.top &&
    left.anchor.left === right.anchor.left &&
    (left.kind !== "quote" ||
      (right.kind === "quote" && sameResponseQuoteSource(left.source, right.source)))
  );
}

/**
 * Offers "Ask about selection" for text selected in one assistant response. It opens a
 * tool-free side question with the quote; the main composer and transcript stay as they are.
 */
export function ResponseSelectionAsk({
  rootRef,
  rows,
  sessionID,
  location,
}: {
  rootRef: RefObject<HTMLElement | null>;
  /** The transcript's projected rows, used to find the prompt a response answered. */
  rows: readonly TranscriptProjectionRow[];
  sessionID: string;
  location: LocationRef;
}) {
  const store = useStore();
  const runtime = useAtomValue(runtimeAtom);
  const workbench = useAtomValue(workbenchStateAtom);
  const [target, setTarget] = useState<ResponseSelection | null>(null);
  const [pending, setPending] = useState<{
    source: ResponseQuoteSource;
    tabID: string;
    scope: WorkbenchScope;
  } | null>(null);
  const dragging = useRef(false);
  const frame = useRef(0);

  const context = pending && workbench.scopes[workbenchScopeKey(pending.scope)];
  const pane =
    context &&
    [context.right, context.bottom].find((item) =>
      item.tabs.some((tab) => tab.id === pending?.tabID),
    );
  const tab = pane?.tabs.find((item) => item.id === pending?.tabID);
  const firstComment = tab?.kind === "btw" && !tab.resource.question;
  const editorOpen = firstComment && pane?.requestedOpen && pane.activeTabID === tab.id;
  useEffect(() => {
    if (!pending) return;
    if (!firstComment || pending.scope.sessionID !== sessionID) {
      setPending(null);
      return;
    }
    const root = rootRef.current;
    if (!editorOpen || !root) return;
    return highlightResponseQuote(root, pending.source, () => setPending(null));
  }, [pending, firstComment, editorOpen, rootRef, sessionID]);

  const read = useEffectEvent(() => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      if (dragging.current) return;
      const next = readResponseSelection(document.getSelection(), rootRef.current);
      setTarget((current) => (sameSelection(current, next) ? current : next));
    });
  });

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      if (event.target instanceof Element && event.target.closest(`[${ACTION}]`)) return;
      dragging.current = true;
    };
    const onPointerUp = () => {
      if (!dragging.current) return;
      dragging.current = false;
      read();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setTarget(null);
    };
    const onSelectionChange = () => read();
    document.addEventListener("selectionchange", onSelectionChange);
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("pointerup", onPointerUp, true);
    document.addEventListener("pointercancel", onPointerUp, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      cancelAnimationFrame(frame.current);
      document.removeEventListener("selectionchange", onSelectionChange);
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("pointerup", onPointerUp, true);
      document.removeEventListener("pointercancel", onPointerUp, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  // A streaming response re-renders under the selection; re-read what is selected now.
  const element = target?.element;
  useEffect(() => {
    if (!element) return;
    const observer = new MutationObserver((records) => {
      const own = element.querySelector(`[${ACTION}]`);
      if (records.every((record) => own?.contains(record.target))) return;
      read();
    });
    observer.observe(element, { subtree: true, childList: true, characterData: true });
    return () => observer.disconnect();
  }, [element]);

  if (!target || !target.element.isConnected) return null;

  const ask = () => {
    const fresh = readResponseSelection(document.getSelection(), rootRef.current);
    if (
      target.kind !== "quote" ||
      fresh?.kind !== "quote" ||
      fresh.element !== target.element ||
      !sameResponseQuoteSource(fresh.source, target.source)
    ) {
      setTarget(fresh);
      showErrorToast(
        "Select the text again",
        new Error("The response changed after you selected it."),
      );
      return;
    }
    try {
      if (!runtime?.connected) throw new Error("Connect to OpenCode to ask a side question.");
      const turnMessageID = responsePromptID(rows, fresh.quote.messageID);
      const tabID = askAboutSelection(
        store,
        {
          profileID: runtime.profileID,
          connectionID: runtime.connectionID,
          sessionID,
          location,
        },
        turnMessageID ? { ...fresh.quote, turnMessageID } : fresh.quote,
      );
      setPending({
        source: fresh.source,
        tabID,
        scope: { profileID: runtime.profileID, sessionID },
      });
      document.getSelection()?.removeAllRanges();
      setTarget(null);
    } catch (error) {
      showErrorToast("Could not ask about the selection", error);
    }
  };

  return createPortal(
    <div
      {...{ [ACTION]: "" }}
      className="absolute z-10 -translate-x-1/2 select-none"
      style={{ top: target.anchor.top, left: target.anchor.left }}
    >
      {target.kind === "quote" ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          // Opaque in both themes: the outline variant's dark fill and hover tints are translucent.
          className="bg-popover text-popover-foreground shadow-md hover:bg-[color-mix(in_oklch,var(--popover)_94%,var(--foreground))] active:bg-[color-mix(in_oklch,var(--popover)_90%,var(--foreground))] dark:bg-popover dark:hover:bg-[color-mix(in_oklch,var(--popover)_92%,var(--foreground))]"
          // Keep the selection: a press would otherwise collapse it before the click.
          onPointerDown={(event) => event.preventDefault()}
          onMouseDown={(event) => event.preventDefault()}
          onClick={ask}
        >
          <MessageCircleQuestion data-icon="inline-start" aria-hidden="true" />
          Ask about selection
        </Button>
      ) : (
        <p
          role="status"
          className="w-max max-w-64 rounded-md border border-border bg-popover px-2 py-1 text-meta text-muted-foreground shadow-sm"
        >
          Select text inside one response to ask about it.
        </p>
      )}
    </div>,
    target.element,
  );
}
