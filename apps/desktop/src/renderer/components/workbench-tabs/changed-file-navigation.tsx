import type { CodeViewHandle } from "@pierre/diffs/react";
import { ChevronDown, ChevronUp } from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from "react";
import { matchesShortcut, shortcutAriaKeys, type ShortcutKeys } from "../../lib/keyboard-shortcuts";
import { Button } from "../ui/button";
import { ShortcutKbd } from "../ui/kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";

/**
 * Pane-local review keys. They only fire inside the focused review pane, so they are not
 * part of the rebindable app shortcut catalog; j and k match list navigation elsewhere.
 */
export const NEXT_FILE_KEYS: ShortcutKeys = ["J"];
export const PREVIOUS_FILE_KEYS: ShortcutKeys = ["K"];

/** Mark a subtree whose own keys must win (a file tree with type-ahead, for example). */
export const FILE_NAVIGATION_IGNORE_ATTRIBUTE = "data-file-navigation-ignore";

const TYPING_SELECTOR =
  "input, textarea, select, [contenteditable=''], [contenteditable='true'], [contenteditable='plaintext-only']";
const OWNED_KEYS_SELECTOR = `[role="menu"], [role="listbox"], [role="dialog"], [role="alertdialog"], [role="tree"], [role="combobox"], [${FILE_NAVIGATION_IGNORE_ATTRIBUTE}]`;

/**
 * The file step a key press asks for: 1 for next, -1 for previous, 0 otherwise. Typing
 * targets, popups, trees, and a live text selection keep their own keys.
 */
export function fileNavigationStep(event: KeyboardEvent): -1 | 0 | 1 {
  if (event.defaultPrevented) return 0;
  const step = matchesShortcut(event, NEXT_FILE_KEYS)
    ? 1
    : matchesShortcut(event, PREVIOUS_FILE_KEYS)
      ? -1
      : 0;
  if (step === 0) return 0;
  // Shadow DOM (the file tree) retargets `event.target`; the composed path keeps the origin.
  const path = typeof event.composedPath === "function" ? event.composedPath() : [];
  const elements = (path.length > 0 ? path : [event.target]).filter(
    (node): node is Element => node instanceof Element,
  );
  for (const element of elements) {
    if (element instanceof HTMLElement && element.isContentEditable) return 0;
    if (element.matches(TYPING_SELECTOR) || element.matches(OWNED_KEYS_SELECTOR)) return 0;
  }
  const selection = elements[0]?.ownerDocument.getSelection() ?? null;
  if (selection && !selection.isCollapsed && selection.toString().length > 0) return 0;
  return step;
}

interface ScrollViewer {
  getTopForItem(id: string): number | undefined;
  getHeight(): number;
  getScrollHeight(): number;
}

/** The file whose header sits at (or last passed) the top of the review scroller. */
export function fileAtScrollTop(
  ids: readonly string[],
  viewer: ScrollViewer,
  scrollTop: number,
  offset: number,
): string | null {
  if (ids.length === 0) return null;
  // Short trailing files never reach the top; the end of the list counts as the last file.
  if (scrollTop > 0 && scrollTop + viewer.getHeight() >= viewer.getScrollHeight() - 2)
    return ids.at(-1) ?? null;
  const threshold = scrollTop + offset + 2;
  let low = 0;
  let high = ids.length - 1;
  let found = 0;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const top = viewer.getTopForItem(ids[middle]!);
    if (top === undefined) return ids[found] ?? null;
    if (top <= threshold) {
      found = middle;
      low = middle + 1;
    } else high = middle - 1;
  }
  return ids[found] ?? null;
}

const PENDING_SCROLL_MS = 1_200;

export interface ChangedFileNavigation {
  /** Zero-based position of the current file, or -1 without files. */
  index: number;
  total: number;
  canPrevious: boolean;
  canNext: boolean;
  goTo(id: string): void;
  previous(): void;
  next(): void;
  onKeyDown(event: ReactKeyboardEvent): void;
  onScroll(scrollTop: number, viewer: ScrollViewer): void;
}

/**
 * Previous/next changed-file navigation over a CodeView, reusing its item scrolling. The
 * position follows manual scrolling, and a programmatic jump holds its target until the
 * scroller arrives so the counter does not flicker through the files it passes.
 */
export function useChangedFileNavigation({
  ids,
  codeView,
  scrollOffset = 0,
}: {
  ids: readonly string[];
  codeView: RefObject<Pick<CodeViewHandle<undefined, undefined>, "scrollTo"> | null>;
  /** The same offset the surface uses for its other item scrolls. */
  scrollOffset?: number;
}): ChangedFileNavigation {
  const [currentID, setCurrentID] = useState<string | null>(null);
  const pending = useRef<{ id: string; until: number } | null>(null);
  const found = currentID === null ? -1 : ids.indexOf(currentID);
  const index = ids.length === 0 ? -1 : Math.max(found, 0);

  useEffect(() => {
    if (pending.current && !ids.includes(pending.current.id)) pending.current = null;
  }, [ids]);

  const goTo = useCallback(
    (id: string) => {
      pending.current = { id, until: performance.now() + PENDING_SCROLL_MS };
      setCurrentID(id);
      codeView.current?.scrollTo({
        type: "item",
        id,
        align: "start",
        offset: scrollOffset,
        behavior: "smooth-auto",
      });
    },
    [codeView, scrollOffset],
  );

  const stepTo = useCallback(
    (delta: -1 | 1): string | null => {
      if (index < 0) return null;
      return ids[index + delta] ?? null;
    },
    [ids, index],
  );

  const previous = useCallback(() => {
    const id = stepTo(-1);
    if (id) goTo(id);
  }, [goTo, stepTo]);
  const next = useCallback(() => {
    const id = stepTo(1);
    if (id) goTo(id);
  }, [goTo, stepTo]);

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent) => {
      const delta = fileNavigationStep(event.nativeEvent);
      if (delta === 0) return;
      const id = stepTo(delta);
      // At either end the key still belongs to the pane; nothing else should act on it.
      event.preventDefault();
      if (id) goTo(id);
    },
    [goTo, stepTo],
  );

  const onScroll = useCallback(
    (scrollTop: number, viewer: ScrollViewer) => {
      const id = fileAtScrollTop(ids, viewer, scrollTop, scrollOffset);
      const target = pending.current;
      if (target) {
        if (id !== target.id && performance.now() < target.until) return;
        pending.current = null;
        if (id !== target.id) return;
      }
      setCurrentID(id);
    },
    [ids, scrollOffset],
  );

  return {
    index,
    total: ids.length,
    canPrevious: index > 0,
    canNext: index >= 0 && index < ids.length - 1,
    goTo,
    previous,
    next,
    onKeyDown,
    onScroll,
  };
}

/** Previous/next buttons around an "N of M" position, for a review toolbar. */
export function ChangedFileNavigationControls({
  navigation,
}: {
  navigation: ChangedFileNavigation;
}) {
  if (navigation.total === 0) return null;
  return (
    <div className="flex shrink-0 items-center" role="group" aria-label="File navigation">
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Previous file"
              aria-keyshortcuts={shortcutAriaKeys(PREVIOUS_FILE_KEYS)}
              disabled={!navigation.canPrevious}
              onClick={navigation.previous}
            />
          }
        >
          <ChevronUp />
        </TooltipTrigger>
        <TooltipContent>
          Previous file
          <ShortcutKbd keys={PREVIOUS_FILE_KEYS} />
        </TooltipContent>
      </Tooltip>
      <span
        className="hidden min-w-12 px-0.5 text-center font-mono text-diff text-muted-foreground tabular-nums @min-[30rem]/workbench:inline-block"
        data-file-position=""
      >
        {navigation.index + 1} of {navigation.total}
      </span>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Next file"
              aria-keyshortcuts={shortcutAriaKeys(NEXT_FILE_KEYS)}
              disabled={!navigation.canNext}
              onClick={navigation.next}
            />
          }
        >
          <ChevronDown />
        </TooltipTrigger>
        <TooltipContent>
          Next file
          <ShortcutKbd keys={NEXT_FILE_KEYS} />
        </TooltipContent>
      </Tooltip>
    </div>
  );
}
