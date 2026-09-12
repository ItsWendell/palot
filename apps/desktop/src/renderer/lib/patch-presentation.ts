import { getFiletypeFromFileName, getSharedHighlighter, type DiffsThemeNames } from "@pierre/diffs";
import { STREAMING_PATCH_PAGE_SIZE, type StreamingPatchDocument } from "./streaming-patch-input";

export interface PatchLine {
  readonly text: string;
  readonly code: string;
  readonly marker: "+" | "-" | " " | "";
  readonly kind: "addition" | "deletion" | "context" | "metadata";
  readonly file?: string;
}

export interface PatchPage {
  readonly lines: readonly PatchLine[];
}

export interface PatchHighlight {
  readonly lines: readonly (readonly {
    content: string;
    color?: string;
    fontStyle?: number;
  }[])[];
  readonly foreground?: string;
}

export type PatchSectionLine =
  | {
      kind: "code";
      page: PatchPage;
      index: number;
      line: PatchLine;
      lineNumber?: number;
      /** One-based line in the original patch, not the target file. */
      sourceLine: number;
    }
  | { kind: "hunk"; label: string };

export interface PatchSection {
  readonly id: string;
  readonly file: string;
  readonly previousFile?: string;
  readonly operation: "add" | "update" | "delete";
  readonly additions: number;
  readonly deletions: number;
  readonly lineCount: number;
  getLine(index: number): PatchSectionLine | undefined;
}

interface CodeRun {
  kind: "code";
  index: number;
  length: number;
  additions: number;
  deletions: number;
  /** Per-row advances in the two independent source streams. */
  oldOffsets: number[];
  newOffsets: number[];
}

type SectionEvent =
  | CodeRun
  | {
      kind: "file";
      index: number;
      file: string;
      operation: PatchSection["operation"];
      previousFile?: string;
    }
  | { kind: "move"; file: string }
  | { kind: "old" | "new"; index: number; file?: string }
  | { kind: "operation"; operation: PatchSection["operation"] }
  | { kind: "hunk"; label: string; oldLine?: number; newLine?: number }
  | { kind: "end" };

type SectionSpan =
  | {
      start: number;
      length: number;
      page: PatchPage;
      sourceStart: number;
      run: CodeRun;
      oldLine?: number;
      newLine?: number;
    }
  | { start: number; length: 1; label: string };

interface SectionBuilder {
  id: string;
  file: string;
  previousFile?: string;
  operation: PatchSection["operation"];
  additions: number;
  deletions: number;
  lineCount: number;
  oldLine?: number;
  newLine?: number;
  hasOldHeader?: boolean;
  spans: SectionSpan[];
}

const sectionEvents = new WeakMap<PatchPage, readonly SectionEvent[]>();
const sectionsCache = new WeakMap<StreamingPatchDocument, readonly PatchSection[]>();

function getSectionEvents(page: PatchPage): readonly SectionEvent[] {
  const cached = sectionEvents.get(page);
  if (cached) return cached;
  const events: SectionEvent[] = [];
  let run: CodeRun | undefined;
  page.lines.forEach((line, index) => {
    if (line.kind !== "metadata") {
      if (!run) {
        run = {
          kind: "code",
          index,
          length: 0,
          additions: 0,
          deletions: 0,
          oldOffsets: [],
          newOffsets: [],
        };
        events.push(run);
      }
      run.oldOffsets.push(run.length - run.additions);
      run.newOffsets.push(run.length - run.deletions);
      run.length++;
      if (line.kind === "addition") run.additions++;
      if (line.kind === "deletion") run.deletions++;
      return;
    }
    run = undefined;
    const text = line.text.trimEnd();
    const native = text.match(/^\*\*\* (Add|Update|Delete) File: (.+)$/);
    const move = text.match(/^\*\*\* Move to: (.+)$/);
    const git = text.match(/^diff --git (?:"a\/(.*?)"|a\/(.*?)) (?:"b\/(.*?)"|b\/(.*))$/);
    const named = text.match(/^Index: (.+)$/);
    const unified = text.match(/^(---|\+\+\+) (.+?)(?:\t.*)?$/);
    if (native) {
      events.push({
        kind: "file",
        index,
        file: fileName(native[2]!)!,
        operation: native[1] === "Add" ? "add" : native[1] === "Delete" ? "delete" : "update",
      });
    } else if (move) {
      events.push({ kind: "move", file: fileName(move[1]!)! });
    } else if (git || named) {
      const file = git ? (git[3] ?? git[4])! : named![1]!;
      const previousFile = git ? (git[1] ?? git[2]) : undefined;
      events.push({
        kind: "file",
        index,
        file,
        operation: "update",
        previousFile: previousFile !== file ? previousFile : undefined,
      });
    } else if (unified) {
      events.push({
        kind: unified[1] === "---" ? "old" : "new",
        index,
        file: fileName(unified[2]!)?.replace(/^[ab]\//, ""),
      });
    } else if (text.startsWith("@@")) {
      const range = text.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/);
      events.push({
        kind: "hunk",
        label:
          (range ? range[3] : text.replace(/^@@\s*/, "").replace(/\s*@@$/, ""))?.trim() ||
          "Changed lines",
        oldLine: range ? Number(range[1]) : undefined,
        newLine: range ? Number(range[2]) : undefined,
      });
    } else if (text.startsWith("new file mode ") || text.startsWith("deleted file mode ")) {
      events.push({ kind: "operation", operation: text.startsWith("new") ? "add" : "delete" });
    } else if (text === "*** Begin Patch" || text === "*** End Patch") {
      events.push({ kind: "end" });
    }
  });
  sectionEvents.set(page, events);
  return events;
}

function getSectionLine(
  spans: readonly SectionSpan[],
  index: number,
): PatchSectionLine | undefined {
  if (!Number.isInteger(index) || index < 0) return undefined;
  let low = 0;
  let high = spans.length - 1;
  while (low <= high) {
    const middle = (low + high) >>> 1;
    const span = spans[middle]!;
    if (index < span.start) high = middle - 1;
    else if (index >= span.start + span.length) low = middle + 1;
    else {
      if ("label" in span) return { kind: "hunk", label: span.label };
      const offset = index - span.start;
      const localIndex = span.run.index + offset;
      const line = span.page.lines[localIndex]!;
      const base = line.kind === "deletion" ? span.oldLine : span.newLine;
      const advance =
        line.kind === "deletion" ? span.run.oldOffsets[offset]! : span.run.newOffsets[offset]!;
      return {
        kind: "code",
        page: span.page,
        index: localIndex,
        line,
        lineNumber: base === undefined ? undefined : base + advance,
        sourceLine: span.sourceStart + localIndex + 1,
      };
    }
  }
  return undefined;
}

/**
 * Interprets file/hunk commands without exposing them as code rows. Immutable
 * pages are scanned once; snapshots assemble cached code spans, not row arrays.
 */
export function getPatchSections(document: StreamingPatchDocument): readonly PatchSection[] {
  const cached = sectionsCache.get(document);
  if (cached) return cached;
  const builders: SectionBuilder[] = [];
  let current: SectionBuilder | undefined;
  const start = (
    file: string,
    operation: PatchSection["operation"],
    sourceLine: number,
    previousFile?: string,
  ) => {
    current = {
      id: `patch-file-${sourceLine}`,
      file,
      previousFile,
      operation,
      additions: 0,
      deletions: 0,
      lineCount: 0,
      newLine: operation === "add" ? 1 : undefined,
      spans: [],
    };
    builders.push(current);
    return current;
  };
  let sourceStart = 0;
  for (const page of getPatchPresentation(document).pages) {
    for (const event of getSectionEvents(page)) {
      if (event.kind === "file") {
        start(event.file, event.operation, sourceStart + event.index + 1, event.previousFile);
      } else if (event.kind === "end") {
        current = undefined;
      } else if (event.kind === "old" || event.kind === "new") {
        if (!current || (event.kind === "old" && current.hasOldHeader)) {
          start(event.file ?? "Patch", "update", sourceStart + event.index + 1);
        }
        const section = current!;
        if (event.kind === "old") {
          section.hasOldHeader = true;
          if (!event.file) {
            section.operation = "add";
            section.newLine = 1;
          } else section.previousFile = event.file;
        } else if (!event.file) {
          section.operation = "delete";
        } else {
          section.file = event.file;
        }
      } else if (event.kind === "move" && current) {
        current.previousFile ??= current.file;
        current.file = event.file;
      } else if (event.kind === "operation" && current) {
        current.operation = event.operation;
        current.newLine = event.operation === "add" ? 1 : undefined;
      } else if (event.kind === "hunk" && current) {
        current.spans.push({ start: current.lineCount++, length: 1, label: event.label });
        current.oldLine = event.oldLine;
        current.newLine =
          event.newLine ?? (current.operation === "add" ? current.newLine : undefined);
      } else if (event.kind === "code") {
        const section =
          current ??
          start(page.lines[event.index]!.file ?? "Patch", "update", sourceStart + event.index + 1);
        section.spans.push({
          start: section.lineCount,
          length: event.length,
          page,
          sourceStart,
          run: event,
          oldLine: section.oldLine,
          newLine: section.newLine,
        });
        section.lineCount += event.length;
        section.additions += event.additions;
        section.deletions += event.deletions;
        if (section.oldLine !== undefined) section.oldLine += event.length - event.additions;
        if (section.newLine !== undefined) section.newLine += event.length - event.deletions;
      }
    }
    sourceStart += page.lines.length;
  }
  const sections = builders.map((section): PatchSection => ({
    id: section.id,
    file: section.file,
    previousFile: section.previousFile !== section.file ? section.previousFile : undefined,
    operation: section.operation,
    additions: section.additions,
    deletions: section.deletions,
    lineCount: section.lineCount,
    getLine: (index) => getSectionLine(section.spans, index),
  }));
  sectionsCache.set(document, sections);
  return sections;
}

interface FileContext {
  file?: string;
  format?: "native" | "unified";
  inHunk: boolean;
  oldRemaining?: number;
  newRemaining?: number;
}

interface ProcessedPage {
  page: PatchPage;
  context: FileContext;
}

interface PatchPresentation {
  pages: readonly PatchPage[];
  getLine(index: number): { page: PatchPage; index: number; line: PatchLine } | undefined;
}

const TOKENIZE_MAX_LINE_LENGTH = 2_000;
const HIGHLIGHT_CACHE_SIZE = 24;
const processedPages = new WeakMap<readonly string[], Map<string, ProcessedPage>>();
const presentations = new WeakMap<StreamingPatchDocument, PatchPresentation>();
const highlights: {
  page: PatchPage;
  theme: DiffsThemeNames;
  promise: Promise<PatchHighlight>;
}[] = [];

function fileName(value: string): string | undefined {
  const file = value.trim().replace(/^"|"$/g, "");
  return file && file !== "/dev/null" ? file : undefined;
}

function processPage(raw: readonly string[], incoming: FileContext): ProcessedPage {
  const key = JSON.stringify([
    incoming.file,
    incoming.format,
    incoming.inHunk,
    incoming.oldRemaining,
    incoming.newRemaining,
  ]);
  let variants = processedPages.get(raw);
  const cached = variants?.get(key);
  if (cached) return cached;

  const context = { ...incoming };
  const lines = raw.map((text): PatchLine => {
    // Parse CRLF without changing the displayed or copied source.
    const header = text.endsWith("\r") ? text.slice(0, -1) : text;
    const native = header.match(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/);
    const move = header.match(/^\*\*\* Move to: (.+)$/);
    const unified = header.match(/^diff --git (?:"a\/.*?"|a\/.*?) (?:"b\/(.*)"|b\/(.*))$/);
    const index = header.match(/^Index: (.+)$/);
    const fileHeader =
      context.format !== "native" && !context.inHunk
        ? header.match(/^(?:---|\+\+\+) (.+?)(?:\t.*)?$/)
        : null;

    if (native || move) {
      context.file = fileName((native ?? move)![1]!);
      context.format = "native";
      context.inHunk = false;
    } else if (unified || index) {
      context.file = fileName(unified ? (unified[1] ?? unified[2])! : index![1]!);
      context.format = "unified";
      context.inHunk = false;
    } else if (fileHeader) {
      context.file = fileName(fileHeader[1]!)?.replace(/^[ab]\//, "") ?? context.file;
      context.format = "unified";
    } else if (header.startsWith("@@")) {
      context.inHunk = true;
      const range = header.match(/^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/);
      context.oldRemaining = range ? Number(range[1] ?? 1) : undefined;
      context.newRemaining = range ? Number(range[2] ?? 1) : undefined;
    } else if (header === "*** Begin Patch" || header === "*** End Patch") {
      context.file = undefined;
      context.format = undefined;
      context.inHunk = false;
    }

    const metadata = native || move || unified || index || fileHeader || header.startsWith("@@");
    const first = text[0];
    const marker = !metadata && (first === "+" || first === "-" || first === " ") ? first : "";
    if (
      context.inHunk &&
      marker &&
      context.oldRemaining !== undefined &&
      context.newRemaining !== undefined
    ) {
      if (marker !== "+") context.oldRemaining--;
      if (marker !== "-") context.newRemaining--;
      if (context.oldRemaining === 0 && context.newRemaining === 0) context.inHunk = false;
    }
    if (!context.inHunk) {
      context.oldRemaining = undefined;
      context.newRemaining = undefined;
    }
    return {
      text,
      code: marker ? text.slice(1) : text,
      marker,
      kind:
        marker === "+"
          ? "addition"
          : marker === "-"
            ? "deletion"
            : marker === " "
              ? "context"
              : "metadata",
      file: context.file,
    };
  });
  const result = { page: { lines }, context };
  if (!variants) {
    variants = new Map();
    processedPages.set(raw, variants);
  }
  variants.set(key, result);
  return result;
}

/** Reuses immutable finished pages; the unterminated tail has its own small page. */
export function getPatchPresentation(document: StreamingPatchDocument): PatchPresentation {
  const cached = presentations.get(document);
  if (cached) return cached;
  const pages: PatchPage[] = [];
  let context: FileContext = { inHunk: false };
  for (const raw of document.pages) {
    const processed = processPage(raw, context);
    pages.push(processed.page);
    context = processed.context;
  }
  if (document.tail) pages.push(processPage([document.tail], context).page);

  const presentation: PatchPresentation = {
    pages,
    getLine(index) {
      if (!Number.isInteger(index) || index < 0) return undefined;
      const tail = index === document.lineCount && document.tail.length > 0;
      if (index >= document.lineCount && !tail) return undefined;
      const page = tail ? pages.at(-1) : pages[Math.floor(index / STREAMING_PATCH_PAGE_SIZE)];
      const localIndex = tail ? 0 : index % STREAMING_PATCH_PAGE_SIZE;
      const line = page?.lines[localIndex];
      return page && line ? { page, index: localIndex, line } : undefined;
    },
  };
  presentations.set(document, presentation);
  return presentation;
}

/**
 * Only tokenizes the requested page, never offscreen predecessors. Lexical state
 * restarts at page and hunk boundaries; old and new versions stay independent.
 */
export function highlightPatchPage(
  page: PatchPage,
  theme: DiffsThemeNames,
): Promise<PatchHighlight> {
  const index = highlights.findIndex((entry) => entry.page === page && entry.theme === theme);
  if (index !== -1) {
    const entry = highlights.splice(index, 1)[0]!;
    highlights.push(entry);
    return entry.promise;
  }
  const promise = highlight(page, theme).catch((error: unknown) => {
    const failed = highlights.findIndex((entry) => entry.promise === promise);
    if (failed !== -1) highlights.splice(failed, 1);
    throw error;
  });
  highlights.push({ page, theme, promise });
  if (highlights.length > HIGHLIGHT_CACHE_SIZE) highlights.shift();
  return promise;
}

async function highlight(page: PatchPage, theme: DiffsThemeNames): Promise<PatchHighlight> {
  const languages = page.lines.map((line) =>
    line.kind !== "metadata" && line.file ? getFiletypeFromFileName(line.file) : "text",
  );
  const highlighter = await getSharedHighlighter({
    themes: [theme],
    langs: [...new Set(languages)],
  });
  const foreground = highlighter.getTheme(theme).fg;
  const lines: PatchHighlight["lines"][number][] = page.lines.map((line) => [
    { content: line.code },
  ]);

  const tokenize = (indices: number[], side: "old" | "new") => {
    if (indices.length === 0) return;
    const lang = languages[indices[0]!]!;
    if (lang === "text") return;
    const { tokens } = highlighter.codeToTokens(
      indices.map((index) => page.lines[index]!.code).join("\n"),
      { lang, theme, tokenizeMaxLineLength: TOKENIZE_MAX_LINE_LENGTH, tokenizeTimeLimit: 0 },
    );
    indices.forEach((index, row) => {
      // Context is displayed using the new version's lexical state.
      if (side === "old" && page.lines[index]!.kind !== "deletion") return;
      const code = page.lines[index]!.code;
      const rowTokens = tokens[row];
      // Shiki normalizes some line endings. Never lose raw characters to it.
      if (rowTokens?.map((token) => token.content).join("") === code) lines[index] = rowTokens;
    });
  };

  let old: number[] = [];
  let next: number[] = [];
  const flush = () => {
    tokenize(old, "old");
    tokenize(next, "new");
    old = [];
    next = [];
  };
  page.lines.forEach((line, index) => {
    if (line.kind === "metadata") {
      // This marker can appear inside a changed block, not just after a hunk.
      if (!line.text.startsWith("\\ No newline at end of file")) flush();
      return;
    }
    if (line.kind !== "addition") old.push(index);
    if (line.kind !== "deletion") next.push(index);
  });
  flush();
  return { lines, foreground };
}
