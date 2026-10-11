import type { Virtualizer } from "@tanstack/react-virtual";
import { atom, useAtomValue, useStore } from "jotai";
import { ChevronDown, ChevronUp, Search, X } from "lucide-react";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import { turnActivityOpenAtomFamily } from "../atoms/ui";
import { formatShortcut, matchesShortcut, shortcutKeys } from "../lib/keyboard-shortcuts";
import { applyTranscriptHighlights, clearTranscriptHighlights } from "../lib/transcript-search-dom";
import {
  findTranscriptMatches,
  initialTranscriptMatch,
  normalizeTranscriptQuery,
  preservedTranscriptMatch,
  stepTranscriptMatch,
  type TranscriptFindMatch,
  type TranscriptFindResult,
} from "../lib/transcript-search";
import type { TranscriptProjectionRow } from "../lib/turn-projection";
import { IconButton } from "./ui";
import { Button } from "./ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "./ui/input-group";
import { SurfaceBackdrop } from "./ui/surface-backdrop";

const transcriptFindRequestAtom = atom(0);
const transcriptTurnRequestAtom = atom<{ direction: "previous" | "next"; serial: number } | null>(
  null,
);

/** Opens (or refocuses) Find in task for the task currently on screen. */
export const openTranscriptFindAtom = atom(null, (get, set) => {
  set(transcriptFindRequestAtom, get(transcriptFindRequestAtom) + 1);
});

/** Moves the open task to its previous or next user turn. */
export const requestTranscriptTurnAtom = atom(null, (get, set, direction: "previous" | "next") => {
  set(transcriptTurnRequestAtom, {
    direction,
    serial: (get(transcriptTurnRequestAtom)?.serial ?? 0) + 1,
  });
});

/** Marks the element that scopes the previous/next user turn shortcuts. */
export const TASK_VIEW_ATTRIBUTE = "data-palot-task-view";

const OWN_FIND_SELECTOR =
  '[role="dialog"], [role="alertdialog"], [data-workbench-pane], [data-workbench-terminal], .xterm';
const HIGHLIGHT_REFRESH_MS = 120;
const REVEAL_MAX_FRAMES = 45;
const EMPTY_RESULT: TranscriptFindResult = { matches: [], truncated: false };

function eventElement(event: KeyboardEvent): Element | null {
  return event.target instanceof Element ? event.target : null;
}

/**
 * Mod+F opens Find in task unless focus is in a surface with its own find (terminals,
 * the browser and other workbench panes) or a dialog. The previous/next user turn
 * shortcuts apply while focus is in the task view, including the composer.
 */
export function useTaskViewShortcuts({
  onFind,
  onTurn,
}: {
  onFind(): void;
  onTurn(direction: "previous" | "next"): void;
}) {
  const handlers = useRef({ onFind, onTurn });
  useLayoutEffect(() => {
    handlers.current = { onFind, onTurn };
  });
  const findRequest = useAtomValue(transcriptFindRequestAtom);
  const turnRequest = useAtomValue(transcriptTurnRequestAtom);
  const seenFindRequest = useRef(findRequest);
  const seenTurnRequest = useRef(turnRequest);
  useEffect(() => {
    if (findRequest === seenFindRequest.current) return;
    seenFindRequest.current = findRequest;
    handlers.current.onFind();
  }, [findRequest]);
  useEffect(() => {
    if (turnRequest === seenTurnRequest.current) return;
    seenTurnRequest.current = turnRequest;
    if (turnRequest) handlers.current.onTurn(turnRequest.direction);
  }, [turnRequest]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const target = eventElement(event);
      if (matchesShortcut(event, shortcutKeys("task.find"))) {
        if (target?.closest(OWN_FIND_SELECTOR)) return;
        event.preventDefault();
        handlers.current.onFind();
        return;
      }
      const direction = matchesShortcut(event, shortcutKeys("task.turn.previous"))
        ? "previous"
        : matchesShortcut(event, shortcutKeys("task.turn.next"))
          ? "next"
          : null;
      if (!direction) return;
      const inTaskView =
        !target || target === document.body || target.closest(`[${TASK_VIEW_ATTRIBUTE}]`);
      if (!inTaskView || target?.closest(OWN_FIND_SELECTOR)) return;
      event.preventDefault();
      handlers.current.onTurn(direction);
    };
    // Capture runs before window-level bubble handlers that also use these keys.
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);
}

export interface TranscriptFindInput {
  sessionID: string;
  rows: TranscriptProjectionRow[];
  viewport: RefObject<HTMLDivElement | null>;
  virtualizer: Virtualizer<HTMLDivElement, Element>;
  bottomInset: number;
  /** Keeps the active match's turn mounted while it is outside the virtual range. */
  pin(turnID: string | null): void;
  /** Stops bottom-follow so revealing an older match is not undone by streaming. */
  unlock(): void;
  /** Cancels prompt navigation that would otherwise compete for the scroll position. */
  cancelNavigation(): void;
}

export function useTranscriptFind(input: TranscriptFindInput) {
  const store = useStore();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);
  const [focusRequest, setFocusRequest] = useState(0);
  const [revealRequest, setRevealRequest] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const activeMatchRef = useRef<TranscriptFindMatch | null>(null);
  const openRef = useRef(open);
  openRef.current = open;
  const activeIndexRef = useRef(-1);
  const searchedQueryRef = useRef<string | null>(null);
  const latest = useRef(input);
  useLayoutEffect(() => {
    latest.current = input;
  });

  const deferredQuery = useDeferredValue(query);
  const result = useMemo(
    () => (open ? findTranscriptMatches(input.rows, deferredQuery) : EMPTY_RESULT),
    [deferredQuery, input.rows, open],
  );
  const resultRef = useRef(result);
  const queryRef = useRef(deferredQuery);
  useLayoutEffect(() => {
    resultRef.current = result;
    queryRef.current = deferredQuery;
  });

  const select = useCallback((index: number, reveal: boolean) => {
    activeIndexRef.current = index;
    activeMatchRef.current = resultRef.current.matches[index] ?? null;
    setActiveIndex(index);
    if (reveal && index >= 0) setRevealRequest((current) => current + 1);
  }, []);

  const visibleTurnIndex = useCallback((): number | null => {
    const viewport = latest.current.viewport.current;
    if (!viewport) return null;
    const readingTop = viewport.scrollTop + 16;
    const item = latest.current.virtualizer
      .getVirtualItems()
      .find((candidate) => candidate.end > readingTop);
    return item?.index ?? null;
  }, []);

  // A new query searches forward from the reader's position; content changes for the
  // same query keep the current match selected.
  useLayoutEffect(() => {
    if (!open) return;
    const { matches } = result;
    if (searchedQueryRef.current !== deferredQuery) {
      searchedQueryRef.current = deferredQuery;
      const previous = activeMatchRef.current;
      const previousTurn = previous
        ? latest.current.rows.findIndex((row) => row.id === previous.turnID)
        : -1;
      const anchor = previousTurn >= 0 ? previousTurn : visibleTurnIndex();
      select(initialTranscriptMatch(matches, anchor), true);
      return;
    }
    const index = preservedTranscriptMatch(matches, activeMatchRef.current, activeIndexRef.current);
    if (index !== activeIndexRef.current || matches[index] !== activeMatchRef.current) {
      select(index, false);
    }
  }, [deferredQuery, open, result, select, visibleTurnIndex]);

  const step = useCallback(
    (direction: "next" | "previous") => {
      const count = resultRef.current.matches.length;
      if (count === 0) return;
      select(stepTranscriptMatch(activeIndexRef.current, count, direction), true);
    },
    [select],
  );

  const openFind = useCallback(() => {
    const active = document.activeElement;
    if (!inputRef.current || active !== inputRef.current) {
      returnFocusRef.current =
        active instanceof HTMLElement && active !== document.body ? active : null;
    }
    setOpen(true);
    setFocusRequest((current) => current + 1);
  }, []);

  const closeFind = useCallback(() => {
    setOpen(false);
    searchedQueryRef.current = null;
    activeMatchRef.current = null;
    activeIndexRef.current = -1;
    setActiveIndex(-1);
    latest.current.pin(null);
    clearTranscriptHighlights();
    const target = returnFocusRef.current;
    returnFocusRef.current = null;
    if (target?.isConnected) target.focus({ preventScroll: true });
    else latest.current.viewport.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    if (!open || focusRequest === 0) return;
    const focusInput = () => {
      inputRef.current?.focus();
      inputRef.current?.select();
    };
    const frame = requestAnimationFrame(focusInput);
    // A closing menu restores focus to its trigger after the find bar opened from it.
    const timer = window.setTimeout(() => {
      const active = document.activeElement;
      if (
        inputRef.current &&
        active !== inputRef.current &&
        (active === document.body || active?.closest('[aria-haspopup="menu"]'))
      )
        focusInput();
    }, 200);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [focusRequest, open]);

  // Highlights follow virtualizer mounts and streamed text through DOM mutations,
  // throttled to one pass over the rendered matching parts per interval. Match-list
  // updates from streaming are read from refs so they do not trigger extra passes.
  const hasMatches = result.matches.length > 0;
  useEffect(() => {
    const viewport = input.viewport.current;
    if (!open || !viewport || !normalizeTranscriptQuery(deferredQuery) || !hasMatches) {
      clearTranscriptHighlights();
      return;
    }
    const apply = () =>
      applyTranscriptHighlights(
        viewport,
        queryRef.current,
        resultRef.current.matches,
        activeMatchRef.current,
      );
    apply();
    let timer: number | null = null;
    const observer = new MutationObserver(() => {
      if (timer !== null) return;
      timer = window.setTimeout(() => {
        timer = null;
        apply();
      }, HIGHLIGHT_REFRESH_MS);
    });
    observer.observe(viewport, { childList: true, subtree: true, characterData: true });
    return () => {
      observer.disconnect();
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [activeIndex, deferredQuery, hasMatches, input.viewport, open]);

  useEffect(() => () => clearTranscriptHighlights(), []);

  // Scroll the virtualizer to the active match's turn, then center the rendered text.
  useEffect(() => {
    if (revealRequest === 0) return;
    const match = activeMatchRef.current;
    const current = latest.current;
    const viewport = current.viewport.current;
    if (!match || !viewport) return;
    const turnIndex = current.rows.findIndex((row) => row.id === match.turnID);
    if (turnIndex < 0) return;
    current.cancelNavigation();
    current.unlock();
    current.pin(match.turnID);
    if (match.location === "activity") {
      const disclosure = turnActivityOpenAtomFamily(current.sessionID, match.turnID);
      if (store.get(disclosure) !== true) store.set(disclosure, true);
    }
    const turnSelector = `[data-turn-row-id="${CSS.escape(match.turnID)}"]`;
    if (!viewport.querySelector(turnSelector)) {
      current.virtualizer.scrollToIndex(turnIndex, { align: "start" });
    }
    let frame = 0;
    let frames = 0;
    let stableFrames = 0;
    const settle = () => {
      // Closing Find clears highlights; a pending reveal must not re-apply them.
      if (!openRef.current) return;
      frames += 1;
      const bounds = viewport.getBoundingClientRect();
      const top = bounds.top + 24;
      const bottom = bounds.bottom - latest.current.bottomInset - 24;
      const visibleHeight = Math.max(1, bottom - top);
      const highlight = applyTranscriptHighlights(
        viewport,
        queryRef.current,
        resultRef.current.matches,
        match,
      );
      const rangeRect = highlight.active?.getBoundingClientRect();
      const turn = viewport.querySelector<HTMLElement>(turnSelector);
      // Off-screen rows skip layout (content-visibility), so their text has no box yet.
      // Bring the turn on screen first, then center the match itself.
      const target =
        rangeRect && rangeRect.height > 0
          ? rangeRect
          : frames > 8 && highlight.activePart
            ? highlight.activePart.getBoundingClientRect()
            : turn?.getBoundingClientRect();
      if (target && target.height > 0) {
        const outside = target.top < top || target.bottom > bottom;
        if (outside) {
          const centered = target.top - top - (visibleHeight - target.height) / 2;
          viewport.scrollTop += target.height > visibleHeight ? target.top - top : centered;
          stableFrames = 0;
        } else {
          stableFrames += 1;
        }
      }
      const settled = stableFrames >= 2 && (rangeRect?.height ?? 0) > 0;
      if (!settled && frames < REVEAL_MAX_FRAMES) frame = requestAnimationFrame(settle);
    };
    frame = requestAnimationFrame(settle);
    return () => cancelAnimationFrame(frame);
  }, [revealRequest, store]);

  const matchCount = result.matches.length;
  return {
    open,
    query,
    setQuery,
    activeIndex,
    matchCount,
    truncated: result.truncated,
    pending: query !== deferredQuery,
    inputRef,
    openFind,
    closeFind,
    step,
  };
}

export type TranscriptFindController = ReturnType<typeof useTranscriptFind>;

export function TranscriptFindBar({
  controller,
  hasOlder,
  loadingOlder,
  onLoadOlder,
}: {
  controller: TranscriptFindController;
  hasOlder: boolean;
  loadingOlder: boolean;
  onLoadOlder(): void;
}) {
  if (!controller.open) return null;
  const { query, activeIndex, matchCount, truncated } = controller;
  const searching = normalizeTranscriptQuery(query) !== "";
  const total = truncated ? `${matchCount}+` : String(matchCount);
  const status = !searching
    ? ""
    : matchCount === 0
      ? controller.pending
        ? ""
        : "No results"
      : `${activeIndex + 1} of ${total}`;
  const findShortcut = formatShortcut(shortcutKeys("task.find"));
  return (
    <div
      role="search"
      aria-label="Find in task"
      className="palot-translucent-popover absolute top-2 right-4 z-30 isolate flex w-80 max-w-[calc(100%-2rem)] flex-col rounded-lg bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10"
    >
      <SurfaceBackdrop />
      <div className="flex items-center gap-0.5 p-1">
        <InputGroup className="min-w-0 flex-1">
          <InputGroupAddon aria-hidden="true">
            <Search />
          </InputGroupAddon>
          <InputGroupInput
            ref={controller.inputRef}
            type="text"
            value={query}
            placeholder="Find in task"
            aria-label="Find in task"
            aria-keyshortcuts={findShortcut}
            spellCheck={false}
            autoComplete="off"
            onChange={(event) => controller.setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                controller.closeFind();
                return;
              }
              if (event.key === "Enter" && !event.altKey && !event.metaKey && !event.ctrlKey) {
                event.preventDefault();
                controller.step(event.shiftKey ? "previous" : "next");
              }
            }}
          />
          {status ? (
            <InputGroupAddon align="inline-end" className="tabular-nums" aria-hidden="true">
              {status}
            </InputGroupAddon>
          ) : null}
        </InputGroup>
        <IconButton
          label="Previous match"
          icon={ChevronUp}
          size="icon-sm"
          disabled={matchCount === 0}
          onClick={() => controller.step("previous")}
        />
        <IconButton
          label="Next match"
          icon={ChevronDown}
          size="icon-sm"
          disabled={matchCount === 0}
          onClick={() => controller.step("next")}
        />
        <IconButton label="Close find" icon={X} size="icon-sm" onClick={controller.closeFind} />
      </div>
      <span className="sr-only" role="status" aria-live="polite">
        {status}
      </span>
      {hasOlder ? (
        <div className="flex items-center justify-between gap-2 border-t border-foreground/10 py-0.5 pr-1 pl-2.5 text-meta text-muted-foreground">
          <span>Searching loaded messages</span>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            disabled={loadingOlder}
            aria-busy={loadingOlder || undefined}
            onClick={onLoadOlder}
          >
            {loadingOlder ? "Loading…" : "Load earlier"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
