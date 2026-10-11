import type { CodeViewHandle } from "@pierre/diffs/react";
import { ChevronDown, ChevronUp, Search, X } from "lucide-react";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from "react";
import {
  findDiffMatches,
  normalizeDiffFindQuery,
  preservedDiffMatch,
  stepDiffMatch,
  type DiffFindMatch,
  type DiffFindResult,
  type DiffFindSource,
} from "../../lib/diff-find";
import {
  applyDiffHighlights,
  clearDiffHighlights,
  revealRangeHorizontally,
  type RenderedDiffItem,
} from "../../lib/diff-find-dom";
import { formatShortcut, matchesShortcut, shortcutKeys } from "../../lib/keyboard-shortcuts";
import { IconButton } from "../ui";
import { InputGroup, InputGroupAddon, InputGroupInput } from "../ui/input-group";
import { SurfaceBackdrop } from "../ui/surface-backdrop";

const EMPTY_RESULT: DiffFindResult = { matches: [], truncated: false };
const REVEAL_MAX_FRAMES = 45;
const RESCROLL_FRAME = 8;

export interface DiffFindInput {
  /** Diffs in display order; matches come from this text, not the virtualized DOM. */
  sources: readonly DiffFindSource[];
  codeView: RefObject<CodeViewHandle<undefined, undefined> | null>;
  /** CodeView's scroll container. */
  container: HTMLElement | null;
  /** Makes a collapsed file visible before its match is revealed. */
  onRevealItem?(id: string): void;
}

/**
 * Find in diff for a `CodeView` surface. Mod+F (the Find in task binding) opens it
 * while focus is inside the surface; the transcript's handler already ignores
 * workbench panes, so the two never compete for the same key press.
 */
export function useDiffFind(input: DiffFindInput) {
  const [owner] = useState(() => ({}));
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);
  const [focusRequest, setFocusRequest] = useState(0);
  const [revealRequest, setRevealRequest] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const activeMatchRef = useRef<DiffFindMatch | null>(null);
  const activeIndexRef = useRef(-1);
  const searchedQueryRef = useRef<string | null>(null);
  const openRef = useRef(open);
  const latest = useRef(input);
  useLayoutEffect(() => {
    latest.current = input;
    openRef.current = open;
  });

  const deferredQuery = useDeferredValue(query);
  const result = useMemo(
    () => (open ? findDiffMatches(input.sources, deferredQuery) : EMPTY_RESULT),
    [deferredQuery, input.sources, open],
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

  // A new query starts at the first match; refreshed diffs keep the current match.
  useLayoutEffect(() => {
    if (!open) return;
    const { matches } = result;
    if (searchedQueryRef.current !== deferredQuery) {
      searchedQueryRef.current = deferredQuery;
      select(matches.length > 0 ? 0 : -1, true);
      return;
    }
    const index = preservedDiffMatch(matches, activeMatchRef.current, activeIndexRef.current);
    if (index !== activeIndexRef.current || matches[index] !== activeMatchRef.current) {
      select(index, false);
    }
  }, [deferredQuery, open, result, select]);

  const step = useCallback(
    (direction: "next" | "previous") => {
      const count = resultRef.current.matches.length;
      if (count === 0) return;
      select(stepDiffMatch(activeIndexRef.current, count, direction), true);
    },
    [select],
  );

  const renderedItems = useCallback((): RenderedDiffItem[] => {
    const rendered = latest.current.codeView.current?.getInstance()?.getRenderedItems() ?? [];
    return rendered.map((item) => ({ id: item.id, element: item.element }));
  }, []);

  const highlight = useCallback(() => {
    if (!openRef.current) return null;
    return applyDiffHighlights(
      owner,
      renderedItems(),
      normalizeDiffFindQuery(queryRef.current),
      activeMatchRef.current,
    );
  }, [owner, renderedItems]);

  // Virtualized lines mount on scroll and re-render; refresh at most once per frame.
  const refreshFrame = useRef(0);
  const refresh = useCallback(() => {
    if (!openRef.current || refreshFrame.current) return;
    refreshFrame.current = requestAnimationFrame(() => {
      refreshFrame.current = 0;
      highlight();
    });
  }, [highlight]);

  useEffect(() => {
    if (!open) {
      clearDiffHighlights(owner);
      return;
    }
    refresh();
  }, [activeIndex, deferredQuery, input.sources, open, owner, refresh]);

  useEffect(() => {
    const container = input.container;
    if (!open || !container) return;
    container.addEventListener("scroll", refresh, { passive: true });
    return () => container.removeEventListener("scroll", refresh);
  }, [input.container, open, refresh]);

  useEffect(
    () => () => {
      cancelAnimationFrame(refreshFrame.current);
      clearDiffHighlights(owner);
    },
    [owner],
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
    clearDiffHighlights(owner);
    const target = returnFocusRef.current;
    returnFocusRef.current = null;
    if (target?.isConnected) target.focus({ preventScroll: true });
    else latest.current.container?.focus({ preventScroll: true });
  }, [owner]);

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

  // Scroll CodeView to the active match's line, then keep it in view while the line
  // renders, and finally bring the match itself into horizontal view.
  useEffect(() => {
    if (revealRequest === 0) return;
    const match = activeMatchRef.current;
    if (!match) return;
    latest.current.onRevealItem?.(match.itemID);
    const scrollToMatch = () =>
      latest.current.codeView.current?.scrollTo({
        type: "line",
        id: match.itemID,
        lineNumber: match.lineNumber,
        side: match.side,
        align: "center",
      });
    let frame = 0;
    let frames = 0;
    let stableFrames = 0;
    const settle = () => {
      if (!openRef.current) return;
      frames += 1;
      if (frames === 1 || frames === RESCROLL_FRAME) scrollToMatch();
      const highlighted = highlight();
      const range = highlighted?.active;
      const rect = range?.getBoundingClientRect();
      const container = latest.current.container;
      if (range && rect && rect.height > 0 && container) {
        const bounds = container.getBoundingClientRect();
        // Sticky file headers cover the top of the scroll area.
        const top = bounds.top + 40;
        const bottom = bounds.bottom - 16;
        if (rect.top < top || rect.bottom > bottom) {
          container.scrollTop += rect.top - top - (bottom - top - rect.height) / 2;
          stableFrames = 0;
        } else {
          stableFrames += 1;
        }
        if (stableFrames >= 2) {
          revealRangeHorizontally(range);
          return;
        }
      }
      if (frames < REVEAL_MAX_FRAMES) frame = requestAnimationFrame(settle);
    };
    frame = requestAnimationFrame(settle);
    return () => cancelAnimationFrame(frame);
  }, [highlight, revealRequest]);

  /** Attach to the surface root: Mod+F inside it opens Find in diff. */
  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (!matchesShortcut(event.nativeEvent, shortcutKeys("changes.find"))) return;
      event.preventDefault();
      openFind();
    },
    [openFind],
  );

  return {
    open,
    query,
    setQuery,
    activeIndex,
    matchCount: result.matches.length,
    truncated: result.truncated,
    pending: query !== deferredQuery,
    inputRef,
    openFind,
    closeFind,
    step,
    refresh,
    onKeyDown,
  };
}

export type DiffFindController = ReturnType<typeof useDiffFind>;

export function DiffFindBar({ controller }: { controller: DiffFindController }) {
  if (!controller.open) return null;
  const { query, activeIndex, matchCount, truncated } = controller;
  const searching = normalizeDiffFindQuery(query) !== "";
  const total = truncated ? `${matchCount}+` : String(matchCount);
  const status = !searching
    ? ""
    : matchCount === 0
      ? controller.pending
        ? ""
        : "No results"
      : `${activeIndex + 1} of ${total}`;
  return (
    <div
      role="search"
      aria-label="Find in diff"
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
            placeholder="Find in diff"
            aria-label="Find in diff"
            aria-keyshortcuts={formatShortcut(shortcutKeys("changes.find"))}
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
    </div>
  );
}
