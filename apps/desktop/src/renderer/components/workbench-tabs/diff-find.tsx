import type { CodeViewSearchOptions } from "@pierre/diffs";
import type { CodeViewHandle } from "@pierre/diffs/react";
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
  diffLineKey,
  revealRangeHorizontally,
  type RenderedDiffItem,
} from "../../lib/diff-find-dom";
import {
  formatShortcut,
  matchesShortcut,
  shortcutKeys,
  type ShortcutKeys,
} from "../../lib/keyboard-shortcuts";
import { deepActiveElement, FindBar, findStatus } from "../find-bar";

const EMPTY_RESULT: DiffFindResult = { matches: [], truncated: false };

/**
 * Pass as a `CodeView`'s `searchOptions`. CodeView binds Mod+F (and Mod+Alt+F) on its own root in
 * the capture phase, so without this its search panel takes Mod+F from Find in diff and its
 * matches never reach the change rail. Its panel (match case, whole word, regex) stays on
 * Mod+Alt+F through `onKeyDown`, as in a file tab's editor.
 */
export const DIFF_FIND_CODE_VIEW_SEARCH = {
  disableShortcuts: true,
} as const satisfies CodeViewSearchOptions;
const CODE_VIEW_SEARCH_KEYS: ShortcutKeys = ["Mod", "Alt", "F"];
const REVEAL_MAX_FRAMES = 45;
const RESCROLL_FRAME = 8;

/**
 * A surface that renders every line of its files without `CodeView`, such as a file
 * tab's source view.
 */
export interface DiffFindView {
  renderedItems(): RenderedDiffItem[];
  /** Brings a match's line on screen before the match itself is centered. */
  scrollToLine?(match: DiffFindMatch): void;
  /** Calls `refresh` when rendered lines change; returns its cleanup. */
  observe?(refresh: () => void): () => void;
}

export interface DiffFindInput {
  /** Diffs in display order; matches come from this text, not the virtualized DOM. */
  sources: readonly DiffFindSource[];
  codeView?: RefObject<CodeViewHandle<undefined, undefined> | null>;
  /** Used instead of `codeView` by surfaces that render every line. */
  view?: DiffFindView;
  /** The scroll container. */
  container: HTMLElement | null;
  /** Makes a collapsed file visible before its match is revealed. */
  onRevealItem?(id: string): void;
  /** False dismisses an open search without moving focus, e.g. when the surface hides. */
  enabled?: boolean;
}

/**
 * Find in diff for a `CodeView` surface, or a file's source view. Mod+F (the Find in
 * changes binding) opens it while focus is inside the surface; the transcript's handler
 * already ignores workbench panes, so the two never compete for the same key press.
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
    const { view, codeView } = latest.current;
    if (view) return view.renderedItems();
    const rendered = codeView?.current?.getInstance()?.getRenderedItems() ?? [];
    return rendered.map((item) => ({ id: item.id, element: item.element }));
  }, []);

  // A view renders every line, so only lines with matches are searched in the DOM.
  const matchedLines = useMemo(
    () =>
      input.view
        ? new Set(result.matches.map((match) => diffLineKey(match.itemID, match.lineNumber)))
        : undefined,
    [input.view, result],
  );
  const matchedLinesRef = useRef(matchedLines);
  useLayoutEffect(() => {
    matchedLinesRef.current = matchedLines;
  });

  const highlight = useCallback(() => {
    if (!openRef.current) return null;
    return applyDiffHighlights(
      owner,
      renderedItems(),
      normalizeDiffFindQuery(queryRef.current),
      activeMatchRef.current,
      matchedLinesRef.current,
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

  // Virtualized lines mount on scroll; a view reports its own re-renders.
  const view = input.view;
  useEffect(() => {
    const container = input.container;
    if (!open) return;
    if (view) return view.observe?.(refresh);
    if (!container) return;
    container.addEventListener("scroll", refresh, { passive: true });
    return () => container.removeEventListener("scroll", refresh);
  }, [input.container, open, refresh, view]);

  useEffect(
    () => () => {
      cancelAnimationFrame(refreshFrame.current);
      clearDiffHighlights(owner);
    },
    [owner],
  );

  const openFind = useCallback(() => {
    const active = deepActiveElement();
    if (!inputRef.current || active !== inputRef.current) returnFocusRef.current = active;
    setOpen(true);
    setFocusRequest((current) => current + 1);
  }, []);

  const dismiss = useCallback(() => {
    setOpen(false);
    searchedQueryRef.current = null;
    activeMatchRef.current = null;
    activeIndexRef.current = -1;
    setActiveIndex(-1);
    clearDiffHighlights(owner);
  }, [owner]);

  const closeFind = useCallback(() => {
    dismiss();
    const target = returnFocusRef.current;
    returnFocusRef.current = null;
    if (target?.isConnected) target.focus({ preventScroll: true });
    else latest.current.container?.focus({ preventScroll: true });
  }, [dismiss]);

  const enabled = input.enabled ?? true;
  useEffect(() => {
    if (!enabled && openRef.current) {
      returnFocusRef.current = null;
      dismiss();
    }
  }, [dismiss, enabled]);

  // Focus moves in the same commit that shows the bar, not a frame later: a key pressed
  // right after Mod+F (Escape, the first letter) belongs to the bar.
  useLayoutEffect(() => {
    if (!open || focusRequest === 0) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [focusRequest, open]);

  useEffect(() => {
    if (!open || focusRequest === 0) return;
    const focusInput = () => {
      inputRef.current?.focus();
      inputRef.current?.select();
    };
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
    return () => window.clearTimeout(timer);
  }, [focusRequest, open]);

  // Scroll CodeView to the active match's line, then keep it in view while the line
  // renders, and finally bring the match itself into horizontal view.
  useEffect(() => {
    if (revealRequest === 0) return;
    const match = activeMatchRef.current;
    if (!match) return;
    latest.current.onRevealItem?.(match.itemID);
    const scrollToMatch = () => {
      const { view, codeView } = latest.current;
      if (view) return view.scrollToLine?.(match);
      codeView?.current?.scrollTo({
        type: "line",
        id: match.itemID,
        lineNumber: match.lineNumber,
        side: match.side,
        align: "center",
      });
    };
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

  /**
   * Attach to the surface root: Mod+F inside it opens Find in diff, and Mod+Alt+F opens a
   * `CodeView`'s own search panel (see `DIFF_FIND_CODE_VIEW_SEARCH`).
   */
  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (matchesShortcut(event.nativeEvent, shortcutKeys("changes.find"))) {
        event.preventDefault();
        openFind();
        return;
      }
      const codeView = latest.current.codeView?.current;
      if (!codeView || !matchesShortcut(event.nativeEvent, CODE_VIEW_SEARCH_KEYS)) return;
      event.preventDefault();
      codeView.openSearch();
    },
    [openFind],
  );

  return {
    open,
    query,
    setQuery,
    activeIndex,
    /** Every match in display order; empty while Find is closed. */
    matches: result.matches,
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

export function DiffFindBar({
  controller,
  label = "Find in diff",
}: {
  controller: DiffFindController;
  label?: string;
}) {
  if (!controller.open) return null;
  const status = findStatus({
    searching: normalizeDiffFindQuery(controller.query) !== "",
    matchCount: controller.matchCount,
    activeIndex: controller.activeIndex,
    truncated: controller.truncated,
    pending: controller.pending,
  });
  return (
    <FindBar
      label={label}
      shortcut={formatShortcut(shortcutKeys("changes.find"))}
      query={controller.query}
      status={status}
      matchCount={controller.matchCount}
      inputRef={controller.inputRef}
      onQueryChange={controller.setQuery}
      onStep={controller.step}
      onClose={controller.closeFind}
    />
  );
}
