import {
  useCallback,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { stepDiffMatch } from "../../lib/diff-find";
import {
  clearDiffHighlights,
  diffLineSide,
  revealRangeHorizontally,
  setFindHighlights,
} from "../../lib/diff-find-dom";
import {
  documentTextRanges,
  findTableMatches,
  normalizeDocumentFindQuery,
  previewTableIn,
  revealRangeIn,
  tableMatchRanges,
  type PreviewTableSource,
  type TableFindMatch,
} from "../../lib/document-find";
import { formatShortcut, matchesShortcut, shortcutKeys } from "../../lib/keyboard-shortcuts";
import { deepActiveElement, FindBar, findStatus } from "../find-bar";
import { DiffFindBar, useDiffFind, type DiffFindController, type DiffFindView } from "./diff-find";

const FILE_FIND_ITEM = "file";
const REFRESH_MS = 120;
const SEARCH_DEBOUNCE_MS = 60;
const REVEAL_MAX_FRAMES = 45;
const FIND_LABEL = "Find in file";

/**
 * What Find searches in a file tab: the source view (through Find in diff's text
 * matching), the rendered preview's text, or nothing, with the reason shown in the bar.
 */
export type FileFindMode = "source" | "preview" | { unavailable: string };

interface FoundText {
  query: string;
  ranges: Range[];
  table: { element: Element; source: PreviewTableSource; matches: TableFindMatch[] } | null;
  truncated: boolean;
  activeIndex: number;
}

const NOTHING_FOUND: FoundText = {
  query: "",
  ranges: [],
  table: null,
  truncated: false,
  activeIndex: -1,
};

/**
 * The pierre `File` or `FileDiff` host under a scroll container that renders every line,
 * such as a file tab's source view or a single-file diff tab.
 */
export function pierreHostFindView(
  container: () => HTMLElement | null,
  id = FILE_FIND_ITEM,
): DiffFindView {
  const host = () => container()?.querySelector("diffs-container") ?? null;
  return {
    renderedItems() {
      const element = host();
      return element ? [{ id, element }] : [];
    },
    scrollToLine(match) {
      const scroller = container();
      const element = host();
      const lines = [
        ...((element?.shadowRoot ?? element)?.querySelectorAll(
          `code [data-line="${match.lineNumber}"]`,
        ) ?? []),
      ];
      // A diff can show the same line number on both sides.
      const line = lines.find((candidate) => diffLineSide(candidate) === match.side) ?? lines[0];
      if (!scroller || !line) return;
      const rect = line.getBoundingClientRect();
      const bounds = scroller.getBoundingClientRect();
      if (rect.top < bounds.top || rect.bottom > bounds.bottom)
        scroller.scrollTop += rect.top + rect.height / 2 - (bounds.top + bounds.height / 2);
    },
    observe(refresh) {
      // Lines re-render inside the host's shadow root (highlighting, edits); the host
      // itself is replaced when the view switches between viewer and editor.
      let observed: ShadowRoot | null = null;
      let inner: MutationObserver | null = null;
      const attach = () => {
        const root = host()?.shadowRoot ?? null;
        if (root === observed) return;
        inner?.disconnect();
        observed = root;
        inner = null;
        if (!root) return;
        inner = new MutationObserver(refresh);
        inner.observe(root, { childList: true, subtree: true, characterData: true });
      };
      const outer = new MutationObserver(() => {
        attach();
        refresh();
      });
      const scroller = container();
      if (scroller) outer.observe(scroller, { childList: true, subtree: true });
      attach();
      return () => {
        outer.disconnect();
        inner?.disconnect();
      };
    },
  };
}

/**
 * Find in a rendered preview. Text previews are searched in the DOM; a virtualized
 * table is searched through its registered rows. Matches are capped like Find in diff.
 */
export function useDocumentFind({
  root,
  enabled,
  unavailable,
  contentKey,
}: {
  /** Element holding the preview; the find bar must not be inside it. */
  root: HTMLElement | null;
  enabled: boolean;
  /** Why this view cannot be searched; the bar shows it instead of results. */
  unavailable?: string;
  /** Changes when the previewed content changes, so matches are searched again. */
  contentKey?: unknown;
}) {
  const [owner] = useState(() => ({}));
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [summary, setSummary] = useState({ count: 0, truncated: false, activeIndex: -1 });
  const [focusRequest, setFocusRequest] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const found = useRef<FoundText>(NOTHING_FOUND);
  const revealFrame = useRef(0);
  const openRef = useRef(open);
  const deferredQuery = useDeferredValue(query);
  const latest = useRef({ root, unavailable, query: deferredQuery });
  useLayoutEffect(() => {
    latest.current = { root, unavailable, query: deferredQuery };
    openRef.current = open;
  });

  /** Highlights the found ranges; returns the active match's range when it is rendered. */
  const paint = useCallback((): Range | null => {
    const current = found.current;
    if (!openRef.current) {
      clearDiffHighlights(owner);
      return null;
    }
    if (current.table) {
      const ranges = tableMatchRanges(
        current.table.element,
        current.query,
        current.table.matches,
        current.table.matches[current.activeIndex] ?? null,
      );
      setFindHighlights(owner, ranges.hits, ranges.active);
      return ranges.active;
    }
    const active = current.ranges[current.activeIndex] ?? null;
    setFindHighlights(
      owner,
      current.ranges.filter((range) => range !== active),
      active,
    );
    return active;
  }, [owner]);

  const reveal = useCallback(() => {
    cancelAnimationFrame(revealFrame.current);
    const current = found.current;
    const previewRoot = latest.current.root;
    if (!previewRoot || current.activeIndex < 0) return;
    const show = (range: Range) => {
      revealRangeIn(previewRoot, range);
      revealRangeHorizontally(range);
    };
    if (!current.table) {
      const range = current.ranges[current.activeIndex];
      if (range) show(range);
      return;
    }
    const match = current.table.matches[current.activeIndex];
    if (!match) return;
    current.table.source.scrollToRow(match.row);
    // The row mounts after the virtualizer scrolls; wait for its cell.
    let frames = 0;
    const settle = () => {
      if (!openRef.current || found.current !== current) return;
      frames += 1;
      const range = paint();
      if (range && range.getBoundingClientRect().height > 0) {
        show(range);
        return;
      }
      if (frames < REVEAL_MAX_FRAMES) revealFrame.current = requestAnimationFrame(settle);
    };
    revealFrame.current = requestAnimationFrame(settle);
  }, [paint]);

  /**
   * Searches the preview. A new query starts at the first match from the previous match
   * or the top of the view; a refresh keeps the current match without scrolling. So does a
   * new search for the query already shown: the debounce can run a query twice (a timer from
   * before the query changed reads the latest query), and the second run must not undo a
   * step taken in between.
   */
  const search = useCallback(
    (kind: "new" | "refresh") => {
      const { root: previewRoot, unavailable: reason, query: text } = latest.current;
      const previous = found.current;
      if (!openRef.current || !previewRoot || reason || !normalizeDocumentFindQuery(text)) {
        found.current = { ...NOTHING_FOUND, query: text };
        setSummary({ count: 0, truncated: false, activeIndex: -1 });
        clearDiffHighlights(owner);
        return;
      }
      const keep = kind === "refresh" || (text === previous.query && previous.activeIndex >= 0);
      const table = previewTableIn(previewRoot);
      let next: FoundText;
      if (table) {
        // Only a new search reads the table's data; scrolling mounts rows, not data.
        const result =
          kind === "refresh" && previous.table?.element === table.element
            ? { matches: previous.table.matches, truncated: previous.truncated }
            : findTableMatches(table.source, text);
        next = {
          ...NOTHING_FOUND,
          query: text,
          table: { ...table, matches: result.matches },
          truncated: result.truncated,
        };
      } else {
        next = { ...NOTHING_FOUND, query: text, ...documentTextRanges(previewRoot, text) };
      }
      const count = next.table ? next.table.matches.length : next.ranges.length;
      if (count > 0) {
        if (keep) next.activeIndex = Math.min(Math.max(previous.activeIndex, 0), count - 1);
        else if (next.table) next.activeIndex = 0;
        else next.activeIndex = firstRangeFrom(next.ranges, previous, previewRoot);
      }
      found.current = next;
      setSummary({ count, truncated: next.truncated, activeIndex: next.activeIndex });
      paint();
      if (!keep) reveal();
    },
    [owner, paint, reveal],
  );

  // Debounced so a large preview is not walked on every keystroke.
  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => search("new"), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [contentKey, deferredQuery, open, root, search, unavailable]);

  // Previews render late (Office documents, Mermaid, syntax highlighting) and tables
  // mount rows on scroll; follow the DOM, throttled.
  useEffect(() => {
    if (!open || !root || unavailable) return;
    let timer: number | null = null;
    const observer = new MutationObserver(() => {
      if (timer !== null) return;
      timer = window.setTimeout(() => {
        timer = null;
        if (found.current.table) paint();
        else search("refresh");
      }, REFRESH_MS);
    });
    observer.observe(root, { childList: true, subtree: true, characterData: true });
    return () => {
      observer.disconnect();
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [open, paint, root, search, unavailable]);

  useEffect(
    () => () => {
      cancelAnimationFrame(revealFrame.current);
      clearDiffHighlights(owner);
    },
    [owner],
  );

  const step = useCallback(
    (direction: "next" | "previous") => {
      const current = found.current;
      const count = current.table ? current.table.matches.length : current.ranges.length;
      if (count === 0) return;
      const activeIndex = stepDiffMatch(current.activeIndex, count, direction);
      found.current = { ...current, activeIndex };
      setSummary((previous) => ({ ...previous, activeIndex }));
      paint();
      reveal();
    },
    [paint, reveal],
  );

  const openFind = useCallback(() => {
    const active = deepActiveElement();
    if (!inputRef.current || active !== inputRef.current) returnFocusRef.current = active;
    setOpen(true);
    setFocusRequest((current) => current + 1);
  }, []);

  const dismiss = useCallback(() => {
    setOpen(false);
    openRef.current = false;
    cancelAnimationFrame(revealFrame.current);
    found.current = NOTHING_FOUND;
    setSummary({ count: 0, truncated: false, activeIndex: -1 });
    clearDiffHighlights(owner);
  }, [owner]);

  const closeFind = useCallback(() => {
    dismiss();
    const target = returnFocusRef.current;
    returnFocusRef.current = null;
    if (target?.isConnected) target.focus({ preventScroll: true });
    else latest.current.root?.focus({ preventScroll: true });
  }, [dismiss]);

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

  return {
    open,
    query,
    setQuery,
    activeIndex: summary.activeIndex,
    matchCount: summary.count,
    truncated: summary.truncated,
    pending: query !== deferredQuery,
    unavailable,
    inputRef,
    openFind,
    closeFind,
    step,
  };
}

export type DocumentFindController = ReturnType<typeof useDocumentFind>;

/** The first match at or after the previous match, else after the top of the view. */
function firstRangeFrom(ranges: readonly Range[], previous: FoundText, root: Element): number {
  const anchor = previous.table ? null : (previous.ranges[previous.activeIndex] ?? null);
  const top =
    anchor && !anchor.collapsed
      ? anchor.getBoundingClientRect().top
      : root.getBoundingClientRect().top;
  for (let index = 0; index < ranges.length; index += 1) {
    const rect = ranges[index]!.getBoundingClientRect();
    if (rect.height > 0 && rect.bottom >= top) return index;
  }
  return 0;
}

/**
 * Find (Mod+F) for a file tab. The source view reuses Find in diff over the file's text;
 * previews search their rendered text. Attach `onKeyDownCapture` to the tab root.
 */
export function useFileFind({
  mode,
  sourceText,
  sourceContainer,
  previewRoot,
  contentKey,
}: {
  mode: FileFindMode;
  /** The text the source view shows, including unsaved edits. */
  sourceText: string;
  /** The source view's scroll container. */
  sourceContainer: HTMLElement | null;
  /** Holds the preview (or the unavailable view) and nothing else. */
  previewRoot: HTMLElement | null;
  contentKey?: unknown;
}) {
  const sourceContainerRef = useRef(sourceContainer);
  useLayoutEffect(() => {
    sourceContainerRef.current = sourceContainer;
  });
  const view = useMemo(() => pierreHostFindView(() => sourceContainerRef.current), []);
  const sources = useMemo(() => [{ id: FILE_FIND_ITEM, text: sourceText }], [sourceText]);
  const source = useDiffFind({
    sources,
    view,
    container: sourceContainer,
    enabled: mode === "source",
  });
  const preview = useDocumentFind({
    root: previewRoot,
    enabled: mode !== "source",
    unavailable: typeof mode === "object" ? mode.unavailable : undefined,
    contentKey,
  });
  // Capture phase: Pierre's editor opens its own find panel on Mod+F otherwise. Its
  // find and replace (Mod+Alt+F) stays available.
  const onKeyDownCapture = useCallback(
    (event: ReactKeyboardEvent) => {
      if (!matchesShortcut(event.nativeEvent, shortcutKeys("changes.find"))) return;
      event.preventDefault();
      event.stopPropagation();
      if (mode === "source") source.openFind();
      else preview.openFind();
    },
    [mode, preview, source],
  );
  return { mode, source, preview, onKeyDownCapture };
}

export type FileFindController = ReturnType<typeof useFileFind>;

export function FileFindBar({ find }: { find: FileFindController }) {
  if (find.mode === "source") return <SourceFindBar controller={find.source} />;
  return <PreviewFindBar controller={find.preview} />;
}

function SourceFindBar({ controller }: { controller: DiffFindController }) {
  return <DiffFindBar controller={controller} label={FIND_LABEL} />;
}

function PreviewFindBar({ controller }: { controller: DocumentFindController }) {
  if (!controller.open) return null;
  const status = controller.unavailable
    ? ""
    : findStatus({
        searching: normalizeDocumentFindQuery(controller.query) !== "",
        matchCount: controller.matchCount,
        activeIndex: controller.activeIndex,
        truncated: controller.truncated,
        pending: controller.pending,
      });
  return (
    <FindBar
      label={FIND_LABEL}
      shortcut={formatShortcut(shortcutKeys("changes.find"))}
      query={controller.query}
      status={status}
      matchCount={controller.matchCount}
      inputRef={controller.inputRef}
      unavailable={controller.unavailable}
      onQueryChange={controller.setQuery}
      onStep={controller.step}
      onClose={controller.closeFind}
    />
  );
}
