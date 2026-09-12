import {
  memo,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { TranscriptPrompt } from "../lib/transcript-outline";

const PITCH = 10;
const OVERSCAN = 4;

export interface TranscriptRailProps {
  prompts: readonly TranscriptPrompt[];
  activeMessageID: string | null;
  onSelect(messageID: string): void;
  earlier: { available: boolean; loading: boolean; load(): Promise<boolean> };
  height: number;
  /** Reveal on hover of the rail (or its group/transcript-rail edge area) and keyboard focus. */
  compact?: boolean;
}

/** Ordinal navigation only. The transcript owns reveal, history, and current-position tracking. */
export function TranscriptRail(props: TranscriptRailProps) {
  // Streaming parents may supply new closures without changing any rail data.
  const callbacks = useRef({ onSelect: props.onSelect, load: props.earlier.load });
  useLayoutEffect(() => {
    callbacks.current = { onSelect: props.onSelect, load: props.earlier.load };
  }, [props.onSelect, props.earlier.load]);
  const forwarding = useMemo(
    () => ({
      onSelect: (messageID: string) => callbacks.current.onSelect(messageID),
      load: () => callbacks.current.load(),
    }),
    [],
  );
  const earlier = useMemo(
    () => ({
      available: props.earlier.available,
      loading: props.earlier.loading,
      load: forwarding.load,
    }),
    [props.earlier.available, props.earlier.loading, forwarding],
  );
  if (props.prompts.length < 4 || props.height < PITCH) return null;
  return <PromptRail {...props} onSelect={forwarding.onSelect} earlier={earlier} />;
}

const PromptRail = memo(function PromptRail({
  prompts,
  activeMessageID,
  onSelect,
  earlier,
  height,
  compact = false,
}: TranscriptRailProps) {
  const id = useId();
  const viewport = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [focused, setFocused] = useState(false);
  const [focusWithin, setFocusWithin] = useState(false);
  const [hovering, setHovering] = useState(false);
  const [hoveredID, setHoveredID] = useState<string | null>(null);
  const [selectedID, setSelectedID] = useState<string | null>(null);
  const [previewID, setPreviewID] = useState<string | null>(null);
  const [dismissedID, setDismissedID] = useState<string | null>(null);
  const indices = useMemo(
    () => new Map(prompts.map((prompt, index) => [prompt.messageID, index])),
    [prompts],
  );
  const listHeight = Math.max(PITCH, height - (earlier.available ? 28 : 0));
  const count = prompts.length;
  const activeIndex = indices.get(activeMessageID ?? "");
  const selectedIndex = indices.get(selectedID ?? "") ?? indices.get(activeMessageID ?? "") ?? 0;
  // The outer component admits at least four prompts; map indices refer to this array.
  const focusedID = prompts[selectedIndex]!.messageID;
  const candidateID = hoveredID ?? (focused ? focusedID : null);
  const previousPrompts = useRef(prompts);

  const moveViewport = useCallback(
    (top: number) => {
      const next = Math.max(0, Math.min(top, count * PITCH - listHeight));
      if (viewport.current && viewport.current.scrollTop !== next)
        viewport.current.scrollTop = next;
      // Keep the virtual marker window in sync with the imperative scroll before
      // paint; waiting for the browser scroll event can expose unmounted markers.
      setScrollTop(next);
    },
    [count, listHeight],
  );

  function reveal(index: number) {
    const top = viewport.current?.scrollTop ?? scrollTop;
    if (index * PITCH < top) moveViewport(index * PITCH);
    else if ((index + 1) * PITCH > top + listHeight) {
      moveViewport((index + 1) * PITCH - listHeight);
    }
  }

  // Retain the old top marker and its fractional offset, not its now-shifted index.
  useLayoutEffect(() => {
    const previous = previousPrompts.current;
    previousPrompts.current = prompts;
    if (previous === prompts) return;
    const top = viewport.current?.scrollTop ?? 0;
    const anchor = previous[Math.floor(top / PITCH)];
    const nextIndex = anchor && indices.get(anchor.messageID);
    moveViewport(nextIndex === undefined ? top : nextIndex * PITCH + (top % PITCH));
  }, [prompts, indices, moveViewport]);

  useLayoutEffect(() => {
    if (hovering || focusWithin || activeIndex === undefined) return;
    // Endpoints reveal the whole beginning/end, including when the tail grows.
    if (activeIndex === 0) moveViewport(0);
    else if (activeIndex === count - 1) moveViewport(count * PITCH - listHeight);
    else {
      const center = (activeIndex + 0.5) * PITCH;
      const top = viewport.current?.scrollTop ?? 0;
      // Follow in discrete steps, before the active marker reaches either fade.
      if (center < top + listHeight * 0.2 || center > top + listHeight * 0.8) {
        moveViewport(center - listHeight / 2);
      }
    }
    // Scalar geometry avoids following again on ordinary streaming parent renders.
  }, [activeIndex, count, listHeight, hovering, focusWithin, moveViewport]);

  useEffect(() => {
    setPreviewID(null);
    if (!candidateID || candidateID === dismissedID) return;
    const timer = setTimeout(() => setPreviewID(candidateID), 180);
    return () => clearTimeout(timer);
  }, [candidateID, dismissedID]);

  const start = Math.min(prompts.length, Math.max(0, Math.floor(scrollTop / PITCH) - OVERSCAN));
  const end = Math.min(prompts.length, Math.ceil((scrollTop + listHeight) / PITCH) + OVERSCAN);
  const mounted = Array.from({ length: end - start }, (_, index) => start + index);
  // An offscreen keyboard option stays mounted in the same commit as aria-activedescendant.
  if (focused && (selectedIndex < start || selectedIndex >= end)) mounted.push(selectedIndex);
  const previewIndex = indices.get(previewID ?? "");
  const preview = previewIndex === undefined ? null : prompts[previewIndex];
  const railHeight = Math.min(height, prompts.length * PITCH + (earlier.available ? 28 : 0));
  const fadeTop = Math.min(24, Math.max(0, scrollTop));
  const fadeBottom = Math.min(24, Math.max(0, prompts.length * PITCH - listHeight - scrollTop));
  const previewTop = Math.max(
    0,
    Math.min(
      railHeight - PITCH,
      (previewIndex ?? 0) * PITCH - scrollTop + (earlier.available ? 28 : 0),
    ),
  );
  const previewBelow = previewTop < railHeight / 2;
  const emphasizedIndex = indices.get(candidateID ?? activeMessageID ?? "");
  const optionID = (messageID: string) => `${id}-${messageID}`;

  return (
    <div
      className={`relative flex min-h-0 flex-col ${compact ? "w-4 rounded-sm bg-background opacity-0 transition-opacity duration-150 hover:opacity-100 focus-within:opacity-100 group-hover/transcript-rail:opacity-100 motion-reduce:transition-none" : "w-7"}`}
      style={{ maxHeight: height }}
      onFocus={() => setFocusWithin(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocusWithin(false);
      }}
      onPointerEnter={() => setHovering(true)}
      onPointerLeave={() => {
        setHovering(false);
        setHoveredID(null);
      }}
    >
      {earlier.available && (
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground focus-visible:ring-ring h-7 shrink-0 rounded-sm text-meta focus-visible:ring-2 disabled:opacity-50"
          aria-label={earlier.loading ? "Loading earlier prompts" : "Load earlier prompts"}
          title="Load earlier prompts"
          disabled={earlier.loading}
          onClick={() =>
            void earlier.load().catch(() => {
              /* Parent owns the history error. */
            })
          }
        >
          {earlier.loading ? "…" : "↑"}
        </button>
      )}
      {/* Keep the keyboard focus ring outside the overflow mask. */}
      <div className="min-h-0 rounded-sm focus-within:ring-1 focus-within:ring-ring">
        <div
          ref={viewport}
          role="listbox"
          aria-label="Prompt navigation"
          aria-activedescendant={focused ? optionID(focusedID) : undefined}
          aria-describedby={focused && previewID === focusedID ? `${id}-preview` : undefined}
          tabIndex={0}
          className="relative w-full overflow-y-auto overscroll-contain rounded-sm outline-none [scrollbar-width:none]"
          style={{
            height: Math.min(listHeight, prompts.length * PITCH),
            maskImage:
              fadeTop || fadeBottom
                ? `linear-gradient(to bottom, transparent, #000 ${fadeTop}px, #000 calc(100% - ${fadeBottom}px), transparent)`
                : undefined,
          }}
          onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
          onFocus={() => {
            setSelectedID(focusedID);
            setFocused(true);
          }}
          onBlur={() => {
            setFocused(false);
            setSelectedID(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setDismissedID(candidateID);
              setPreviewID(null);
              return;
            }
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onSelect(focusedID);
              return;
            }
            const next =
              event.key === "Home"
                ? 0
                : event.key === "End"
                  ? prompts.length - 1
                  : event.key === "ArrowDown"
                    ? Math.min(prompts.length - 1, selectedIndex + 1)
                    : event.key === "ArrowUp"
                      ? Math.max(0, selectedIndex - 1)
                      : null;
            if (next === null) return;
            event.preventDefault();
            setHoveredID(null);
            setDismissedID(null);
            setSelectedID(prompts[next]!.messageID);
            reveal(next);
          }}
        >
          <div className="relative" style={{ height: prompts.length * PITCH }}>
            {mounted.map((index) => {
              const prompt = prompts[index]!;
              const active = prompt.messageID === activeMessageID;
              const emphasized = index === emphasizedIndex;
              const neighbor =
                emphasizedIndex !== undefined && Math.abs(index - emphasizedIndex) === 1;
              return (
                <div
                  key={prompt.messageID}
                  id={optionID(prompt.messageID)}
                  role="option"
                  aria-label={prompt.label.slice(0, 240)}
                  aria-selected={focused ? prompt.messageID === focusedID : active}
                  aria-posinset={index + 1}
                  aria-setsize={prompts.length}
                  className="absolute inset-x-0 flex cursor-pointer items-center justify-center"
                  style={{ top: index * PITCH, height: PITCH }}
                  onPointerEnter={() => {
                    setHoveredID(prompt.messageID);
                    setDismissedID(null);
                  }}
                  onPointerLeave={() =>
                    setHoveredID((current) => (current === prompt.messageID ? null : current))
                  }
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    setSelectedID(prompt.messageID);
                    onSelect(prompt.messageID);
                  }}
                >
                  <span
                    aria-hidden="true"
                    className={`h-0.5 rounded-sm transition-[width,background-color] motion-reduce:transition-none ${active || emphasized ? "bg-foreground w-4" : neighbor ? "bg-muted-foreground w-3" : "bg-muted-foreground/50 w-2"}`}
                  />
                </div>
              );
            })}
          </div>
        </div>
      </div>
      {preview && (
        <div
          id={`${id}-preview`}
          role="tooltip"
          className="pointer-events-none absolute left-full z-50 ml-2 w-64 max-w-[60cqw] overflow-hidden rounded-md border bg-popover text-compact text-popover-foreground shadow-sm"
          style={
            previewBelow
              ? { top: previewTop, maxHeight: railHeight - previewTop }
              : { bottom: railHeight - previewTop - PITCH, maxHeight: previewTop + PITCH }
          }
        >
          <div className="p-3">
            <span className="line-clamp-3 whitespace-pre-wrap break-words">
              {preview.label.slice(0, 240)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
});
