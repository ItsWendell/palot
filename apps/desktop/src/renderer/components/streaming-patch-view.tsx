import { useVirtualizer } from "@tanstack/react-virtual";
import type { DiffsThemeNames } from "@pierre/diffs";
import { useAtomValue } from "jotai";
import { ArrowDown, Check, Copy, FileCode2 } from "lucide-react";
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useClipboardCopy } from "../hooks/use-clipboard-copy";
import { resolvedAppearanceAtom } from "../atoms/appearance";
import type { StreamingPatchDocument } from "../lib/streaming-patch-input";
import {
  getPatchSections,
  highlightPatchPage,
  type PatchHighlight,
  type PatchLine,
  type PatchPage,
  type PatchSection,
} from "../lib/patch-presentation";
import { pierreViewerStyle } from "./file-viewer-theme";
import { IconButton } from "./ui";
import { Button } from "./ui/button";

const STREAM_REFRESH_MS = 120;

/** Sample presentation, never the retained input or the value copied to the clipboard. */
function usePatchSnapshot(document: StreamingPatchDocument, streaming: boolean) {
  const [snapshot, setSnapshot] = useState(document);
  const latest = useRef(document);

  useEffect(() => {
    latest.current = document;
  }, [document]);

  useEffect(() => {
    if (!streaming) return;
    const timer = setInterval(() => setSnapshot(latest.current), STREAM_REFRESH_MS);
    return () => clearInterval(timer);
  }, [streaming]);

  return streaming ? snapshot : document;
}

export function StreamingPatchView({
  document,
  streaming,
  review,
}: {
  document: StreamingPatchDocument;
  streaming: boolean;
  review?: ReactNode;
}) {
  // A live reader keeps their place when the tool settles. Historical tools open
  // on the richer review, with the original patch still available in one click.
  const [showPatch, setShowPatch] = useState(() => !review);
  const { copiedKey, copy } = useClipboardCopy();
  const patchVisible = streaming || !review || showPatch;
  const snapshot = usePatchSnapshot(document, streaming && patchVisible);
  const sections = useMemo(() => getPatchSections(snapshot), [snapshot]);

  return (
    <div
      data-palot-streaming-patch=""
      className="flex min-w-0 flex-col gap-2"
      style={pierreViewerStyle}
    >
      <header className="flex h-7 items-center gap-2 text-micro text-muted-foreground">
        <span className="min-w-0 flex-1 tabular-nums">
          {patchVisible
            ? `${sections.length} ${sections.length === 1 ? "file" : "files"}`
            : "Applied changes"}
        </span>
        {review && !streaming ? (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={() => setShowPatch(!patchVisible)}
          >
            {patchVisible ? "Show applied diff" : "Show proposed changes"}
          </Button>
        ) : null}
        <IconButton
          label={copiedKey ? "Copied full patch" : "Copy full patch"}
          size="icon-xs"
          onClick={() => void copy(document.text)}
        >
          {copiedKey ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
        </IconButton>
      </header>
      {patchVisible ? (
        sections.length > 0 ? (
          sections.map((section) => (
            <section
              key={section.id}
              data-patch-file={section.file}
              className="min-w-0 overflow-hidden rounded-lg border bg-card"
            >
              <header className="flex h-7 items-center gap-1.5 bg-muted/20 px-2 text-micro text-muted-foreground">
                <FileCode2 className="size-3 shrink-0" aria-hidden="true" />
                <span
                  className="min-w-0 flex-1 truncate font-mono"
                  title={
                    section.previousFile
                      ? `${section.previousFile} → ${section.file}`
                      : section.file
                  }
                >
                  {section.previousFile
                    ? `${section.previousFile} → ${section.file}`
                    : section.file}
                </span>
                {section.operation !== "update" ? (
                  <span>{section.operation === "add" ? "Added" : "Deleted"}</span>
                ) : null}
                {section.additions > 0 || section.deletions > 0 ? (
                  <>
                    <span className="tabular-nums text-success/80">+{section.additions}</span>
                    <span className="tabular-nums text-destructive/80">−{section.deletions}</span>
                  </>
                ) : null}
              </header>
              {section.lineCount > 0 ? (
                <PatchLines section={section} />
              ) : (
                <div className="border-t px-3 py-2 text-micro text-muted-foreground">
                  {section.operation === "delete"
                    ? "File deleted"
                    : streaming
                      ? "Waiting for changes…"
                      : "No changed lines"}
                </div>
              )}
            </section>
          ))
        ) : (
          <div className="text-micro text-muted-foreground">
            {streaming ? "Preparing changes…" : "No file changes in this patch"}
          </div>
        )
      ) : (
        review
      )}
    </div>
  );
}

const PatchLines = memo(function PatchLines({ section }: { section: PatchSection }) {
  "use no memo"; // TanStack Virtual owns mutable measurements; do not compiler-cache its methods.
  const viewportRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const lineSizerRef = useRef<HTMLDivElement>(null);
  const followingRef = useRef(true);
  const lastScrollTop = useRef(0);
  const [following, setFollowing] = useState(true);
  const [lineHeight, setLineHeight] = useState(18);
  const appearance = useAtomValue(resolvedAppearanceAtom);
  const font = `${appearance.codeFontFamily}:${appearance.preferences.codeFontSize}`;
  const [contentWidth, setContentWidth] = useState({ font, width: 0 });
  const theme = appearance.codeThemePair[appearance.scheme];
  const count = section.lineCount;
  // Intentionally compiler-opted-out above: virtualizer measurements remain live.
  // eslint-disable-next-line react-hooks-compiler/incompatible-library
  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => viewportRef.current,
    estimateSize: () => lineHeight,
    overscan: 8,
    useFlushSync: false,
  });
  const items = virtualizer.getVirtualItems();
  const pages = useMemo(
    () => [
      ...new Set(
        items.flatMap((item) => {
          const entry = section.getLine(item.index);
          return entry?.kind === "code" ? [entry.page] : [];
        }),
      ),
    ],
    [items, section],
  );
  const highlights = usePatchHighlights(pages, theme);
  const numberDigits = items.reduce((digits, item) => {
    const entry = section.getLine(item.index);
    return entry?.kind === "code" && entry.lineNumber !== undefined
      ? Math.max(digits, String(entry.lineNumber).length)
      : digits;
  }, 0);

  useLayoutEffect(() => {
    let width = 0;
    for (const row of canvasRef.current?.children ?? []) {
      if (!(row instanceof HTMLElement) || !row.hasAttribute("data-patch-line")) continue;
      const gutter = row.firstElementChild;
      const code = row.lastElementChild;
      if (gutter && code)
        width = Math.max(
          width,
          gutter.getBoundingClientRect().width + code.getBoundingClientRect().width,
        );
    }
    // Keep the horizontal canvas when its widest row scrolls out of the DOM.
    // Otherwise the browser clamps scrollLeft as vertical virtualization runs.
    setContentWidth((current) => {
      const next = Math.max(current.font === font ? current.width : 0, Math.ceil(width));
      return current.font === font && current.width === next ? current : { font, width: next };
    });
  }, [font, highlights, items, numberDigits]);

  const setFollow = useCallback((value: boolean) => {
    followingRef.current = value;
    setFollowing(value);
  }, []);
  const followBottom = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport || !followingRef.current) return;
    viewport.scrollTop = viewport.scrollHeight;
    lastScrollTop.current = viewport.scrollTop;
  }, []);

  useLayoutEffect(() => {
    const sizer = lineSizerRef.current;
    if (!sizer) return;
    const measure = () => {
      const height = sizer.getBoundingClientRect().height;
      if (height > 0) setLineHeight(height);
    };
    // The CSS line box is authoritative, including user font-size changes.
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(sizer);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    virtualizer.measure();
  }, [lineHeight, virtualizer]);

  useLayoutEffect(followBottom, [section, lineHeight, followBottom]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(followBottom);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [followBottom]);

  return (
    <div className="relative min-w-0">
      <div
        ref={viewportRef}
        role="region"
        aria-label={`Proposed changes for ${section.file}`}
        tabIndex={0}
        className="palot-native-scrollbar relative overflow-auto overscroll-contain border-t bg-(--code-background) font-mono text-diff outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
        style={{
          height: Math.min(Math.max(count, 1), 20) * lineHeight,
          lineHeight: "var(--diffs-line-height)",
          overflowAnchor: "none",
        }}
        onWheel={(event) => {
          if (event.deltaY < 0) setFollow(false);
        }}
        onKeyDown={(event) => {
          if (
            ["ArrowUp", "PageUp", "Home"].includes(event.key) ||
            (event.key === " " && event.shiftKey)
          ) {
            setFollow(false);
          }
        }}
        onScroll={(event) => {
          const viewport = event.currentTarget;
          const top = viewport.scrollTop;
          const atBottom = viewport.scrollHeight - viewport.clientHeight - top <= 2;
          if (atBottom) setFollow(true);
          else if (top < lastScrollTop.current - 1) setFollow(false);
          lastScrollTop.current = top;
        }}
      >
        <div
          ref={lineSizerRef}
          aria-hidden="true"
          className="pointer-events-none invisible absolute"
          style={{ height: "1lh" }}
        />
        <div
          ref={canvasRef}
          className="relative min-w-full"
          style={{
            height: virtualizer.getTotalSize(),
            minWidth:
              contentWidth.font === font && contentWidth.width > 0 ? contentWidth.width : undefined,
          }}
        >
          {items.map((item) => {
            const entry = section.getLine(item.index);
            if (!entry) return null;
            if (entry.kind === "hunk")
              return (
                <div
                  key={item.key}
                  data-patch-hunk=""
                  className="absolute top-0 left-0 w-full truncate bg-muted px-2 font-sans text-micro text-muted-foreground"
                  style={{ height: lineHeight, transform: `translateY(${item.start}px)` }}
                >
                  {entry.label}
                </div>
              );
            const { line, page, index } = entry;
            const highlight = highlights?.get(page);
            const tokens = highlight?.lines[index];
            const colors = patchLineColors(line.kind);
            return (
              <div
                key={item.key}
                data-patch-line={entry.sourceLine}
                data-patch-kind={line.kind}
                className="absolute top-0 left-0 flex w-max min-w-full whitespace-pre"
                style={{
                  height: lineHeight,
                  transform: `translateY(${item.start}px)`,
                  background: colors.background,
                }}
              >
                <span
                  className="sticky left-0 z-1 flex shrink-0 tabular-nums"
                  style={{ color: colors.gutterForeground, background: colors.gutterBackground }}
                >
                  <span
                    aria-hidden="true"
                    className="px-2 text-right select-none"
                    style={{
                      width: numberDigits ? `calc(${Math.max(3, numberDigits)}ch + 1rem)` : "1ch",
                      paddingInline: numberDigits ? undefined : 0,
                    }}
                    title={
                      line.kind === "addition"
                        ? "Added line"
                        : line.kind === "deletion"
                          ? "Removed line"
                          : undefined
                    }
                  >
                    {entry.lineNumber}
                  </span>
                </span>
                <span data-patch-code="" className="px-2" style={{ color: highlight?.foreground }}>
                  {tokens
                    ? tokens.map((token, tokenIndex) => (
                        <span key={tokenIndex} data-patch-token="" style={patchTokenStyle(token)}>
                          {token.content}
                        </span>
                      ))
                    : line.code || "\u00a0"}
                </span>
              </div>
            );
          })}
        </div>
      </div>
      {!following ? (
        <div className="flex justify-end border-t bg-muted/20 px-2 py-1">
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={() => {
              setFollow(true);
              followBottom();
            }}
          >
            <ArrowDown data-icon="inline-start" aria-hidden="true" />
            Follow changes
          </Button>
        </div>
      ) : null}
    </div>
  );
});

function usePatchHighlights(pages: readonly PatchPage[], theme: DiffsThemeNames) {
  const [result, setResult] = useState<{
    theme: DiffsThemeNames;
    pages: Map<PatchPage, PatchHighlight>;
  }>();
  useEffect(() => {
    if (pages.length === 0) return;
    let cancelled = false;
    // Only pages intersecting the virtual window are tokenized. A failed grammar
    // load leaves the exact source visible rather than hiding the patch.
    void Promise.all(
      pages.map(async (page) => {
        try {
          return [page, await highlightPatchPage(page, theme)] as const;
        } catch {
          return null;
        }
      }),
    ).then((entries) => {
      if (!cancelled)
        setResult({ theme, pages: new Map(entries.filter((entry) => entry !== null)) });
    });
    return () => {
      cancelled = true;
    };
  }, [pages, theme]);
  return result?.theme === theme ? result.pages : undefined;
}

function patchTokenStyle(token: PatchHighlight["lines"][number][number]): CSSProperties {
  const style = Math.max(0, token.fontStyle ?? 0);
  return {
    color: token.color,
    fontStyle: style & 1 ? "italic" : undefined,
    fontWeight: style & 2 ? "bold" : undefined,
    textDecoration: style & 4 ? "underline" : undefined,
  };
}

function patchLineColors(kind: PatchLine["kind"]) {
  if (kind === "addition" || kind === "deletion") {
    return {
      background: `var(--diffs-bg-${kind}-override)`,
      gutterBackground: `var(--diffs-bg-${kind}-number-override)`,
      gutterForeground: `var(--diffs-${kind}-color-override)`,
    };
  }
  return {
    background:
      kind === "metadata"
        ? "var(--diffs-bg-separator-override)"
        : "var(--diffs-bg-context-override)",
    gutterBackground: "var(--diffs-bg-context-gutter-override)",
    gutterForeground: "var(--diffs-fg-number-override)",
  };
}
