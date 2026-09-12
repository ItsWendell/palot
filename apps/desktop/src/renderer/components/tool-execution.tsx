import {
  BrainCircuit,
  Braces,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Copy,
  ExternalLink,
  FileCode2,
  FileSearch,
  Files,
  Globe2,
  ImageIcon,
  Search,
  SquareArrowOutUpRight,
  Terminal,
  Wrench,
} from "lucide-react";
import {
  Fragment,
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from "react";
import type { JsonValue, PalotMessageContent } from "../../shared";
import { useClipboardCopy } from "../hooks/use-clipboard-copy";
import { usePalotNavigation } from "../hooks/use-navigation";
import { useSessionCatalog } from "../hooks/use-session-catalog";
import { cn } from "../lib/cn";
import { writeClipboardText } from "../lib/clipboard";
import {
  projectToolExecution,
  formatToolDetailValue,
  readableToolName,
  type FileChangeExecution,
  type ExecuteExecution,
  type ListExecution,
  type ReadExecution,
  type SearchExecution,
  type ShellExecution,
  type SkillExecution,
  type SubagentExecution,
  type ToolImage,
  type ToolExecutionView,
  type WebFetchExecution,
  type WebSearchExecution,
} from "../lib/tool-executions";
import { IconButton } from "./ui";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./ui/collapsible";
import { PulseDot } from "./ui/pulse-dot";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { FileDiffView } from "./file-diff-view";
import { FileReadView } from "./file-read-view";
import { HighlightedCode } from "./highlighted-code";
import {
  MarkdownContent,
  useWorkspaceFileOpener,
  type WorkspaceFileOpenHandler,
} from "./markdown-content";
import { ReadImagePreview } from "./read-image-preview";
import { StreamingPatchView } from "./streaming-patch-view";
import { TerminalOutput } from "./terminal-output";

const MAX_HIGHLIGHTED_JSON_LENGTH = 256_000;
const MAX_CACHED_DETAIL_HEIGHTS = 512;
const detailHeights = new Map<string, number>();

function ToolOutput({
  children,
  className,
  collapsedClassName = "max-h-72",
  mode = "expand",
  ariaLabel,
  contentLabel = "output",
}: {
  children: ReactNode;
  className?: string;
  collapsedClassName?: string;
  mode?: "expand" | "scroll";
  ariaLabel?: string;
  contentLabel?: string;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  const nearVisible = useNearVisible(contentRef);

  // Measure only near the viewport; ResizeObserver covers later streaming size changes.
  useLayoutEffect(() => {
    if (mode !== "expand" || !nearVisible) {
      // eslint-disable-next-line react-hooks-compiler/set-state-in-effect
      setOverflowing(false);
      return;
    }
    const content = contentRef.current;
    if (!content || expanded) return;
    const update = () => setOverflowing(content.scrollHeight > content.clientHeight + 1);
    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(content);
    return () => observer.disconnect();
  }, [expanded, mode, nearVisible]);

  return (
    <div className="min-w-0">
      <div
        ref={contentRef}
        className={cn(
          "min-w-0 overflow-x-auto",
          mode === "expand" && !expanded && collapsedClassName,
          mode === "expand" && !expanded && "overflow-y-hidden",
          mode === "scroll" && collapsedClassName,
          mode === "scroll" &&
            "palot-native-scrollbar overflow-y-auto outline-none focus-visible:ring-1 focus-visible:ring-ring",
          className,
        )}
        role={mode === "scroll" && ariaLabel ? "region" : undefined}
        aria-label={mode === "scroll" ? ariaLabel : undefined}
        tabIndex={mode === "scroll" && ariaLabel ? 0 : undefined}
      >
        {children}
      </div>
      {mode === "expand" && (overflowing || expanded) ? (
        <div className="flex justify-center border-t border-foreground/8 bg-muted/15 py-1">
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={() => setExpanded((current) => !current)}
          >
            {expanded ? `Collapse ${contentLabel}` : `Show full ${contentLabel}`}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function useNearVisible(ref: RefObject<Element | null>, enabled = true): boolean {
  const [nearVisible, setNearVisible] = useState(() => typeof IntersectionObserver === "undefined");

  useEffect(() => {
    if (!enabled || nearVisible || typeof IntersectionObserver === "undefined") return;
    const element = ref.current;
    if (!element) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        setNearVisible(true);
        observer.disconnect();
      },
      { rootMargin: "600px 0px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [enabled, nearVisible, ref]);

  return nearVisible;
}

function DeferredDetails({ cacheKey, children }: { cacheKey: string; children: ReactNode }) {
  const contentRef = useRef<HTMLDivElement>(null);
  const cachedHeight = detailHeights.get(cacheKey) ?? null;
  const nearVisible = useNearVisible(contentRef, cachedHeight !== null);
  const materialized = cachedHeight === null || nearVisible;

  useLayoutEffect(() => {
    if (!materialized) return;
    const content = contentRef.current;
    if (!content) return;
    const update = () => cacheDetailHeight(cacheKey, content.getBoundingClientRect().height);
    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(content);
    return () => observer.disconnect();
  }, [cacheKey, materialized]);

  return (
    <div
      ref={contentRef}
      style={!materialized && cachedHeight !== null ? { height: cachedHeight } : undefined}
    >
      {materialized ? children : null}
    </div>
  );
}

function cacheDetailHeight(key: string, height: number): void {
  if (height <= 0) return;
  detailHeights.delete(key);
  detailHeights.set(key, height);
  if (detailHeights.size <= MAX_CACHED_DETAIL_HEIGHTS) return;
  const oldest = detailHeights.keys().next().value;
  if (oldest !== undefined) detailHeights.delete(oldest);
}

function baseName(path: string) {
  return path.replaceAll("\\", "/").split("/").filter(Boolean).at(-1) ?? path;
}

function targetLabel(files: string[]) {
  const names = files.map(baseName).filter((name, index, values) => values.indexOf(name) === index);
  if (names.length === 1) return names[0]!;
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names[0]}, ${names[1]} and ${names.length - 2} more`;
}

type WorkspaceFileOpener = WorkspaceFileOpenHandler | null;

function WorkspaceFileTarget({
  path,
  opener,
  line,
  children,
  className,
}: {
  path: string;
  opener: WorkspaceFileOpener;
  line?: number;
  children?: ReactNode;
  className?: string;
}) {
  const label = children ?? baseName(path);
  const title = line === undefined ? path : `${path} (line ${line})`;
  const open = (event?: React.MouseEvent | React.KeyboardEvent) => {
    if (event && (event.metaKey || event.ctrlKey)) {
      opener?.({ path, ...(line === undefined ? {} : { line }) }, event);
    } else {
      opener?.({ path, ...(line === undefined ? {} : { line }) });
    }
  };

  if (!opener || path === "Unknown path") {
    return (
      <span className={className} title={title}>
        {label}
      </span>
    );
  }

  const fileHref = path.startsWith("file://")
    ? path
    : `file://${encodeURI(path.startsWith("/") ? path : `/${path}`)}${line ? `#L${line}` : ""}`;

  return (
    <a
      role="link"
      href={fileHref}
      title={`Open ${title}`}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        open(event);
      }}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        event.stopPropagation();
        open(event);
      }}
      className={cn(
        "cursor-pointer text-info underline-offset-2 hover:underline focus-visible:rounded-[2px] focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      {label}
    </a>
  );
}

function WorkspaceFileTargets({ files, opener }: { files: string[]; opener: WorkspaceFileOpener }) {
  const targets = files.filter((file, index, values) => values.indexOf(file) === index);
  const names = targets.map(baseName);
  const duplicateNames = new Set(
    names.filter((name, index, values) => values.indexOf(name) !== index),
  );
  if (targets.length === 0) return null;

  return (
    <>
      {targets.slice(0, 2).map((file, index) => (
        <Fragment key={file}>
          {index === 0 ? null : targets.length === 2 ? " and " : ", "}
          <WorkspaceFileTarget path={file} opener={opener}>
            {duplicateNames.has(baseName(file)) ? file : undefined}
          </WorkspaceFileTarget>
        </Fragment>
      ))}
      {targets.length > 2 ? ` and ${targets.length - 2} more` : null}
    </>
  );
}

function executeToolLabel(view: ExecuteExecution) {
  const names = view.calls
    .map((call) => call.title)
    .filter((name, index, values) => values.indexOf(name) === index);
  if (names.length === 0) return null;
  if (names.length === 1) return names[0]!;
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names[0]}, ${names[1]} and ${names.length - 2} more`;
}

function durationLabel(durationMs: number) {
  if (durationMs < 1_000) return `${Math.round(durationMs)} ms`;
  if (durationMs < 10_000) return `${(durationMs / 1_000).toFixed(1)} s`;
  if (durationMs < 60_000) return `${Math.round(durationMs / 1_000)} s`;
  const minutes = Math.floor(durationMs / 60_000);
  const seconds = Math.round((durationMs % 60_000) / 1_000);
  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

function elapsedLabel(durationMs: number) {
  const seconds = Math.max(0, Math.floor(durationMs / 1_000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}m ${remainder.toString().padStart(2, "0")}s`;
}

function executionTitle(view: ToolExecutionView) {
  if (view.kind === "read") return `Read ${baseName(view.path)}`;
  if (view.kind === "list") return `Listed ${view.path}`;
  if (view.kind === "search") {
    if (view.engine === "glob") return `Found files matching “${view.query}”`;
    return `Searched for “${view.query}”`;
  }
  if (view.kind === "web-search") {
    return `${view.status === "running" || view.status === "pending" ? "Searching" : "Searched"} the web for “${view.query}”`;
  }
  if (view.kind === "web-fetch") {
    return `${view.status === "error" ? "Failed to fetch" : view.status === "running" || view.status === "pending" ? "Fetching" : "Fetched"} ${view.url}`;
  }
  if (view.kind === "shell") {
    const command = view.command.trim();
    const running = view.status === "running" || view.status === "pending";
    if (view.scriptPresentation) {
      const subject = view.scriptPresentation.mixed
        ? "shell commands with Python"
        : "Python script";
      if (view.status === "error") return `Failed to run ${subject}`;
      return `${running ? "Running" : "Ran"} ${subject}`;
    }
    if (running) return command ? `Running ${command}` : "Running command";
    if (view.status === "error") return command ? `Command failed: ${command}` : "Command failed";
    return command ? `Ran ${command}` : "Ran command";
  }
  if (view.kind === "skill") {
    return `${view.status === "running" || view.status === "pending" ? "Loading" : "Loaded"} ${view.skill}`;
  }
  if (view.kind === "subagent") {
    const running = view.status === "running" || view.status === "pending";
    return `${running ? "Running" : "Ran"} ${view.agent} subagent`;
  }
  if (view.kind === "execute") {
    const running = view.status === "running" || view.status === "pending";
    if (view.name.toLowerCase() !== "execute") {
      const title = readableToolName(view.name);
      if (running) return `Running ${title}`;
      if (view.status === "error" || view.runtimeError) return `${title} failed`;
      return `Ran ${title}`;
    }
    const tools = executeToolLabel(view);
    if (running) return tools ? `Orchestrating ${tools}` : "Orchestrating tools";
    if (view.status === "error" || view.runtimeError) {
      return tools ? `Failed to orchestrate ${tools}` : "Tool orchestration failed";
    }
    return tools ? `Orchestrated ${tools}` : "Orchestrated tools";
  }
  if (view.kind === "file-change") {
    const targets = view.targetFiles;
    const running = view.status === "running" || view.status === "pending";
    if (view.operation === "patch") {
      if (view.inputStreaming) {
        return targets.length > 0
          ? `Generating patch for ${targetLabel(targets)}`
          : "Generating patch";
      }
      if (targets.length > 0) {
        return `${running ? "Patching" : "Updated"} ${targetLabel(targets)}`;
      }
      return running ? "Applying patch" : "Applied patch";
    }
    const path = targets[0] ?? view.path ?? "file";
    if (view.operation === "write") return `${running ? "Writing" : "Wrote"} ${baseName(path)}`;
    return `${running ? "Editing" : "Updated"} ${baseName(path)}`;
  }
  if (view.kind === "image-generation") {
    const editing = view.operation === "edit";
    if (view.status === "error") return editing ? "Image edit failed" : "Image generation failed";
    const active = view.status === "running" || view.status === "pending";
    if (editing) return active ? "Editing image" : "Edited image";
    return active ? "Generating image" : "Generated image";
  }
  return `Called ${view.title}${view.label ? `: ${view.label}` : ""}`;
}

function executionTitleContent(view: ToolExecutionView, opener: WorkspaceFileOpener): ReactNode {
  if (view.kind === "read") {
    return (
      <>
        <span>Read </span>
        <WorkspaceFileTarget path={view.path} line={view.range?.start} opener={opener} />
      </>
    );
  }
  if (view.kind !== "file-change") return executionTitle(view);

  const running = view.status === "running" || view.status === "pending";
  if (view.operation === "patch" && view.targetFiles.length > 0) {
    return (
      <>
        <span>
          {view.inputStreaming ? "Generating patch for " : running ? "Patching " : "Updated "}
        </span>
        <WorkspaceFileTargets files={view.targetFiles} opener={opener} />
      </>
    );
  }

  const path = view.targetFiles[0] ?? view.path;
  if (!path) return executionTitle(view);
  return (
    <>
      <span>
        {view.operation === "write"
          ? running
            ? "Writing "
            : "Wrote "
          : running
            ? "Editing "
            : "Updated "}
      </span>
      <WorkspaceFileTarget path={path} opener={opener} />
    </>
  );
}

function executionMeta(view: ToolExecutionView) {
  if (view.kind === "read" && view.range) return `lines ${view.range.start}–${view.range.end}`;
  if (view.kind === "read" && view.images.length > 0) {
    return view.images.length === 1 ? "image" : `${view.images.length} images`;
  }
  if (view.kind === "search" && view.count !== null) {
    return `${view.count} ${view.engine === "glob" ? (view.count === 1 ? "file" : "files") : view.count === 1 ? "match" : "matches"}`;
  }
  if (view.kind === "web-search") {
    if (view.results.length > 0) {
      return `${view.results.length} ${view.results.length === 1 ? "result" : "results"}`;
    }
    return view.provider;
  }
  if (view.kind === "web-fetch") return view.format;
  if (view.kind === "shell") {
    if (view.timedOut) return "timed out";
    if (view.exitCode !== null) return `exit ${view.exitCode}`;
  }
  if (view.kind === "file-change" && view.files.length > 0) {
    const totals = view.files.reduce(
      (sum, file) => ({
        additions: sum.additions + file.additions,
        deletions: sum.deletions + file.deletions,
      }),
      { additions: 0, deletions: 0 },
    );
    return `+${totals.additions} −${totals.deletions}`;
  }
  if (view.kind === "file-change" && view.targetFiles.length > 1) {
    return `${view.targetFiles.length} files`;
  }
  if (view.kind === "skill" && view.directory) return baseName(view.directory);
  if (view.kind === "subagent") return view.background ? "background" : view.description;
  if (view.kind === "execute" && view.calls.length > 0) {
    const failed = view.calls.filter((call) => call.status === "error").length;
    return failed > 0
      ? `${failed} failed`
      : `${view.calls.length} ${view.calls.length === 1 ? "call" : "calls"}`;
  }
  if (view.kind === "image-generation") {
    if (view.images.length > 1) return `${view.images.length} images`;
    if (view.images.length === 0 && view.referenceCount > 0) {
      return `${view.referenceCount} ${view.referenceCount === 1 ? "reference" : "references"}`;
    }
    return null;
  }
  if (view.images.length > 0) {
    return view.images.length === 1 ? "image" : `${view.images.length} images`;
  }
  if (view.kind === "generic" && view.args.length > 0) return view.args.join(" · ");
  return null;
}

function executionIcon(view: ToolExecutionView) {
  const props = { "data-icon": "inline-start", "aria-hidden": true } as const;
  if (view.kind === "read" || view.kind === "skill") return <FileSearch {...props} />;
  if (view.kind === "list") return <Files {...props} />;
  if (view.kind === "search") return <Search {...props} />;
  if (view.kind === "web-search" || view.kind === "web-fetch") return <Globe2 {...props} />;
  if (view.kind === "shell") return <Terminal {...props} />;
  if (view.kind === "file-change") return <FileCode2 {...props} />;
  if (view.kind === "subagent") return <BrainCircuit {...props} />;
  if (view.kind === "execute") return <Braces {...props} />;
  if (view.kind === "image-generation") return <ImageIcon {...props} />;
  return <Wrench {...props} />;
}

function hasDetails(view: ToolExecutionView) {
  if (view.error) return true;
  if (view.images.length > 0) return true;
  if (view.kind === "read") {
    return view.lines.length > 0 || view.entries.length > 0 || view.images.length > 0;
  }
  if (view.kind === "list") return view.entries.length > 0 || Boolean(view.rawOutput);
  if (view.kind === "search") {
    return view.matches.length > 0 || view.files.length > 0 || Boolean(view.rawOutput);
  }
  if (view.kind === "web-search") return view.results.length > 0 || Boolean(view.rawOutput);
  if (view.kind === "web-fetch") return Boolean(view.output || view.error);
  if (view.kind === "shell") return Boolean(view.sourceOutput || view.command);
  if (view.kind === "file-change") {
    return (
      view.files.length > 0 ||
      Boolean(view.patchDocument?.text) ||
      view.targetFiles.length > 0 ||
      Boolean(view.content || view.rawOutput || view.error) ||
      hasRawInput(view.rawInput)
    );
  }
  if (view.kind === "skill") return Boolean(view.directory);
  if (view.kind === "subagent") {
    return Boolean(view.prompt || view.rawOutput || view.sessionID || view.error);
  }
  if (view.kind === "execute") {
    return Boolean(view.code || view.calls.length > 0 || view.output || view.error);
  }
  return Boolean(view.rawOutput) || hasRawInput(view.rawInput);
}

function hasRawInput(value: JsonValue | undefined): boolean {
  if (value === undefined || value === null || value === "") return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return true;
}

export const ToolExecution = memo(function ToolExecution({
  part,
  index,
  defaultOpen = false,
}: {
  part: PalotMessageContent;
  index: number;
  defaultOpen?: boolean;
}) {
  const view = useMemo(() => projectToolExecution(part, index), [index, part]);
  return <ToolExecutionCard view={view} defaultOpen={defaultOpen} />;
});

export const StandaloneShellExecution = memo(function StandaloneShellExecution({
  part,
  index,
}: {
  part: PalotMessageContent;
  index: number;
}) {
  const view = useMemo(() => projectToolExecution(part, index), [index, part]);
  if (view.kind !== "shell") return <ToolExecution part={part} index={index} />;
  const active = view.status === "running" || view.status === "pending";
  const label =
    view.status === "error" ? "Command failed" : active ? "Running command" : "Command completed";
  const meta = [
    view.timedOut ? "timed out" : view.exitCode === null ? null : `exit ${view.exitCode}`,
    view.truncated ? "output truncated" : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <ToolExecutionCard
      view={view}
      defaultOpen={view.status === "error"}
      meta={meta || null}
      title={
        view.scriptPresentation ? (
          executionTitle(view)
        ) : (
          <span className="flex min-w-0 items-baseline gap-1.5">
            <span className="shrink-0">{label}</span>
            {view.command ? (
              <code className="min-w-0 truncate font-mono text-code-compact text-muted-foreground">
                {view.command}
              </code>
            ) : null}
          </span>
        )
      }
    />
  );
});

export const ReadToolExecutionGroup = memo(
  function ReadToolExecutionGroup({
    entries,
    defaultOpen = false,
  }: {
    entries: Array<{ part: PalotMessageContent; index: number }>;
    defaultOpen?: boolean;
  }) {
    const views = useMemo(
      () =>
        entries.flatMap(({ part, index }) => {
          const view = projectToolExecution(part, index);
          return view.kind === "read" ? [view] : [];
        }),
      [entries],
    );
    const segments = useMemo(() => normalizeReadExecutions(views), [views]);
    const view = useMemo(() => mergeReadExecutions(segments), [segments]);
    if (!view) return null;
    if (views.length === 1) return <ToolExecutionCard view={views[0]!} defaultOpen={defaultOpen} />;

    const ranges = segments.flatMap((item) => (item.range ? [item.range] : []));
    const meta =
      ranges.length === segments.length && ranges.length <= 2
        ? ranges.map((range) => `${range.start}–${range.end}`).join(", ")
        : ranges.length === segments.length
          ? `${ranges.length} ranges`
          : `${views.length} reads`;
    return (
      <ToolExecutionCard view={view} defaultOpen={defaultOpen} meta={meta}>
        <ToolOutput mode="scroll" ariaLabel={`File contents for ${view.path}`}>
          <div className="flex flex-col gap-2">
            {segments.map((item) => (
              <section key={item.id} className="min-w-0">
                {item.range ? (
                  <div className="mb-1 text-micro font-medium text-muted-foreground">
                    Lines {item.range.start}–{item.range.end}
                  </div>
                ) : null}
                <ReadContent view={item} />
              </section>
            ))}
          </div>
        </ToolOutput>
      </ToolExecutionCard>
    );
  },
  (previous, next) =>
    previous.defaultOpen === next.defaultOpen &&
    previous.entries.length === next.entries.length &&
    previous.entries.every(
      (entry, index) =>
        entry.index === next.entries[index]?.index && entry.part === next.entries[index]?.part,
    ),
);

export function normalizeReadExecutions(views: ReadExecution[]): ReadExecution[] {
  const ranged = views
    .filter((view): view is ReadExecution & { range: NonNullable<ReadExecution["range"]> } =>
      Boolean(view.range),
    )
    .toSorted(
      (left, right) => left.range.start - right.range.start || left.range.end - right.range.end,
    );
  const latestLines = new Map<number, { number: number; text: string }>();
  for (const view of views) {
    for (const line of view.lines) latestLines.set(line.number, line);
  }

  const groups: Array<{
    start: number;
    end: number;
    views: ReadExecution[];
  }> = [];
  for (const view of ranged) {
    const previous = groups.at(-1);
    if (previous && view.range.start <= previous.end + 1) {
      previous.end = Math.max(previous.end, view.range.end);
      previous.views.push(view);
    } else {
      groups.push({ start: view.range.start, end: view.range.end, views: [view] });
    }
  }

  const segments = groups.map(({ start, end, views: grouped }) => {
    const merged = mergeReadExecutions(grouped)!;
    return {
      ...merged,
      range: { start, end },
      lines: [...latestLines.values()]
        .filter((line) => line.number >= start && line.number <= end)
        .toSorted((left, right) => left.number - right.number),
    };
  });
  return [...segments, ...views.filter((view) => view.range === null)];
}

function mergeReadExecutions(views: ReadExecution[]): ReadExecution | null {
  const first = views[0];
  if (!first) return null;
  const status = views.some((view) => view.status === "error")
    ? "error"
    : views.some((view) => view.status === "running")
      ? "running"
      : views.some((view) => view.status === "pending")
        ? "pending"
        : "complete";
  const started = views.flatMap((view) => (view.startedAt === null ? [] : [view.startedAt]));
  const durations = views.flatMap((view) => (view.durationMs === null ? [] : [view.durationMs]));
  return {
    ...first,
    status,
    startedAt: started.length > 0 ? Math.min(...started) : null,
    error: views.find((view) => view.error)?.error ?? null,
    durationMs:
      durations.length === views.length ? durations.reduce((sum, value) => sum + value, 0) : null,
    range: null,
    lines: [],
    entries: [],
    images: [],
    truncated: views.some((view) => view.truncated),
  };
}

const ToolExecutionCard = memo(function ToolExecutionCard({
  view,
  defaultOpen = false,
  meta: selectedMeta,
  title,
  children,
}: {
  view: ToolExecutionView;
  defaultOpen?: boolean;
  meta?: string | null;
  title?: ReactNode;
  children?: ReactNode;
}) {
  const opener = useWorkspaceFileOpener();
  const [userOverride, setUserOverride] = useState<{
    status: ToolExecutionView["status"];
    open: boolean;
  } | null>(null);
  const activePatch =
    view.kind === "file-change" &&
    view.operation === "patch" &&
    (view.status === "running" || view.status === "pending") &&
    Boolean(view.patchDocument?.text);
  const [openedByStreaming, setOpenedByStreaming] = useState(activePatch);
  if (activePatch && !openedByStreaming) setOpenedByStreaming(true);
  const open = userOverride?.open ?? (defaultOpen || openedByStreaming);
  const detail = children !== undefined || hasDetails(view);
  const materialized = open || userOverride !== null;
  const meta = selectedMeta === undefined ? executionMeta(view) : selectedMeta;
  const timing = timingLabel(view);

  return (
    <Collapsible
      open={open}
      onOpenChange={(value) => setUserOverride({ status: view.status, open: value })}
      data-status={view.status}
      data-palot-tool-kind={view.kind}
      data-palot-tool-name={view.name}
      className="my-0.5 min-w-0 text-muted-foreground"
    >
      <CollapsibleTrigger
        disabled={!detail}
        render={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            title={timing ?? undefined}
            className="h-7 w-full justify-start px-0! text-xs font-normal hover:bg-transparent! hover:text-foreground aria-expanded:bg-transparent!"
          />
        }
      >
        {executionIcon(view)}
        <span className="flex min-w-0 flex-1 items-center gap-1.5">
          <span className="min-w-0 truncate text-left text-foreground/80 transition-colors group-hover/button:text-foreground">
            {title ?? executionTitleContent(view, opener)}
          </span>
          {view.status === "running" || view.status === "pending" ? (
            <ActiveExecutionTiming
              key={view.startedAt ?? "not-started"}
              status={view.status}
              startedAt={view.startedAt}
            />
          ) : null}
        </span>
        {meta ? (
          <span
            className="min-w-0 max-w-[45%] truncate tabular-nums text-muted-foreground/70 transition-colors group-hover/button:text-foreground/80"
            title={meta}
          >
            {meta}
          </span>
        ) : null}
        {view.status === "error" ? (
          <ExecutionStatusTooltip label={timing}>
            <Badge variant="destructive">Failed</Badge>
          </ExecutionStatusTooltip>
        ) : view.status === "complete" ? (
          view.durationMs === null ? (
            <span className="inline-flex size-4 items-center justify-center">
              <Check
                className="size-3.5 text-muted-foreground/50 transition-colors group-hover/button:text-foreground/70"
                aria-hidden="true"
              />
            </span>
          ) : (
            <span
              className="shrink-0 tabular-nums text-muted-foreground/70 transition-colors group-hover/button:text-foreground/80"
              aria-label={timing ?? undefined}
            >
              {durationLabel(view.durationMs)}
            </span>
          )
        ) : null}
        {detail ? (
          open ? (
            <ChevronDown data-icon="inline-end" aria-hidden="true" />
          ) : (
            <ChevronRight data-icon="inline-end" aria-hidden="true" />
          )
        ) : null}
      </CollapsibleTrigger>
      {detail ? (
        <CollapsibleContent smooth animate={userOverride !== null} className="min-w-0 pt-1">
          {materialized ? (
            <DeferredDetails cacheKey={view.id}>
              {children ?? <ExecutionDetails view={view} opener={opener} />}
            </DeferredDetails>
          ) : null}
        </CollapsibleContent>
      ) : null}
    </Collapsible>
  );
});

function ActiveExecutionTiming({
  status,
  startedAt,
}: {
  status: "pending" | "running";
  startedAt: number | null;
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (startedAt === null) return;
    const interval = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, [startedAt]);

  const elapsed = startedAt === null ? null : Math.max(0, now - startedAt);
  return (
    <span className="inline-flex shrink-0 items-center gap-1 tabular-nums">
      <PulseDot className="size-2.5 [&>span]:size-1" aria-hidden="true" />
      <span className="sr-only">{status === "pending" ? "Pending" : "Running"}</span>
      {elapsed !== null && elapsed >= 1_000 ? (
        <span
          className="text-muted-foreground/70 transition-colors group-hover/button:text-foreground/80"
          aria-hidden="true"
        >
          {elapsedLabel(elapsed)}
        </span>
      ) : null}
    </span>
  );
}

function timingLabel(view: ToolExecutionView) {
  if (view.durationMs === null) return null;
  return `${view.status === "error" ? "Failed after" : "Completed in"} ${durationLabel(view.durationMs)}`;
}

function ExecutionStatusTooltip({
  label,
  children,
}: {
  label: string | null;
  children: ReactElement;
}) {
  if (!label) return children;
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function ExecutionDetails({
  view,
  opener,
}: {
  view: ToolExecutionView;
  opener: WorkspaceFileOpener;
}) {
  const details =
    view.kind === "read" ? (
      <ReadDetails view={view} />
    ) : view.kind === "list" ? (
      <ListDetails view={view} />
    ) : view.kind === "search" ? (
      <SearchDetails view={view} opener={opener} />
    ) : view.kind === "web-search" ? (
      <WebSearchDetails view={view} />
    ) : view.kind === "web-fetch" ? (
      <WebFetchDetails view={view} />
    ) : view.kind === "shell" ? (
      <ShellDetails view={view} />
    ) : view.kind === "file-change" ? (
      <FileChangeDetails view={view} opener={opener} />
    ) : view.kind === "skill" ? (
      <SkillDetails view={view} />
    ) : view.kind === "subagent" ? (
      <SubagentDetails view={view} />
    ) : view.kind === "execute" ? (
      <ExecuteDetails view={view} />
    ) : (
      <GenericDetails view={view} />
    );
  if (
    !view.error ||
    view.kind === "web-fetch" ||
    view.kind === "shell" ||
    view.kind === "execute"
  ) {
    return details;
  }
  return (
    <div className="flex flex-col gap-2">
      <ToolFailureReason error={view.error} />
      {details}
    </div>
  );
}

function ToolFailureReason({ error }: { error: string }) {
  return (
    <div
      className="flex items-start gap-2 rounded-lg border border-destructive/25 bg-destructive/6 px-3 py-2.5 text-xs text-destructive"
      role="alert"
    >
      <CircleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
      <pre className="m-0 min-w-0 flex-1 font-mono text-code-compact/relaxed whitespace-pre-wrap break-words">
        {error}
      </pre>
    </div>
  );
}

function ImageAttachments({
  images,
  tool,
  fallbackName,
}: {
  images: ToolImage[];
  tool: string;
  fallbackName?: string;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {images.map((image, index) => (
        <ReadImagePreview
          key={`${image.mime}:${index}`}
          src={image.uri}
          mime={image.mime}
          name={
            image.name ??
            fallbackName ??
            `${readableToolName(tool)} image${images.length > 1 ? ` ${index + 1}` : ""}`
          }
        />
      ))}
    </div>
  );
}

function GenericDetails({
  view,
}: {
  view: Extract<ToolExecutionView, { kind: "generic" | "image-generation" }>;
}) {
  const raw = Boolean(view.rawOutput) || hasRawInput(view.rawInput);
  return (
    <div className="flex flex-col gap-2">
      {view.images.length > 0 ? <ImageAttachments images={view.images} tool={view.name} /> : null}
      {raw ? <RawDetails input={view.rawInput} output={view.rawOutput} /> : null}
    </div>
  );
}

function ExecuteDetails({ view }: { view: ExecuteExecution }) {
  const result = view.error ?? view.output;
  const jsonResult = useMemo(
    () => (!view.error && !view.runtimeError && result ? formatJson(result) : null),
    [result, view.error, view.runtimeError],
  );

  return (
    <div className="flex flex-col gap-2 rounded-lg bg-muted/35 p-2.5 text-xs">
      {view.calls.length > 0 ? (
        <section className="flex flex-col gap-1.5">
          {view.calls.map((call, index) => (
            <div key={`${call.tool}:${index}`} className="flex min-w-0 items-center gap-2">
              {call.status === "running" ? (
                <PulseDot className="size-3" aria-hidden="true" />
              ) : call.status === "error" ? (
                <CircleAlert className="size-3 shrink-0 text-destructive" aria-hidden="true" />
              ) : (
                <Check className="size-3 shrink-0 text-muted-foreground/60" aria-hidden="true" />
              )}
              <span className="min-w-0 truncate font-medium text-foreground/80">{call.title}</span>
              {call.args.length > 0 ? (
                <span className="min-w-0 flex-1 truncate text-right font-mono text-code-compact text-muted-foreground">
                  {call.args.join(" · ")}
                </span>
              ) : null}
              {call.status === "error" ? (
                <Badge variant="destructive" className="shrink-0">
                  Failed
                </Badge>
              ) : null}
            </div>
          ))}
        </section>
      ) : null}
      {view.code ? (
        <section className={view.calls.length > 0 ? "border-t pt-2" : undefined}>
          <div className="mb-1 text-micro font-medium tracking-wide text-muted-foreground uppercase">
            Script
          </div>
          <ToolOutput mode="scroll" collapsedClassName="max-h-56" ariaLabel="Code Mode script">
            <HighlightedCode code={view.code} language="javascript" className="tool-highlight" />
          </ToolOutput>
        </section>
      ) : null}
      {result ? (
        <section className="border-t pt-2">
          <div className="mb-1 text-micro font-medium tracking-wide text-muted-foreground uppercase">
            {view.error || view.runtimeError ? "Error" : "Result"}
          </div>
          {jsonResult ? <JsonResult value={jsonResult} /> : <PlainExecuteResult value={result} />}
        </section>
      ) : null}
    </div>
  );
}

function formatJson(value: string): string | null {
  try {
    const formatted = JSON.stringify(JSON.parse(value), null, 2);
    return formatted && formatted.length <= MAX_HIGHLIGHTED_JSON_LENGTH ? formatted : null;
  } catch {
    return null;
  }
}

function JsonResult({ value }: { value: string }) {
  return (
    <ToolOutput mode="scroll" collapsedClassName="max-h-56" ariaLabel="JSON result">
      <HighlightedCode code={value} language="json" className="tool-highlight" />
    </ToolOutput>
  );
}

function PlainExecuteResult({ value }: { value: string }) {
  return (
    <ToolOutput mode="scroll" collapsedClassName="max-h-56" ariaLabel="Execution result">
      <pre className="m-0 font-mono text-code-compact/relaxed whitespace-pre-wrap text-foreground/75">
        {value}
      </pre>
    </ToolOutput>
  );
}

function ListDetails({ view }: { view: ListExecution }) {
  if (view.entries.length === 0) return <RawDetails input={null} output={view.rawOutput} />;
  return (
    <ToolOutput
      mode="scroll"
      collapsedClassName="max-h-64"
      ariaLabel={`Directory entries for ${view.path}`}
    >
      <div className="flex flex-col gap-1 rounded-lg bg-muted/35 p-2 font-mono text-code-compact">
        {view.entries.map((entry) => (
          <span key={entry}>{entry}</span>
        ))}
      </div>
    </ToolOutput>
  );
}

function SubagentDetails({ view }: { view: SubagentExecution }) {
  const { openSession } = usePalotNavigation();
  const sessions = useSessionCatalog();
  const canOpen = Boolean(
    view.sessionID && sessions.some((session) => session.id === view.sessionID),
  );

  return (
    <div className="flex flex-col gap-2 rounded-lg bg-muted/35 p-2.5 text-xs">
      <div className="flex items-start gap-2">
        <BrainCircuit
          className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1">
          <div className="font-medium text-foreground/80">{view.description}</div>
          <div className="mt-0.5 text-micro text-muted-foreground">
            {view.agent} agent{view.background ? " · running in background" : ""}
          </div>
        </div>
        {canOpen ? (
          <Button
            type="button"
            variant="outline"
            size="xs"
            onClick={() => {
              if (view.sessionID) void openSession(view.sessionID);
            }}
          >
            Open task
            <SquareArrowOutUpRight data-icon="inline-end" aria-hidden="true" />
          </Button>
        ) : null}
      </div>
      {view.prompt ? (
        <section>
          <div className="mb-1 text-micro font-medium tracking-wide text-muted-foreground uppercase">
            Assignment
          </div>
          <p className="m-0 whitespace-pre-wrap text-meta/relaxed text-foreground/70">
            {view.prompt}
          </p>
        </section>
      ) : null}
      {view.rawOutput ? (
        <section className="border-t pt-2">
          <div className="mb-1 text-micro font-medium tracking-wide text-muted-foreground uppercase">
            Result
          </div>
          <ToolOutput>
            <div className="rounded-md bg-background/35 p-2.5">
              <MarkdownContent
                value={view.rawOutput}
                className="text-meta/relaxed text-foreground/75"
                passiveMedia={false}
              />
            </div>
          </ToolOutput>
        </section>
      ) : null}
      {view.sessionID && !canOpen ? (
        <div
          className="truncate font-mono text-code-compact text-muted-foreground"
          title={view.sessionID}
        >
          Session {view.sessionID}
        </div>
      ) : null}
    </div>
  );
}

function SkillDetails({ view }: { view: SkillExecution }) {
  if (!view.directory) return null;
  return (
    <div className="flex items-center gap-2 rounded-lg bg-muted/35 px-2.5 py-2 text-xs text-foreground/75">
      <BrainCircuit className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="min-w-0 truncate font-mono text-code-compact" title={view.directory}>
        {view.directory}
      </span>
    </div>
  );
}

function ReadDetails({ view }: { view: ReadExecution }) {
  if (view.images.length > 0) {
    return <ImageAttachments images={view.images} tool="read" fallbackName={baseName(view.path)} />;
  }
  return (
    <ToolOutput mode="scroll" ariaLabel={`File contents for ${view.path}`}>
      <ReadContent view={view} />
    </ToolOutput>
  );
}

function ReadContent({ view }: { view: ReadExecution }) {
  if (view.lines.length > 0) {
    return (
      <FileReadView
        file={view.path}
        start={view.lines[0]!.number}
        lines={view.lines}
        className="overflow-x-auto!"
        ariaLabel={null}
      />
    );
  }
  return (
    <div className="flex flex-col gap-1 rounded-lg bg-muted/45 p-2 font-mono text-code-compact">
      {view.entries.map((entry) => (
        <span key={entry}>{entry}</span>
      ))}
    </div>
  );
}

function SearchDetails({ view, opener }: { view: SearchExecution; opener: WorkspaceFileOpener }) {
  if (view.matches.length > 0) {
    const files = Map.groupBy(view.matches, (match) => match.file);
    return (
      <ToolOutput mode="scroll" ariaLabel={`Search results for ${view.query}`}>
        <div className="flex flex-col gap-2 rounded-lg bg-muted/35 p-2">
          {[...files].map(([file, matches]) => {
            const numbered = matches.flatMap((match) =>
              match.line === null ? [] : [{ number: match.line, text: match.text }],
            );
            const unnumbered = matches.filter((match) => match.line === null);
            return (
              <section key={file} className="flex min-w-0 flex-col gap-1">
                <div className="flex items-center gap-1.5 text-xs font-medium text-foreground/80">
                  <Files className="size-3" aria-hidden="true" />
                  <WorkspaceFileTarget
                    path={file}
                    line={numbered[0]?.number}
                    opener={opener}
                    className="truncate"
                  >
                    {file}
                  </WorkspaceFileTarget>
                </div>
                {numbered.length > 0 ? (
                  <FileReadView
                    file={file}
                    start={numbered[0]!.number}
                    lines={numbered}
                    className="overflow-x-auto!"
                    ariaLabel={null}
                  />
                ) : null}
                {unnumbered.map((match, index) => (
                  <pre
                    key={index}
                    className="m-0 font-mono text-code-compact/relaxed whitespace-pre-wrap text-foreground/70"
                  >
                    {match.text}
                  </pre>
                ))}
              </section>
            );
          })}
        </div>
      </ToolOutput>
    );
  }
  if (view.files.length > 0) {
    return (
      <ToolOutput
        mode="scroll"
        collapsedClassName="max-h-64"
        ariaLabel={`Files matching ${view.query}`}
      >
        <div className="flex flex-col gap-1 rounded-lg bg-muted/35 p-2 font-mono text-code-compact">
          {view.files.map((file) => (
            <WorkspaceFileTarget key={file} path={file} opener={opener}>
              {file}
            </WorkspaceFileTarget>
          ))}
        </div>
      </ToolOutput>
    );
  }
  return <RawDetails input={view.command} output={view.rawOutput} />;
}

function WebSearchDetails({ view }: { view: WebSearchExecution }) {
  if (view.results.length === 0) return <RawDetails input={null} output={view.rawOutput} />;
  return (
    <ToolOutput
      mode="scroll"
      collapsedClassName="max-h-80"
      ariaLabel={`Web search results for ${view.query}`}
    >
      <div className="flex flex-col gap-1.5">
        {view.results.map((result) => (
          <a
            key={result.url}
            href={result.url}
            target="_blank"
            rel="noreferrer"
            className="group rounded-lg border bg-card px-2.5 py-2 transition-colors hover:bg-muted/30"
          >
            <div className="flex min-w-0 items-start gap-2">
              <Globe2
                className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground/85">
                    {result.title}
                  </span>
                  <ExternalLink
                    className="size-3 shrink-0 text-muted-foreground/50 group-hover:text-muted-foreground"
                    aria-hidden="true"
                  />
                </div>
                <div className="mt-0.5 flex items-center gap-1.5 text-micro text-muted-foreground">
                  <span className="truncate">{webResultHost(result.url)}</span>
                  {result.publishedAt !== null ? (
                    <>
                      <span aria-hidden="true">·</span>
                      <time dateTime={new Date(result.publishedAt).toISOString()}>
                        {new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(
                          result.publishedAt,
                        )}
                      </time>
                    </>
                  ) : null}
                </div>
                {result.content ? (
                  <p className="mt-1 line-clamp-3 text-meta/relaxed text-foreground/65">
                    {result.content}
                  </p>
                ) : null}
              </div>
            </div>
          </a>
        ))}
      </div>
    </ToolOutput>
  );
}

function WebFetchDetails({ view }: { view: WebFetchExecution }) {
  if (view.error) return <RawDetails input={null} output={view.error} />;
  if (!view.output) return null;
  if (view.format === "markdown") {
    return (
      <ToolOutput collapsedClassName="max-h-96">
        <div className="rounded-lg border bg-card p-3">
          <MarkdownContent
            value={view.output}
            className="text-xs/relaxed"
            passiveMedia={false}
            baseUrl={view.url}
          />
        </div>
      </ToolOutput>
    );
  }
  if (view.format === "html") {
    return <RawDetails input={null} output={view.output} language="html" />;
  }
  return <RawDetails input={null} output={view.output} />;
}

function webResultHost(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function ShellDetails({ view }: { view: ShellExecution }) {
  const [copied, setCopied] = useState(false);
  const value = `$ ${view.command}${view.output ? `\n\n${view.output}` : ""}${view.error ? `\n\n${view.error}` : ""}`;

  if (view.scriptPresentation) return <PythonShellDetails view={view} />;

  return (
    <div className="relative overflow-hidden rounded-lg bg-muted/45">
      <IconButton
        label={copied ? "Copied" : "Copy command and output"}
        className="absolute top-2 right-2"
        onClick={() => {
          void writeClipboardText(value);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1200);
        }}
      >
        <Copy aria-hidden="true" />
      </IconButton>
      <ToolOutput mode="scroll" ariaLabel="Command output">
        <pre className="m-0 p-3 pr-11 font-mono text-code-compact/relaxed whitespace-pre-wrap text-foreground/75">
          <span>{`$ ${view.command}`}</span>
          {view.output ? (
            <>
              {"\n\n"}
              <TerminalOutput output={view.output} terminal={view.terminal} />
            </>
          ) : null}
          {view.error ? (
            <span className="text-destructive">
              {"\n\n"}
              {view.error}
            </span>
          ) : null}
        </pre>
      </ToolOutput>
    </div>
  );
}

function PythonShellDetails({ view }: { view: ShellExecution }) {
  const [raw, setRaw] = useState(false);
  const { copiedKey, copy } = useClipboardCopy();
  const presentation = view.scriptPresentation;
  if (!presentation) return null;
  const segments = presentation.segments.filter(
    (segment) => segment.language === "python" || segment.code.trim(),
  );
  const rawToggle = (
    <Button variant="ghost" size="xs" aria-pressed={raw} onClick={() => setRaw(!raw)}>
      {raw ? "Show script" : "Raw command"}
    </Button>
  );

  return (
    <div className="min-w-0 overflow-hidden rounded-lg bg-muted/45">
      {raw ? (
        <div className="flex items-center justify-between gap-2 px-3 py-1">
          <span className="text-micro font-medium text-muted-foreground">Raw command</span>
          <div className="flex items-center gap-1">
            {rawToggle}
            <IconButton
              label={copiedKey === "command" ? "Copied raw command" : "Copy raw command"}
              onClick={() => void copy(view.command, "command")}
            >
              {copiedKey === "command" ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
            </IconButton>
          </div>
        </div>
      ) : null}
      {raw ? (
        <ToolOutput mode="scroll" ariaLabel="Raw command">
          <pre className="m-0 p-3 font-mono text-code-compact/relaxed whitespace-pre-wrap text-foreground/75">
            {view.command}
          </pre>
        </ToolOutput>
      ) : (
        <ToolOutput contentLabel="input">
          {segments.map((segment, index) => (
            <section key={index} className="border-b last:border-b-0">
              <div className="flex min-h-8 items-center justify-between gap-2 px-3 py-1">
                <span className="text-micro font-medium text-muted-foreground">
                  {segment.language === "python" ? "Python" : "Shell"}
                </span>
                <div className="flex items-center gap-1">
                  {index === 0 ? rawToggle : null}
                  {segment.language === "python" ? (
                    <IconButton
                      label={
                        copiedKey === `script-${index}`
                          ? "Copied Python script"
                          : "Copy Python script"
                      }
                      onClick={() => void copy(segment.code, `script-${index}`)}
                    >
                      {copiedKey === `script-${index}` ? (
                        <Check aria-hidden="true" />
                      ) : (
                        <Copy aria-hidden="true" />
                      )}
                    </IconButton>
                  ) : null}
                </div>
              </div>
              <HighlightedCode
                code={segment.code}
                language={segment.language === "python" ? "python" : "bash"}
                ariaLabel={segment.language === "python" ? "Python script" : "Shell commands"}
                className="tool-highlight tool-highlight-compact"
              />
            </section>
          ))}
        </ToolOutput>
      )}
      {view.output || view.error ? (
        <section className="border-t">
          <div className="flex items-center justify-between gap-2 px-3 py-1">
            <span className="text-micro font-medium text-muted-foreground">
              {presentation.mixed ? "Combined output" : "Output"}
            </span>
            <IconButton
              label={copiedKey === "output" ? "Copied output" : "Copy output"}
              onClick={() =>
                void copy([view.output, view.error].filter(Boolean).join("\n\n"), "output")
              }
            >
              {copiedKey === "output" ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
            </IconButton>
          </div>
          <ToolOutput mode="scroll" ariaLabel="Command output">
            <pre className="m-0 px-3 pt-1 pb-2 font-mono text-code-compact/relaxed whitespace-pre-wrap text-foreground/75">
              {view.output ? (
                <TerminalOutput output={view.output} terminal={view.terminal} />
              ) : null}
              {view.error ? (
                <span className="text-destructive">
                  {view.output ? "\n\n" : ""}
                  {view.error}
                </span>
              ) : null}
            </pre>
          </ToolOutput>
        </section>
      ) : null}
    </div>
  );
}

function FileChangeDetails({
  view,
  opener,
}: {
  view: FileChangeExecution;
  opener: WorkspaceFileOpener;
}) {
  if (view.patchDocument) {
    return (
      <StreamingPatchView
        document={view.patchDocument}
        streaming={view.inputStreaming}
        review={
          view.files.length > 0 && (view.status === "complete" || view.status === "error") ? (
            <FileChangeDiffs view={view} opener={opener} />
          ) : undefined
        }
      />
    );
  }
  if (view.files.length > 0) {
    return <FileChangeDiffs view={view} opener={opener} />;
  }
  if (view.targetFiles.length > 0) {
    return (
      <ToolOutput mode="scroll" collapsedClassName="max-h-64" ariaLabel="Changed files">
        <div className="flex flex-col gap-0.5 rounded-lg bg-muted/35 p-2">
          {view.targetFiles.map((file) => (
            <div key={file} className="flex min-w-0 items-center gap-2 text-xs text-foreground/75">
              <FileCode2 className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
              <WorkspaceFileTarget
                path={file}
                opener={opener}
                className="min-w-0 truncate font-mono text-code-compact"
              >
                {file}
              </WorkspaceFileTarget>
              {view.status === "running" ? (
                <PulseDot className="ml-auto size-3" aria-hidden="true" />
              ) : null}
            </div>
          ))}
        </div>
      </ToolOutput>
    );
  }
  if (view.content) {
    return (
      <ToolOutput mode="scroll" ariaLabel="File contents">
        <pre className="m-0 rounded-lg bg-muted/45 p-3 font-mono text-code-compact/relaxed whitespace-pre-wrap text-foreground/75">
          {view.content}
        </pre>
      </ToolOutput>
    );
  }
  return <RawDetails input={view.rawInput} output={view.rawOutput} />;
}

function FileChangeDiffs({
  view,
  opener,
}: {
  view: FileChangeExecution;
  opener: WorkspaceFileOpener;
}) {
  return (
    <div className="flex flex-col gap-2">
      {view.files.map((file) => (
        <section key={file.file} className="overflow-hidden rounded-lg border bg-card">
          <header className="flex h-7 items-center gap-1.5 bg-muted/20 px-2 text-micro text-muted-foreground">
            <FileCode2 className="size-3 shrink-0" aria-hidden="true" />
            <WorkspaceFileTarget
              path={file.file}
              opener={opener}
              className="min-w-0 flex-1 truncate font-mono"
            >
              {file.file}
            </WorkspaceFileTarget>
            <span className="tabular-nums text-success/80">+{file.additions}</span>
            <span className="tabular-nums text-destructive/80">−{file.deletions}</span>
          </header>
          <ToolOutput
            mode="scroll"
            collapsedClassName="max-h-80"
            ariaLabel={`Diff contents for ${file.file}`}
          >
            <FileDiffView
              file={file.file}
              patch={file.patch}
              before={file.before}
              after={file.after}
              className="overflow-x-auto! border-t"
              ariaLabel={null}
            />
          </ToolOutput>
        </section>
      ))}
    </div>
  );
}

function RawDetails({
  input,
  output,
  language,
}: {
  input: JsonValue | undefined;
  output: string | null;
  language?: string;
}) {
  const value = output ?? formatToolDetailValue(input);
  if (!value) return null;
  const jsonValue = language ? null : formatJson(value);
  if (language || jsonValue) {
    const selectedLanguage = language ?? "json";
    return (
      <ToolOutput
        mode="scroll"
        ariaLabel={`${selectedLanguage === "html" ? "HTML" : "JSON"} output`}
      >
        <HighlightedCode
          code={jsonValue ?? value}
          language={selectedLanguage}
          className="tool-highlight"
        />
      </ToolOutput>
    );
  }
  return (
    <div className="relative overflow-hidden rounded-lg bg-muted/45">
      <CircleAlert
        className="absolute top-3 left-3 size-3 text-muted-foreground/60"
        aria-hidden="true"
      />
      <ToolOutput>
        <pre className="m-0 p-3 pl-8 font-mono text-code-compact/relaxed whitespace-pre-wrap">
          {value}
        </pre>
      </ToolOutput>
    </div>
  );
}
