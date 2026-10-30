import type { DiffsHighlighter } from "@pierre/diffs";
import { useAtomValue } from "jotai";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { resolvedAppearanceAtom } from "../atoms/appearance";
import { cn } from "../lib/cn";
import {
  highlightLanguage,
  loadCodeHighlighter,
  loadedCodeHighlighter,
  loadedZedTheme,
} from "../lib/code-highlighter";
import { StreamingCodeTokens } from "../lib/streaming-code-tokens";

const MAX_HIGHLIGHT_CACHE_ENTRIES = 128;
const MAX_SYNCHRONOUS_HIGHLIGHT_LENGTH = 16_384;
const STREAMING_HIGHLIGHT_INTERVAL_MS = 120;
const highlighted = new Map<string, RenderedHighlight>();

export interface CodeAnimationRange {
  start: number;
  end: number;
  delay: number;
  duration: number;
  startAt: number;
}

interface HighlightRequest {
  code: string;
  language: string;
  /** The code theme tokens are colored with; null renders plain text. */
  theme: string | null;
  animationRanges: readonly CodeAnimationRange[];
  lineNumbers: boolean;
  highlightLines: readonly number[];
}

interface RenderedHighlight {
  code: string;
  language: string;
  theme: string | null;
  normalizedLanguage: string;
  html: string;
  animationRanges: readonly CodeAnimationRange[];
  lineNumbers: boolean;
  highlightLines: readonly number[];
}

interface CodeToken {
  value: string;
  /** Inline CSS for the token's theme color and font style. */
  style?: string;
}

// Font style bits on Highlights tokens (the TextMate/VS Code convention).
const ITALIC = 1;
const BOLD = 2;

function tokenStyle(token: { color?: string; fontStyle?: number }): string | undefined {
  const parts = [
    ...(token.color ? [`color:${token.color}`] : []),
    ...(token.fontStyle && token.fontStyle & ITALIC ? ["font-style:italic"] : []),
    ...(token.fontStyle && token.fontStyle & BOLD ? ["font-weight:700"] : []),
  ];
  return parts.length ? parts.join(";") : undefined;
}

/** Tokens across the whole code, with newlines between lines, or one plain token. */
function codeTokens(request: HighlightRequest): CodeToken[] {
  const lang = request.language === "plaintext" ? null : request.language;
  const highlighter = request.theme ? loadedCodeHighlighter(request.theme) : undefined;
  if (!lang || !request.theme || !highlighter) return [{ value: request.code }];
  const { tokens } = highlighter.codeToTokens(request.code, { lang, theme: request.theme });
  const result: CodeToken[] = [];
  tokens.forEach((line, index) => {
    if (index > 0) result.push({ value: "\n" });
    for (const token of line) result.push({ value: token.content, style: tokenStyle(token) });
  });
  // Highlights can normalize line endings. Never lose raw characters to it.
  return result.map((token) => token.value).join("") === request.code
    ? result
    : [{ value: request.code }];
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/**
 * Tokens from the block's live tokenizer, which re-reads only the lines an append can
 * change. Null falls back to highlighting the whole block.
 */
function streamingTokens(
  request: HighlightRequest,
  stream: { current: StreamingCodeTokens | null },
): CodeToken[] | null {
  const lang = highlightLanguage(request.language);
  const zed = lang && request.theme ? loadedZedTheme(request.theme) : undefined;
  if (!lang || !request.theme || !zed) return null;
  if (stream.current?.language !== lang || stream.current.theme !== request.theme) {
    stream.current?.dispose();
    stream.current = new StreamingCodeTokens(lang, request.theme, zed);
  }
  return (
    stream.current.update(request.code)?.map((token) => ({
      value: token.value,
      style: tokenStyle(token),
    })) ?? null
  );
}

function renderHighlight(
  request: HighlightRequest,
  now: number,
  precomputed?: CodeToken[] | null,
): RenderedHighlight {
  const tokens = precomputed ?? codeTokens(request);
  let offset = 0;
  let rangeIndex = 0;
  const html: string[] = [];
  if (!request.lineNumbers && request.highlightLines.length === 0) {
    for (const token of tokens) {
      rangeIndex = renderToken(
        token.value,
        offset,
        token.style,
        request.animationRanges,
        rangeIndex,
        now,
        html,
      );
      offset += token.value.length;
    }
    return {
      code: request.code,
      language: request.language,
      theme: request.theme,
      normalizedLanguage: request.language,
      html: html.join(""),
      animationRanges: request.animationRanges,
      lineNumbers: request.lineNumbers,
      highlightLines: request.highlightLines,
    };
  }

  let lineHtml: string[] = [];
  let line = 1;
  const flushLine = () => {
    const highlighted = request.highlightLines.includes(line) ? " th-line--highlighted" : "";
    html.push(
      `<span class="th-line${highlighted}" data-line="${line}">${lineHtml.join("")}</span>`,
    );
    lineHtml = [];
    line += 1;
  };

  for (const token of tokens) {
    let partOffset = 0;
    for (const part of token.value.split(/(\n)/)) {
      if (part === "\n") {
        flushLine();
        partOffset += 1;
      } else if (part) {
        rangeIndex = renderToken(
          part,
          offset + partOffset,
          token.style,
          request.animationRanges,
          rangeIndex,
          now,
          lineHtml,
        );
        partOffset += part.length;
      }
    }
    offset += token.value.length;
  }
  flushLine();

  return {
    code: request.code,
    language: request.language,
    theme: request.theme,
    normalizedLanguage: request.language,
    html: html.join(""),
    animationRanges: request.animationRanges,
    lineNumbers: request.lineNumbers,
    highlightLines: request.highlightLines,
  };
}

function renderToken(
  value: string,
  offset: number,
  tokenStyle: string | undefined,
  animationRanges: readonly CodeAnimationRange[],
  initialRangeIndex: number,
  now: number,
  html: string[],
): number {
  const end = offset + value.length;
  let cursor = offset;
  let rangeIndex = initialRangeIndex;

  while (cursor < end) {
    const range = animationRanges[rangeIndex];
    if (!range || range.start >= end) {
      html.push(renderSegment(value.slice(cursor - offset), tokenStyle, null, now));
      cursor = end;
      break;
    }
    if (range.end <= cursor) {
      rangeIndex += 1;
      continue;
    }
    if (range.start > cursor) {
      const segmentEnd = Math.min(end, range.start);
      html.push(
        renderSegment(value.slice(cursor - offset, segmentEnd - offset), tokenStyle, null, now),
      );
      cursor = segmentEnd;
      continue;
    }

    const segmentEnd = Math.min(end, range.end);
    html.push(
      renderSegment(value.slice(cursor - offset, segmentEnd - offset), tokenStyle, range, now),
    );
    cursor = segmentEnd;
    if (range.end <= cursor) rangeIndex += 1;
  }

  return rangeIndex;
}

function renderSegment(
  value: string,
  tokenStyle: string | undefined,
  animationRange: CodeAnimationRange | null,
  now: number,
): string {
  let html = escapeHtml(value);
  const timing = animationRange ? animationTiming(animationRange, now) : null;
  if (timing) {
    html = `<span class="palot-markdown-stream-unit" data-markdown-stream-code="" data-markdown-stream-start-at="${animationRange!.startAt}" style="--palot-markdown-stream-delay:${timing.delay}ms;--palot-markdown-stream-duration:${timing.duration}ms">${html}</span>`;
  }
  if (tokenStyle) html = `<span class="th-token" style="${tokenStyle}">${html}</span>`;
  return html;
}

function animationTiming(
  range: CodeAnimationRange,
  now: number,
): { delay: number; duration: number } | null {
  const startAt = range.startAt > 0 ? range.startAt : now + range.delay;
  const delay = startAt - now;
  if (delay + range.duration <= 0) return null;
  return { delay, duration: range.duration };
}

function highlightKey(
  code: string,
  language: string,
  theme: string | null,
  lineNumbers: boolean,
  highlightLines: readonly number[],
): string {
  return `${theme ?? ""}\0${language}\0${lineNumbers ? "1" : "0"}\0${highlightLines.join(",")}\0${code}`;
}

function settledHighlight(
  code: string,
  language: string,
  theme: string | null,
  lineNumbers: boolean,
  highlightLines: readonly number[],
): RenderedHighlight {
  const key = highlightKey(code, language, theme, lineNumbers, highlightLines);
  const cached = highlighted.get(key);
  if (cached) return cached;

  if (highlighted.size >= MAX_HIGHLIGHT_CACHE_ENTRIES) {
    const oldest = highlighted.keys().next().value;
    if (oldest !== undefined) highlighted.delete(oldest);
  }

  const result = renderHighlight(
    { code, language, theme, animationRanges: [], lineNumbers, highlightLines },
    performance.now(),
  );
  highlighted.set(key, result);
  return result;
}

function useDeferredSettledHighlight(
  code: string,
  language: string,
  theme: string | null,
  lineNumbers: boolean,
  highlightLines: readonly number[],
  enabled: boolean,
): RenderedHighlight | null {
  const key = highlightKey(code, language, theme, lineNumbers, highlightLines);
  const cached = enabled ? highlighted.get(key) : null;
  const [result, setResult] = useState<RenderedHighlight | null>(null);
  const current =
    result?.code === code &&
    result.language === language &&
    result.theme === theme &&
    result.lineNumbers === lineNumbers &&
    sameNumbers(result.highlightLines, highlightLines)
      ? result
      : null;

  useEffect(() => {
    if (!enabled || cached || current) return;
    const timer = setTimeout(
      () => setResult(settledHighlight(code, language, theme, lineNumbers, highlightLines)),
      0,
    );
    return () => clearTimeout(timer);
  }, [cached, code, current, enabled, highlightLines, language, lineNumbers, theme]);

  return cached ?? current;
}

function useStreamingHighlight(
  request: HighlightRequest,
  enabled: boolean,
): RenderedHighlight | null {
  const latest = useRef(request);
  const [result, setResult] = useState<RenderedHighlight | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastHighlightAt = useRef(Number.NEGATIVE_INFINITY);
  const stream = useRef<StreamingCodeTokens | null>(null);

  useEffect(() => {
    latest.current = request;
    if (!enabled) {
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = null;
      // A settled block is highlighted whole; release the live tokenizer.
      stream.current?.dispose();
      stream.current = null;
      return;
    }
    if (
      (result?.code === request.code &&
        result.language === request.language &&
        result.theme === request.theme &&
        result.lineNumbers === request.lineNumbers &&
        sameNumbers(result.highlightLines, request.highlightLines) &&
        sameAnimationRanges(result.animationRanges, request.animationRanges)) ||
      timer.current !== null
    ) {
      return;
    }

    const appendOnly =
      result?.language === request.language &&
      result.theme === request.theme &&
      result.lineNumbers === request.lineNumbers &&
      sameNumbers(result.highlightLines, request.highlightLines) &&
      request.code.startsWith(result.code);
    const elapsed = performance.now() - lastHighlightAt.current;
    const delay = appendOnly ? Math.max(0, STREAMING_HIGHLIGHT_INTERVAL_MS - elapsed) : 0;
    timer.current = setTimeout(() => {
      timer.current = null;
      const target = latest.current;
      const now = performance.now();
      const next = renderHighlight(target, now, streamingTokens(target, stream));
      lastHighlightAt.current = now;
      setResult(next);
    }, delay);
  }, [
    enabled,
    request.animationRanges,
    request.code,
    request.highlightLines,
    request.language,
    request.lineNumbers,
    request.theme,
    result,
  ]);

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
      stream.current?.dispose();
      stream.current = null;
    },
    [],
  );

  return result;
}

function sameAnimationRanges(
  left: readonly CodeAnimationRange[],
  right: readonly CodeAnimationRange[],
): boolean {
  if (left === right) return true;
  if (left.length !== right.length) return false;
  return left.every((range, index) => {
    const candidate = right[index];
    return (
      candidate?.start === range.start &&
      candidate.end === range.end &&
      candidate.delay === range.delay &&
      candidate.duration === range.duration &&
      candidate.startAt === range.startAt
    );
  });
}

function sameNumbers(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function AnimatedTail({
  code,
  start,
  animationRanges,
}: {
  code: string;
  start: number;
  animationRanges: readonly CodeAnimationRange[];
}) {
  const children: ReactNode[] = [];
  let cursor = start;

  for (
    let index = firstAnimationRangeAfter(animationRanges, start);
    index < animationRanges.length;
    index += 1
  ) {
    const range = animationRanges[index]!;
    if (range.start >= code.length) break;
    const rangeStart = Math.max(start, range.start);
    const rangeEnd = Math.min(code.length, range.end);
    if (rangeEnd <= rangeStart || rangeEnd <= cursor) continue;
    if (rangeStart > cursor) children.push(code.slice(cursor, rangeStart));

    const value = code.slice(Math.max(cursor, rangeStart), rangeEnd);
    if (range.duration > 0) {
      children.push(
        <span
          key={`${range.start}:${range.end}:${range.startAt}`}
          className="palot-markdown-stream-unit"
          data-markdown-stream-code=""
          data-markdown-stream-start-at={range.startAt}
          style={
            {
              "--palot-markdown-stream-delay": `${range.delay}ms`,
              "--palot-markdown-stream-duration": `${range.duration}ms`,
            } as CSSProperties
          }
        >
          {value}
        </span>,
      );
    } else {
      children.push(value);
    }
    cursor = rangeEnd;
  }

  if (cursor < code.length) children.push(code.slice(cursor));
  return children;
}

function firstAnimationRangeAfter(ranges: readonly CodeAnimationRange[], offset: number): number {
  let low = 0;
  let high = ranges.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (ranges[middle]!.end <= offset) low = middle + 1;
    else high = middle;
  }
  return low;
}

/**
 * The code theme once the shared highlighter can color with it, or null while it loads.
 * Code renders as plain text until then and highlights in place when it is ready.
 */
function useReadyCodeTheme(theme: string): { theme: string | null; foreground?: string } {
  const [ready, setReady] = useState<DiffsHighlighter | null>(
    () => loadedCodeHighlighter(theme) ?? null,
  );
  const [readyTheme, setReadyTheme] = useState<string | null>(() =>
    loadedCodeHighlighter(theme) ? theme : null,
  );
  useEffect(() => {
    const loaded = loadedCodeHighlighter(theme);
    if (loaded) {
      setReady(loaded);
      setReadyTheme(theme);
      return;
    }
    let cancelled = false;
    void loadCodeHighlighter(theme).then(
      (highlighter) => {
        if (cancelled) return;
        setReady(highlighter);
        setReadyTheme(theme);
      },
      // An unavailable theme or highlighter leaves code readable as plain text.
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [theme]);
  if (readyTheme !== theme || !ready) return { theme: null };
  return { theme, foreground: ready.getTheme(theme).fg };
}

export function HighlightedCode({
  code,
  language,
  className,
  ariaLabel,
  streaming = false,
  animationRanges = [],
  lineNumbers = false,
  highlightLines = [],
  wrap = false,
}: {
  code: string;
  language: string;
  className?: string;
  ariaLabel?: string;
  streaming?: boolean;
  animationRanges?: readonly CodeAnimationRange[];
  lineNumbers?: boolean;
  highlightLines?: readonly number[];
  wrap?: boolean;
}) {
  const appearance = useAtomValue(resolvedAppearanceAtom);
  const { theme, foreground } = useReadyCodeTheme(appearance.codeThemePair[appearance.scheme]);
  const normalizedLanguage = highlightLanguage(language) ?? "plaintext";
  const request = useMemo<HighlightRequest>(
    () => ({
      code,
      language: normalizedLanguage,
      theme,
      animationRanges,
      lineNumbers,
      highlightLines,
    }),
    [animationRanges, code, highlightLines, lineNumbers, normalizedLanguage, theme],
  );
  const streamingResult = useStreamingHighlight(request, streaming);
  const reusableStreamingResult =
    streamingResult?.language === normalizedLanguage &&
    streamingResult.theme === theme &&
    streamingResult.lineNumbers === lineNumbers &&
    sameNumbers(streamingResult.highlightLines, highlightLines) &&
    code.startsWith(streamingResult.code)
      ? streamingResult
      : null;
  const completeStreamingResult =
    !streaming && reusableStreamingResult?.code.length === code.length
      ? reusableStreamingResult
      : null;
  const synchronousSettledResult = useMemo(
    () =>
      !streaming && !completeStreamingResult && code.length <= MAX_SYNCHRONOUS_HIGHLIGHT_LENGTH
        ? settledHighlight(code, normalizedLanguage, theme, lineNumbers, highlightLines)
        : null,
    [
      code,
      completeStreamingResult,
      highlightLines,
      lineNumbers,
      normalizedLanguage,
      streaming,
      theme,
    ],
  );
  const deferredSettledResult = useDeferredSettledHighlight(
    code,
    normalizedLanguage,
    theme,
    lineNumbers,
    highlightLines,
    !streaming &&
      ((!completeStreamingResult && code.length > MAX_SYNCHRONOUS_HIGHLIGHT_LENGTH) ||
        (completeStreamingResult?.animationRanges.length ?? 0) > 0),
  );
  const prefix =
    synchronousSettledResult ??
    deferredSettledResult ??
    completeStreamingResult ??
    reusableStreamingResult;
  const prefixLength = prefix?.code.length ?? 0;
  const themeStyle = useMemo(
    () => (foreground ? ({ "--code-highlight-fg": foreground } as CSSProperties) : undefined),
    [foreground],
  );

  return (
    <div className={cn("code-highlight", className)} style={themeStyle}>
      <pre
        aria-label={ariaLabel}
        style={wrap ? { whiteSpace: "pre-wrap", overflowWrap: "anywhere" } : undefined}
        className={`th-code th-code--${prefix?.normalizedLanguage ?? normalizedLanguage}`}
        data-language={prefix?.normalizedLanguage ?? normalizedLanguage}
        data-line-numbers={lineNumbers ? "true" : undefined}
      >
        <code style={wrap ? { whiteSpace: "pre-wrap" } : undefined}>
          {prefix ? <span dangerouslySetInnerHTML={{ __html: prefix.html }} /> : null}
          {streaming && prefixLength < code.length ? (
            <AnimatedTail code={code} start={prefixLength} animationRanges={animationRanges} />
          ) : !streaming && prefixLength < code.length ? (
            code.slice(prefixLength)
          ) : null}
        </code>
      </pre>
    </div>
  );
}
