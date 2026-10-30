import type { CodeViewItem, SelectedLineRange } from "@pierre/diffs";
import { CodeView, type CodeViewHandle } from "@pierre/diffs/react";
import { useAtomValue } from "jotai";
import {
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  EyeOff,
  FileCode2,
  FolderTree,
  RefreshCw,
  WrapText,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  pullRequestKey,
  type PullRequestDetail,
  type PullRequestFile,
  type PullRequestRef,
} from "../../../../shared/source-control-contract";
import { resolvedAppearanceAtom } from "../../../atoms/appearance";
import { useElementWidth } from "../../../hooks/use-element-width";
import {
  usePullRequestFiles,
  usePullRequestTimeline,
  useSetPullRequestFileViewed,
} from "../../../hooks/use-source-control";
import { cn } from "../../../lib/cn";
import { hasTwoSidedChanges, resolveDiffLayout } from "../../../lib/diff-layout";
import { canCommentOnRange } from "../../../lib/review-comments";
import { showErrorToast } from "../../../lib/toast-error";
import { pierreReviewTheme, pierreViewerStyle } from "../../file-viewer-theme";
import { ReviewCommentEditor } from "../../review-comment-editor";
import { Button } from "../../ui/button";
import { Checkbox } from "../../ui/checkbox";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "../../ui/empty";
import { Spinner } from "../../ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../ui/tooltip";
import { DiffFindBar, useDiffFind } from "../../workbench-tabs/diff-find";
import {
  DiffViewOptionsMenu,
  useDiffViewPreferences,
} from "../../workbench-tabs/diff-view-options";
import { usePendingReview } from "./pending-review-store";
import {
  annotationSignature,
  buildFileAnnotations,
  countViewed,
  draftAnchorFromRange,
  hashString,
  isFileCollapsed,
  isLineInFileDiff,
  lineReviewThreads,
  orderPullRequestFiles,
  presentPullRequestFile,
  toViewerSide,
  type PresentedPullRequestFile,
  type ReviewAnnotationGroup,
} from "./pull-request-code-model";
import {
  ChangedSinceViewed,
  filePathParts,
  fileStatusLabel,
  PullRequestFileList,
} from "./pull-request-file-list";
import { ReviewAnnotation } from "./pull-request-review-annotation";
import { PendingCommentsTray, PullRequestReviewPopover } from "./pull-request-review-popover";

/** Timeline pages read in the background so review threads on later pages still show. */
const MAX_TIMELINE_PAGES = 20;

type Item = CodeViewItem<undefined>;
type Selection = { id: string; range: SelectedLineRange };

/**
 * The Code tab of a pull request: GitHub's changed files and patches with viewed marks,
 * existing review threads on their lines, and a pending review that line comments join.
 */
export function PullRequestCodeTab({ pullRequest }: { pullRequest: PullRequestDetail }) {
  // Local view state (folds, selection, open editor) belongs to one pull request.
  return <PullRequestCode key={pullRequestKey(pullRequest)} pullRequest={pullRequest} />;
}

function PullRequestCode({ pullRequest }: { pullRequest: PullRequestDetail }) {
  const { host, repository, number } = pullRequest;
  const ref = useMemo<PullRequestRef>(
    () => ({ host, repository, number }),
    [host, repository, number],
  );
  const files = usePullRequestFiles(ref);

  if (files.isPending) {
    return (
      <div className="flex h-full min-h-0 flex-1 items-center justify-center gap-2 text-meta text-muted-foreground">
        <Spinner /> Loading changed files
      </div>
    );
  }
  if (files.isError) {
    return (
      <Empty className="h-full min-h-0 flex-1 rounded-none p-5">
        <EmptyHeader>
          <EmptyTitle>Could not load changed files</EmptyTitle>
          <EmptyDescription>{files.error.message}</EmptyDescription>
        </EmptyHeader>
        <Button type="button" variant="outline" size="sm" onClick={() => void files.refetch()}>
          <RefreshCw data-icon="inline-start" /> Retry
        </Button>
      </Empty>
    );
  }
  if (files.data.files.length === 0) {
    return (
      <Empty className="h-full min-h-0 flex-1 rounded-none p-5">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <FileCode2 aria-hidden="true" />
          </EmptyMedia>
          <EmptyTitle>No changed files</EmptyTitle>
          <EmptyDescription>This pull request does not change any files.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  return (
    <PullRequestCodeReview
      pullRequest={pullRequest}
      pullRequestRef={ref}
      files={files.data.files}
      truncated={files.data.truncated}
      filesHeadOid={files.data.headOid}
      refreshing={files.isFetching}
      onRefresh={() => void files.refetch()}
    />
  );
}

function PullRequestCodeReview({
  pullRequest,
  pullRequestRef: ref,
  files,
  truncated,
  filesHeadOid,
  refreshing,
  onRefresh,
}: {
  pullRequest: PullRequestDetail;
  pullRequestRef: PullRequestRef;
  files: readonly PullRequestFile[];
  truncated: boolean;
  /** The head these patches were read at; review comments anchor to it. */
  filesHeadOid: string;
  refreshing: boolean;
  onRefresh(): void;
}) {
  const appearance = useAtomValue(resolvedAppearanceAtom);
  const [preferences] = useDiffViewPreferences();
  const pending = usePendingReview(pullRequestKey(ref));
  const setViewed = useSetPullRequestFileViewed();
  const timeline = usePullRequestTimeline(ref);
  const [showFiles, setShowFiles] = useState(true);
  const [hideViewed, setHideViewed] = useState(false);
  const [lineWrap, setLineWrap] = useState(false);
  const [collapseOverrides, setCollapseOverrides] = useState<ReadonlyMap<string, boolean>>(
    () => new Map(),
  );
  const [selection, setSelection] = useState<Selection | null>(null);
  const [activePath, setActivePath] = useState<string | null>(null);
  const codeViewRef = useRef<CodeViewHandle<undefined, undefined>>(null);
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const diffWidth = useElementWidth(container);

  // Review threads may sit on any timeline page; read the rest in the background.
  const { hasNextPage, isFetchingNextPage, isError: timelineFailed, fetchNextPage } = timeline;
  const timelinePages = timeline.data?.pages.length ?? 0;
  useEffect(() => {
    if (!hasNextPage || isFetchingNextPage || timelineFailed) return;
    if (timelinePages >= MAX_TIMELINE_PAGES) return;
    void fetchNextPage();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage, timelineFailed, timelinePages]);
  const threads = useMemo(
    () => lineReviewThreads(timeline.data?.pages.flatMap((page) => page.items) ?? []),
    [timeline.data],
  );

  const ordered = useMemo(() => orderPullRequestFiles(files), [files]);
  const presented = useMemo(
    () => ordered.map((file) => presentPullRequestFile(file, preferences.hideWhitespace)),
    [ordered, preferences.hideWhitespace],
  );
  const byPath = useMemo(
    () => new Map(presented.map((entry) => [entry.file.path, entry])),
    [presented],
  );
  const visible = useMemo(
    () => (hideViewed ? presented.filter((entry) => entry.file.viewed !== "viewed") : presented),
    [hideViewed, presented],
  );

  // CodeView annotations carry only their position; the groups they show are looked up here,
  // which keeps the viewer's handle untyped by annotation data for Find in diff.
  const { items, annotationGroups } = useMemo(() => {
    const groups = new Map<string, ReviewAnnotationGroup>();
    const list = visible.map(({ file, fileDiff, contentHash }): Item => {
      const viewedMark = file.viewed[0];
      if (!fileDiff) {
        // Nothing to draw: the header carries the explanation and the GitHub link.
        const version = hashString(`${contentHash}:${viewedMark}`);
        return {
          id: file.path,
          type: "file",
          file: { name: file.path, contents: "", cacheKey: `${file.path}:${contentHash}` },
          collapsed: true,
          version,
        };
      }
      const collapsed = isFileCollapsed(file, collapseOverrides);
      const annotations = buildFileAnnotations(
        file.path,
        fileDiff,
        threads,
        pending.review.comments,
      );
      for (const annotation of annotations) {
        groups.set(
          annotationKey(file.path, annotation.side, annotation.lineNumber),
          annotation.metadata,
        );
      }
      const version = hashString(
        `${contentHash}:${collapsed ? 1 : 0}:${viewedMark}:${annotationSignature(annotations)}`,
      );
      return {
        id: file.path,
        type: "diff",
        fileDiff,
        annotations: annotations.map(({ side, lineNumber }) => ({ side, lineNumber })),
        collapsed,
        version,
      };
    });
    return { items: list, annotationGroups: groups };
  }, [collapseOverrides, pending.review.comments, threads, visible]);

  const setCollapsed = useCallback((path: string, collapsed: boolean) => {
    setCollapseOverrides((current) => {
      if (current.get(path) === collapsed) return current;
      const next = new Map(current);
      next.set(path, collapsed);
      return next;
    });
  }, []);
  const togglePath = useCallback(
    (path: string) => {
      const entry = byPath.get(path);
      if (!entry?.fileDiff) return;
      setCollapsed(path, !isFileCollapsed(entry.file, collapseOverrides));
    },
    [byPath, collapseOverrides, setCollapsed],
  );
  const allCollapsed = items.every((item) => item.collapsed === true);
  const toggleAll = () =>
    setCollapseOverrides(new Map(presented.map((entry) => [entry.file.path, !allCollapsed])));

  const markViewed = useCallback(
    (path: string, viewed: boolean) => {
      // Ticking a file folds it away; unticking brings it back, as on GitHub.
      setCollapsed(path, viewed);
      setViewed.mutate(
        { ...ref, path, viewed },
        {
          onError: (error) => {
            setCollapsed(path, !viewed);
            showErrorToast("Could not update the viewed mark", error);
          },
        },
      );
    },
    [ref, setCollapsed, setViewed],
  );

  const viewedCount = countViewed(files);
  const totals = useMemo(
    () =>
      presented.reduce(
        (sum, entry) => ({
          additions: sum.additions + entry.additions,
          deletions: sum.deletions + entry.deletions,
        }),
        { additions: 0, deletions: 0 },
      ),
    [presented],
  );

  const findSources = useMemo(
    () =>
      items.map((item) => ({ id: item.id, fileDiff: item.type === "diff" ? item.fileDiff : null })),
    [items],
  );
  const twoSided = useMemo(
    () => findSources.some((source) => hasTwoSidedChanges(source.fileDiff)),
    [findSources],
  );
  const diffStyle = resolveDiffLayout(preferences.layout, { width: diffWidth, twoSided });
  const find = useDiffFind({
    sources: findSources,
    codeView: codeViewRef,
    container,
    onRevealItem: (path) => setCollapsed(path, false),
  });

  useEffect(() => {
    // CodeView keeps its ref callback stable, so set attributes on the mounted container.
    if (!container) return;
    container.tabIndex = 0;
    container.setAttribute("role", "region");
    container.setAttribute("aria-label", "Pull request diff");
  }, [container]);

  const revealFile = useCallback(
    (path: string) => {
      setActivePath(path);
      const entry = byPath.get(path);
      if (entry?.fileDiff) setCollapsed(path, false);
      if (hideViewed && entry?.file.viewed === "viewed") setHideViewed(false);
      requestAnimationFrame(() =>
        codeViewRef.current?.scrollTo({
          type: "item",
          id: path,
          align: "start",
          behavior: "smooth-auto",
        }),
      );
    },
    [byPath, hideViewed, setCollapsed],
  );
  const revealLine = useCallback(
    (path: string, line: number, side: "LEFT" | "RIGHT") => {
      setActivePath(path);
      setCollapsed(path, false);
      if (hideViewed && byPath.get(path)?.file.viewed === "viewed") setHideViewed(false);
      requestAnimationFrame(() =>
        codeViewRef.current?.scrollTo({
          type: "line",
          id: path,
          lineNumber: line,
          side: toViewerSide(side),
          align: "center",
        }),
      );
    },
    [byPath, hideViewed, setCollapsed],
  );

  const selectedEntry = selection ? byPath.get(selection.id) : undefined;
  const saveComment = (text: string) => {
    if (!selection || !selectedEntry?.fileDiff) return;
    const anchor = draftAnchorFromRange(selection.range);
    const inDiff =
      isLineInFileDiff(selectedEntry.fileDiff, anchor.side, anchor.line) &&
      (anchor.startLine === undefined ||
        isLineInFileDiff(selectedEntry.fileDiff, anchor.side, anchor.startLine));
    if (!inDiff || !text.trim()) return;
    pending.addComment({ path: selection.id, ...anchor, body: text.trim() });
    setSelection(null);
  };

  const filesUrl = pullRequest.capabilities ? pullRequest.url : `${pullRequest.url}/files`;

  return (
    <div
      className="@container/pr-code flex h-full min-h-[28rem] flex-1 flex-col bg-card"
      onKeyDown={find.onKeyDown}
    >
      <div className="flex h-9 shrink-0 items-center gap-1.5 border-b border-border bg-background px-2">
        <Button
          type="button"
          variant={showFiles ? "secondary" : "ghost"}
          size="sm"
          aria-label={showFiles ? "Hide file list" : "Show file list"}
          aria-pressed={showFiles}
          onClick={() => setShowFiles((value) => !value)}
        >
          <FolderTree data-icon="inline-start" aria-hidden="true" />
          <span className="hidden @min-[32rem]/pr-code:inline">Files</span>
        </Button>
        <span className="text-meta text-muted-foreground tabular-nums" aria-live="polite">
          {viewedCount} of {files.length} viewed
        </span>
        <Button
          type="button"
          variant={hideViewed ? "secondary" : "ghost"}
          size="sm"
          aria-label="Hide viewed"
          aria-pressed={hideViewed}
          onClick={() => setHideViewed((value) => !value)}
        >
          <EyeOff data-icon="inline-start" aria-hidden="true" />
          <span className="hidden @min-[40rem]/pr-code:inline">Hide viewed</span>
        </Button>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <span className="mr-1 hidden items-center gap-1.5 font-mono text-diff tabular-nums @min-[52rem]/pr-code:flex">
            <span className="text-success">+{totals.additions}</span>
            <span className="text-destructive">−{totals.deletions}</span>
          </span>
          <PendingCommentsTray pending={pending} onReveal={revealLine} />
          <DiffViewOptionsMenu layout={diffStyle} onFind={find.openFind} />
          <ToolbarToggle
            label={lineWrap ? "Disable line wrap" : "Enable line wrap"}
            pressed={lineWrap}
            onClick={() => setLineWrap((value) => !value)}
          >
            <WrapText />
          </ToolbarToggle>
          <ToolbarToggle
            label={allCollapsed ? "Expand all files" : "Collapse all files"}
            onClick={toggleAll}
          >
            {allCollapsed ? <ChevronsUpDown /> : <ChevronsDownUp />}
          </ToolbarToggle>
          <ToolbarToggle label="Refresh files" onClick={onRefresh}>
            <RefreshCw className={cn(refreshing && "animate-spin")} />
          </ToolbarToggle>
          <PullRequestReviewPopover
            pullRequest={pullRequest}
            commitOid={filesHeadOid}
            pending={pending}
          />
        </div>
      </div>
      <div className="relative grid min-h-0 flex-1 grid-cols-1 overflow-hidden @min-[46rem]/pr-code:grid-cols-[16rem_minmax(0,1fr)]">
        <aside
          aria-label="Files"
          className={cn(
            "absolute inset-0 z-10 min-h-0 flex-col border-r border-border bg-background @min-[46rem]/pr-code:static @min-[46rem]/pr-code:z-auto",
            showFiles ? "flex" : "hidden",
          )}
        >
          <div className="flex h-8 shrink-0 items-center border-b border-border px-2 text-meta text-muted-foreground">
            <span className="tabular-nums">
              {files.length} {files.length === 1 ? "file" : "files"}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="ml-auto @min-[46rem]/pr-code:hidden"
              aria-label="Close file list"
              onClick={() => setShowFiles(false)}
            >
              <X />
            </Button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            <PullRequestFileList
              viewedSupported={pullRequest.capabilities?.fileViewed !== false}
              files={hideViewed ? ordered.filter((file) => file.viewed !== "viewed") : ordered}
              activePath={activePath}
              onSelect={revealFile}
              onViewedChange={markViewed}
            />
          </div>
        </aside>
        <DiffFindBar controller={find} />
        <div
          className={cn(
            "min-h-0 min-w-0 overflow-hidden bg-card",
            !showFiles && "@min-[46rem]/pr-code:col-span-2",
          )}
        >
          {items.length === 0 ? (
            <Empty className="h-full rounded-none p-5">
              <EmptyHeader>
                <EmptyTitle>All files viewed</EmptyTitle>
                <EmptyDescription>Turn off Hide viewed to read them again.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <CodeView
              ref={codeViewRef}
              containerRef={setContainer}
              items={items}
              selectedLines={selection}
              onSelectedLinesChange={(next) =>
                setSelection(
                  next &&
                    pullRequest.capabilities?.inlineReview !== false &&
                    canCommentOnRange(next.range) &&
                    items.some((item) => item.id === next.id && item.type === "diff")
                    ? next
                    : null,
                )
              }
              options={{
                ...pierreReviewTheme,
                theme: appearance.codeThemePair,
                themeType: appearance.scheme,
                diffStyle,
                expandUnchanged: false,
                overflow: lineWrap ? "wrap" : "scroll",
                diffIndicators: "none",
                hunkSeparators: "line-info-basic",
                itemMetrics: { lineHeight: 16, diffHeaderHeight: 32 },
                layout: { paddingTop: 0, paddingBottom: 4, gap: 2 },
                lineDiffType: preferences.inline,
                onPostRender: find.refresh,
                lineHoverHighlight: "line",
                stickyHeaders: true,
                enableLineSelection: true,
              }}
              className="size-full overflow-auto"
              style={pierreViewerStyle}
              renderAnnotation={(annotation, _contents, item) => {
                const group =
                  "side" in annotation
                    ? annotationGroups.get(
                        annotationKey(item.id, annotation.side, annotation.lineNumber),
                      )
                    : undefined;
                return group ? (
                  <ReviewAnnotation group={group} onRemovePending={pending.removeComment} />
                ) : null;
              }}
              renderCodeViewFooter={() =>
                truncated ? (
                  <p className="px-3 py-2 text-meta text-muted-foreground">
                    GitHub lists at most 3,000 files.{" "}
                    <a
                      href={filesUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-foreground underline"
                    >
                      Open on GitHub
                    </a>{" "}
                    to see the rest.
                  </p>
                ) : null
              }
              renderCustomHeader={(item) => {
                const entry = byPath.get(item.id);
                if (!entry) return null;
                return (
                  <FileHeader
                    viewedSupported={pullRequest.capabilities?.fileViewed !== false}
                    entry={entry}
                    collapsed={item.collapsed === true}
                    filesUrl={filesUrl}
                    onToggle={togglePath}
                    onViewedChange={markViewed}
                  />
                );
              }}
            />
          )}
        </div>
      </div>
      {selection && selectedEntry?.fileDiff ? (
        <ReviewCommentEditor
          key={`${selection.id}:${selection.range.start}:${selection.range.end}:${selection.range.side}`}
          path={selection.id}
          range={selection.range}
          onSave={saveComment}
          onCancel={() => setSelection(null)}
        />
      ) : null}
    </div>
  );
}

function annotationKey(path: string, side: string, line: number): string {
  return `${path}\u0000${side}\u0000${line}`;
}

function FileHeader({
  viewedSupported = true,
  entry,
  collapsed,
  filesUrl,
  onToggle,
  onViewedChange,
}: {
  viewedSupported?: boolean;
  entry: PresentedPullRequestFile;
  collapsed: boolean;
  filesUrl: string;
  onToggle(path: string): void;
  onViewedChange(path: string, viewed: boolean): void;
}) {
  const { file, fileDiff, additions, deletions, whitespaceOnly } = entry;
  const { directory, name } = filePathParts(file.path);
  const unavailable = !fileDiff && !whitespaceOnly;
  const foldable = Boolean(fileDiff);
  return (
    <div
      role={foldable ? "button" : undefined}
      tabIndex={foldable ? 0 : undefined}
      aria-expanded={foldable ? !collapsed : undefined}
      aria-label={foldable ? `${collapsed ? "Expand" : "Collapse"} ${file.path}` : undefined}
      data-palot-diff-header={file.path}
      title={file.path}
      className={cn(
        "group/header flex h-8 w-full items-center gap-2 px-2 text-left outline-none",
        foldable && "cursor-pointer hover:bg-muted/55 focus-visible:bg-muted/55",
      )}
      onClick={() => foldable && onToggle(file.path)}
      onKeyDown={(event) => {
        if (!foldable || event.target !== event.currentTarget) return;
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        onToggle(file.path);
      }}
    >
      {foldable ? (
        collapsed ? (
          <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        ) : (
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        )
      ) : (
        <FileCode2 className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      )}
      <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
        <span className="min-w-0 truncate text-tree">
          {file.previousPath && file.previousPath !== file.path ? (
            <span className="text-muted-foreground">{file.previousPath} → </span>
          ) : null}
          {directory ? <span className="text-muted-foreground">{directory}/</span> : null}
          <span className="font-medium text-foreground">{name}</span>
        </span>
        <span className="sr-only">{fileStatusLabel(file.status)}</span>
        <span className="flex shrink-0 items-center gap-1 font-mono text-diff tabular-nums">
          <span className="text-success">+{additions}</span>
          <span className="text-destructive">−{deletions}</span>
        </span>
      </span>
      {unavailable ? (
        <span className="flex shrink-0 items-center gap-1.5 text-micro text-muted-foreground">
          Diff not available here
          <a
            href={filesUrl}
            target="_blank"
            rel="noreferrer"
            className="text-foreground underline underline-offset-2"
            onClick={(event) => event.stopPropagation()}
          >
            Open on GitHub
          </a>
        </span>
      ) : whitespaceOnly ? (
        <span className="shrink-0 text-micro text-muted-foreground">Whitespace changes hidden</span>
      ) : null}
      {file.viewed === "dismissed" ? <ChangedSinceViewed /> : null}
      {/* The header folds the file; the checkbox keeps its press to itself. */}
      <label
        className="flex shrink-0 cursor-pointer items-center gap-1.5 text-micro text-muted-foreground select-none"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
      >
        <Checkbox
          aria-label={`Mark ${file.path} as viewed`}
          disabled={!viewedSupported}
          title={
            !viewedSupported
              ? "Viewed marks are not supported for this host in Palot yet."
              : undefined
          }
          checked={file.viewed === "viewed"}
          onCheckedChange={(checked) => onViewedChange(file.path, checked)}
        />
        <span className="hidden @min-[32rem]/pr-code:inline">Viewed</span>
      </label>
    </div>
  );
}

function ToolbarToggle({
  label,
  pressed,
  onClick,
  children,
}: {
  label: string;
  pressed?: boolean;
  onClick(): void;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant={pressed ? "secondary" : "ghost"}
            size="icon-sm"
            aria-label={label}
            aria-pressed={pressed}
            onClick={onClick}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
