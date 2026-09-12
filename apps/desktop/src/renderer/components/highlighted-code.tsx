import {
  escapeHtml,
  normalizeLanguage,
  tokenize,
  type HighlightTokenClass,
} from "@tanstack/highlight";
import { useAtomValue } from "jotai";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { AppearanceTerminalPalette } from "../../shared";
import { resolvedAppearanceAtom } from "../atoms/appearance";
import { cn } from "../lib/cn";

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
  animationRanges: readonly CodeAnimationRange[];
  lineNumbers: boolean;
  highlightLines: readonly number[];
}

interface RenderedHighlight {
  code: string;
  language: string;
  normalizedLanguage: string;
  html: string;
  animationRanges: readonly CodeAnimationRange[];
  lineNumbers: boolean;
  highlightLines: readonly number[];
}

type HighlightThemeStyle = CSSProperties & Record<`--th-${string}`, string>;

function renderHighlight(request: HighlightRequest, now: number): RenderedHighlight {
  const result = tokenize(request.code, { lang: request.language });
  let offset = 0;
  let rangeIndex = 0;
  const html: string[] = [];
  if (!request.lineNumbers && request.highlightLines.length === 0) {
    for (const token of result.tokens) {
      rangeIndex = renderToken(
        token.value,
        offset,
        token.className,
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
      normalizedLanguage: result.lang,
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

  for (const token of result.tokens) {
    let partOffset = 0;
    for (const part of token.value.split(/(\n)/)) {
      if (part === "\n") {
        flushLine();
        partOffset += 1;
      } else if (part) {
        rangeIndex = renderToken(
          part,
          offset + partOffset,
          token.className,
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
    normalizedLanguage: result.lang,
    html: html.join(""),
    animationRanges: request.animationRanges,
    lineNumbers: request.lineNumbers,
    highlightLines: request.highlightLines,
  };
}

function renderToken(
  value: string,
  offset: number,
  tokenClass: HighlightTokenClass | undefined,
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
      html.push(renderSegment(value.slice(cursor - offset), tokenClass, null, now));
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
        renderSegment(value.slice(cursor - offset, segmentEnd - offset), tokenClass, null, now),
      );
      cursor = segmentEnd;
      continue;
    }

    const segmentEnd = Math.min(end, range.end);
    html.push(
      renderSegment(value.slice(cursor - offset, segmentEnd - offset), tokenClass, range, now),
    );
    cursor = segmentEnd;
    if (range.end <= cursor) rangeIndex += 1;
  }

  return rangeIndex;
}

function renderSegment(
  value: string,
  tokenClass: HighlightTokenClass | undefined,
  animationRange: CodeAnimationRange | null,
  now: number,
): string {
  let html = escapeHtml(value);
  const timing = animationRange ? animationTiming(animationRange, now) : null;
  if (timing) {
    html = `<span class="palot-markdown-stream-unit" data-markdown-stream-code="" data-markdown-stream-start-at="${animationRange!.startAt}" style="--palot-markdown-stream-delay:${timing.delay}ms;--palot-markdown-stream-duration:${timing.duration}ms">${html}</span>`;
  }
  if (tokenClass) html = `<span class="th-token th-${tokenClass}">${html}</span>`;
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

function settledHighlight(
  code: string,
  language: string,
  lineNumbers: boolean,
  highlightLines: readonly number[],
): RenderedHighlight {
  const normalizedLanguage = normalizeLanguage(language);
  const key = `${normalizedLanguage}\0${lineNumbers ? "1" : "0"}\0${highlightLines.join(",")}\0${code}`;
  const cached = highlighted.get(key);
  if (cached) return cached;

  if (highlighted.size >= MAX_HIGHLIGHT_CACHE_ENTRIES) {
    const oldest = highlighted.keys().next().value;
    if (oldest !== undefined) highlighted.delete(oldest);
  }

  const result = renderHighlight(
    { code, language: normalizedLanguage, animationRanges: [], lineNumbers, highlightLines },
    performance.now(),
  );
  highlighted.set(key, result);
  return result;
}

function useDeferredSettledHighlight(
  code: string,
  language: string,
  lineNumbers: boolean,
  highlightLines: readonly number[],
  enabled: boolean,
): RenderedHighlight | null {
  const key = `${language}\0${lineNumbers ? "1" : "0"}\0${highlightLines.join(",")}\0${code}`;
  const cached = enabled ? highlighted.get(key) : null;
  const [result, setResult] = useState<RenderedHighlight | null>(null);
  const current =
    result?.code === code &&
    result.language === language &&
    result.lineNumbers === lineNumbers &&
    sameNumbers(result.highlightLines, highlightLines)
      ? result
      : null;

  useEffect(() => {
    if (!enabled || cached || current) return;
    const timer = setTimeout(
      () => setResult(settledHighlight(code, language, lineNumbers, highlightLines)),
      0,
    );
    return () => clearTimeout(timer);
  }, [cached, code, current, enabled, highlightLines, language, lineNumbers]);

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

  useEffect(() => {
    latest.current = request;
    if (!enabled) {
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = null;
      return;
    }
    if (
      (result?.code === request.code &&
        result.language === request.language &&
        result.lineNumbers === request.lineNumbers &&
        sameNumbers(result.highlightLines, request.highlightLines) &&
        sameAnimationRanges(result.animationRanges, request.animationRanges)) ||
      timer.current !== null
    ) {
      return;
    }

    const appendOnly =
      result?.language === request.language &&
      result.lineNumbers === request.lineNumbers &&
      sameNumbers(result.highlightLines, request.highlightLines) &&
      request.code.startsWith(result.code);
    const elapsed = performance.now() - lastHighlightAt.current;
    const delay = appendOnly ? Math.max(0, STREAMING_HIGHLIGHT_INTERVAL_MS - elapsed) : 0;
    timer.current = setTimeout(() => {
      timer.current = null;
      const target = latest.current;
      const now = performance.now();
      const next = renderHighlight(target, now);
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
    result,
  ]);

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
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

function highlightThemeStyle(palette: AppearanceTerminalPalette): HighlightThemeStyle {
  return {
    "--th-background": "var(--code-background)",
    "--th-token": palette.foreground,
    "--th-attr": palette.brightBlue,
    "--th-code-inline": palette.brightYellow,
    "--th-command": palette.brightCyan,
    "--th-comment": palette.brightBlack,
    "--th-deleted": palette.red,
    "--th-function": palette.brightBlue,
    "--th-heading": palette.brightMagenta,
    "--th-inserted": palette.green,
    "--th-keyword": palette.magenta,
    "--th-link": palette.blue,
    "--th-literal": palette.cyan,
    "--th-meta": palette.brightBlack,
    "--th-number": palette.yellow,
    "--th-operator": palette.brightMagenta,
    "--th-property": palette.brightCyan,
    "--th-selector": palette.green,
    "--th-string": palette.brightGreen,
    "--th-tag": palette.red,
    "--th-type": palette.brightYellow,
    "--th-variable": palette.brightRed,
  };
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

export function HighlightedCode({
  code,
  language,
  className,
  ariaLabel,
  streaming = false,
  animationRanges = [],
  lineNumbers = false,
  highlightLines = [],
}: {
  code: string;
  language: string;
  className?: string;
  ariaLabel?: string;
  streaming?: boolean;
  animationRanges?: readonly CodeAnimationRange[];
  lineNumbers?: boolean;
  highlightLines?: readonly number[];
}) {
  const appearance = useAtomValue(resolvedAppearanceAtom);
  const normalizedLanguage = normalizeLanguage(language);
  const request = useMemo<HighlightRequest>(
    () => ({
      code,
      language: normalizedLanguage,
      animationRanges,
      lineNumbers,
      highlightLines,
    }),
    [animationRanges, code, highlightLines, lineNumbers, normalizedLanguage],
  );
  const streamingResult = useStreamingHighlight(request, streaming);
  const reusableStreamingResult =
    streamingResult?.language === normalizedLanguage &&
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
        ? settledHighlight(code, normalizedLanguage, lineNumbers, highlightLines)
        : null,
    [code, completeStreamingResult, highlightLines, lineNumbers, normalizedLanguage, streaming],
  );
  const deferredSettledResult = useDeferredSettledHighlight(
    code,
    normalizedLanguage,
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
  const themeStyle = useMemo(() => highlightThemeStyle(appearance.terminal), [appearance.terminal]);

  return (
    <div className={cn("tanstack-highlight", className)} style={themeStyle}>
      <pre
        aria-label={ariaLabel}
        className={`th-code th-code--${prefix?.normalizedLanguage ?? normalizedLanguage}`}
        data-language={prefix?.normalizedLanguage ?? normalizedLanguage}
        data-line-numbers={lineNumbers ? "true" : undefined}
      >
        <code>
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
