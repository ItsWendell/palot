import type { FileDiffInfo, LocationRef } from "@opencode/client";
import type { CodeViewItem, SelectedLineRange } from "@pierre/diffs";
import type { GitStatusEntry } from "@pierre/trees";
import { CodeView, type CodeViewHandle } from "@pierre/diffs/react";
import { FileTree, useFileTree } from "@pierre/trees/react";
import {
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Copy,
  ExternalLink,
  Eye,
  FileCode2,
  Files,
  FolderGit2,
  FolderTree,
  GitBranch,
  RefreshCw,
  Search,
  WrapText,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { useAtomValue } from "jotai";
import { resolvedAppearanceAtom } from "../../atoms/appearance";
import type { WorkbenchPaneID, WorkbenchTab } from "../../lib/workbench-tabs";
import { useLocationDiffs } from "../../hooks/use-location-diffs";
import { useVcsInfo } from "../../hooks/use-vcs-info";
import { useElementWidth } from "../../hooks/use-element-width";
import { useInitializeGit, useVcsProvider } from "../../hooks/use-vcs-repository";
import { useWorkbenchCommands } from "../../atoms/workbench";
import type { WorkbenchScope } from "../../lib/workbench-tabs";
import { resolveFileDiff } from "../../lib/file-diffs";
import { hasTwoSidedChanges, resolveDiffLayout } from "../../lib/diff-layout";
import { presentFileDiff, type PresentedFileDiff } from "../../lib/diff-whitespace";
import { canCommentOnRange } from "../../lib/review-comments";
import {
  changedFileKindLabel,
  classifyChangedFile,
  isQuietKind,
  summarizeChanges,
  type ChangedFileKind,
} from "../../lib/changed-file-kind";
import { useGeneratedAttributes } from "../../hooks/use-generated-attributes";
import { ChangedFileKindBadge, ChangeSummaryCounts } from "../changed-file-kind";
import {
  changesViewedScope,
  diffFingerprint,
  setFileViewed,
  useViewedMarks,
  viewedState,
} from "../../lib/changes-viewed";
import { ChangedSinceViewed } from "../pull-requests/code/pull-request-file-list";
import { Checkbox } from "../ui/checkbox";
import { cn } from "../../lib/cn";
import { writeClipboardText } from "../../lib/clipboard";
import { pierreReviewTheme, pierreViewerStyle } from "../file-viewer-theme";
import { DiffContextToggle } from "../diff-context-toggle";
import { Button } from "../ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "../ui/empty";
import { Spinner } from "../ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "../ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import { ReviewBasePicker, ReviewBaseStatus } from "./review-base-picker";
import { DIFF_FIND_CODE_VIEW_SEARCH, DiffFindBar, useDiffFind } from "./diff-find";
import { DiffChangeRail, codeViewRailSource } from "./diff-change-rail";
import {
  ChangesSourceControlPanel,
  StageCheckbox,
  useChangesSourceControl,
} from "./changes-source-control";
import { DiffViewOptionsMenu, useDiffViewPreferences } from "./diff-view-options";
import { ReviewCommentEditor, useReviewComments } from "../review-comment-editor";
import { ChangedFileNavigationControls, useChangedFileNavigation } from "./changed-file-navigation";

/** CodeView metrics below, so the change rail places each file's rows under its header. */
const CODE_VIEW_RAIL_METRICS = { headerHeight: 32, gap: 2, paddingBottom: 4 };

/** Tree selection and previous/next file share one item scroll offset. */
const FILE_SCROLL_OFFSET = 34;

const treeStyle = {
  height: "100%",
  border: 0,
  background: "var(--background)",
  "--trees-accent-override": "var(--ring)",
  "--trees-bg-override": "var(--background)",
  "--trees-bg-muted-override": "var(--muted)",
  "--trees-border-color-override": "var(--border)",
  "--trees-border-radius-override": "5px",
  "--trees-fg-override": "var(--foreground)",
  "--trees-fg-muted-override": "var(--muted-foreground)",
  "--trees-font-family-override": "var(--font-sans)",
  "--trees-font-size-override": "var(--theme-tree-font-size)",
  "--trees-git-added-color-override": "var(--success)",
  "--trees-git-deleted-color-override": "var(--destructive)",
  "--trees-git-modified-color-override": "var(--info)",
  "--trees-input-bg-override": "var(--card)",
  "--trees-selected-bg-override": "var(--accent)",
  "--trees-selected-fg-override": "var(--accent-foreground)",
} as CSSProperties;

const EMPTY_DIFFS: FileDiffInfo[] = [];

/**
 * Quiet files (lockfiles, generated files, migrations) fade in the tree. Their decoration
 * carries a marker custom property, since tree rows expose no attribute of their own for it.
 */
const QUIET_TREE_MARKER = "--palot-quiet-file";
const quietTreeCSS = `
[data-type="item"]:has(> [data-item-section="decoration"] [style*="${QUIET_TREE_MARKER}"]) > :is([data-item-section="content"], [data-item-section="icon"]) {
  opacity: 0.55;
}`;

function treeDecoration(kind: ChangedFileKind | undefined) {
  const label = kind ? changedFileKindLabel(kind) : null;
  if (!kind || !label) return null;
  if (!isQuietKind(kind)) return { text: label };
  return {
    text: label,
    title: `${label}, collapsed by default`,
    parts: [{ text: label, color: `var(${QUIET_TREE_MARKER}, var(--trees-fg-muted))` }],
  };
}

export function ChangesTab({
  tab,
  pane,
  scope,
  active = true,
}: {
  tab: Extract<WorkbenchTab, { kind: "changes" }>;
  pane: WorkbenchPaneID;
  scope: WorkbenchScope;
  active?: boolean;
}) {
  const appearance = useAtomValue(resolvedAppearanceAtom);
  const review = useReviewComments(tab.resource.profileID, tab.resource.sourceSessionID);
  const [selection, setSelection] = useState<{ id: string; range: SelectedLineRange } | null>(null);
  const [expandUnchanged, setExpandUnchanged] = useState(false);
  const modeLabel = tab.resource.mode === "branch" ? "branch" : "working";
  const query = useLocationDiffs(
    tab.resource.location,
    active,
    tab.resource.mode,
    expandUnchanged ? null : 3,
  );
  const commands = useWorkbenchCommands(scope);
  const diffs = query.data ?? EMPTY_DIFFS;
  const [showTree, setShowTree] = useState(pane === "bottom");
  const [preferences] = useDiffViewPreferences();
  const [lineWrap, setLineWrap] = useState(false);
  // What the reader folded or opened; files without an entry follow their kind.
  const [collapseOverrides, setCollapseOverrides] = useState<ReadonlyMap<string, boolean>>(
    () => new Map(),
  );
  const codeViewRef = useRef<CodeViewHandle<undefined, undefined>>(null);
  const paths = useMemo(() => diffs.map((file) => file.file), [diffs]);
  const attributeRules = useGeneratedAttributes(tab.resource.location, active && diffs.length > 0);
  const kinds = useMemo(
    () => new Map(paths.map((path) => [path, classifyChangedFile(path, attributeRules)])),
    [attributeRules, paths],
  );
  const kindsRef = useRef(kinds);
  const viewedScope = changesViewedScope(
    tab.resource.profileID,
    tab.resource.sourceSessionID ?? tab.resource.location.directory,
    tab.resource.mode,
  );
  const viewedMarks = useViewedMarks(viewedScope);
  // Raw patches, not the whitespace-folded view, so the display option never resets a mark.
  const fingerprints = useMemo(
    () => new Map(diffs.map((file) => [file.file, diffFingerprint(file.patch, file.status)])),
    [diffs],
  );
  const viewed = useMemo(
    () =>
      new Map(paths.map((path) => [path, viewedState(viewedMarks, path, fingerprints.get(path))])),
    [fingerprints, paths, viewedMarks],
  );
  const viewedCount = paths.filter((path) => viewed.get(path) === "viewed").length;
  const collapsedPaths = useMemo(
    () =>
      new Set(
        paths.filter(
          (path) =>
            collapseOverrides.get(path) ??
            (viewed.get(path) === "viewed" ||
              (preferences.collapseQuietFiles && isQuietKind(kinds.get(path) ?? "regular"))),
        ),
      ),
    [collapseOverrides, kinds, paths, preferences.collapseQuietFiles, viewed],
  );
  // Without Git, OpenCode reports no changes and no review base; ask only then.
  const repositoryCheck =
    active &&
    (tab.resource.mode === "branch"
      ? !query.reviewBase.ref
      : query.isSuccess && diffs.length === 0);
  const provider = useVcsProvider(tab.resource.location, repositoryCheck);
  const noRepository = repositoryCheck && provider.isSuccess && provider.data === null;
  const sourceControl = useChangesSourceControl({
    profileID: tab.resource.profileID,
    directory: tab.resource.location.directory,
    enabled: active && tab.resource.mode === "working" && !noRepository,
    diffs,
    diffsUpdatedAt: query.dataUpdatedAt ?? 0,
    ...(tab.resource.sourceSessionID ? { sessionID: tab.resource.sourceSessionID } : {}),
  });
  const pathSetRef = useRef<Set<string>>(new Set());
  const navigation = useChangedFileNavigation({
    ids: paths,
    codeView: codeViewRef,
    scrollOffset: FILE_SCROLL_OFFSET,
  });
  const goToFile = navigation.goTo;

  useLayoutEffect(() => {
    pathSetRef.current = new Set(paths);
  }, [paths]);
  useLayoutEffect(() => {
    kindsRef.current = kinds;
  }, [kinds]);
  const gitStatus = useMemo<GitStatusEntry[]>(
    () => diffs.map((file) => ({ path: file.file, status: file.status })),
    [diffs],
  );
  const presented = useMemo(
    () => diffs.map((file) => presentFileDiff(file, preferences.hideWhitespace)),
    [diffs, preferences.hideWhitespace],
  );
  const items = useMemo<CodeViewItem<undefined>[]>(
    () => presented.map((file) => reviewItem(file, collapsedPaths.has(file.file))),
    [collapsedPaths, presented],
  );
  const diffByPath = useMemo(
    () => new Map(presented.map((file) => [file.file, file])),
    [presented],
  );
  const { model: tree } = useFileTree({
    paths,
    gitStatus,
    density: "compact",
    dragAndDrop: false,
    flattenEmptyDirectories: true,
    initialExpansion: "open",
    renaming: false,
    search: true,
    stickyFolders: true,
    renderRowDecoration: ({ item }) =>
      item.kind === "file" ? treeDecoration(kindsRef.current.get(item.path)) : null,
    unsafeCSS: quietTreeCSS,
    onSelectionChange(selectedPaths) {
      const path = selectedPaths.at(-1);
      if (!path || !pathSetRef.current.has(path)) return;
      goToFile(path);
    },
  });
  const summary = useMemo(
    () =>
      summarizeChanges(
        presented.map((file) => ({
          kind: kinds.get(file.file) ?? "regular",
          additions: file.additions,
          deletions: file.deletions,
        })),
      ),
    [kinds, presented],
  );
  const allCollapsed = diffs.length > 0 && collapsedPaths.size === diffs.length;
  const setCollapsed = useCallback((path: string, collapsed: boolean) => {
    setCollapseOverrides((current) => {
      if (current.get(path) === collapsed) return current;
      const next = new Map(current);
      next.set(path, collapsed);
      return next;
    });
  }, []);
  const togglePath = useCallback(
    (path: string) => setCollapsed(path, !collapsedPaths.has(path)),
    [collapsedPaths, setCollapsed],
  );
  const markViewed = useCallback(
    (path: string, value: boolean) => {
      // Ticking a file folds it away; unticking brings it back, as in the pull request Code tab.
      setCollapsed(path, value);
      setFileViewed(viewedScope, path, value ? (fingerprints.get(path) ?? null) : null, paths);
    },
    [fingerprints, paths, setCollapsed, viewedScope],
  );
  const [codeViewContainer, setCodeViewContainer] = useState<HTMLDivElement | null>(null);
  const diffWidth = useElementWidth(codeViewContainer);
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
  const railItems = useMemo(
    () => findSources.map((source) => ({ ...source, collapsed: collapsedPaths.has(source.id) })),
    [collapsedPaths, findSources],
  );
  const find = useDiffFind({
    sources: findSources,
    codeView: codeViewRef,
    container: codeViewContainer,
    // Find searches folded files too and opens the one holding the match.
    onRevealItem: (path) => setCollapsed(path, false),
  });
  useEffect(() => {
    // CodeView keeps its internal ref callback stable, so changing our callback
    // alone does not update attributes on an already mounted scroll container.
    if (!codeViewContainer) return;
    codeViewContainer.tabIndex = 0;
    codeViewContainer.setAttribute(
      "aria-label",
      `${modeLabel === "branch" ? "Branch" : "Working tree"} review`,
    );
    codeViewContainer.setAttribute("role", "region");
  }, [codeViewContainer, modeLabel]);

  useEffect(() => {
    // Rows read their kind label while rendering, so a late .gitattributes read (a new
    // `kinds`) redraws them along with the paths.
    void kinds;
    tree.resetPaths(paths);
    tree.setGitStatus(gitStatus);
  }, [gitStatus, kinds, paths, tree]);

  useEffect(() => {
    setCollapseOverrides((current) => {
      const next = new Map([...current].filter(([path]) => pathSetRef.current.has(path)));
      return next.size === current.size ? current : next;
    });
  }, [paths]);

  if (noRepository) {
    return (
      <div className="flex min-h-0 flex-1 flex-col bg-card">
        <ReviewModeBar tab={tab} pane={pane} commands={commands} active={active} />
        <InitializeGitEmpty location={tab.resource.location} />
      </div>
    );
  }
  if (tab.resource.mode === "branch" && !query.reviewBase.ref) {
    return (
      <div className="flex min-h-0 flex-1 flex-col bg-card">
        <ReviewModeBar tab={tab} pane={pane} commands={commands} active={active} />
        <div className="flex flex-1 items-center justify-center p-5">
          <ReviewBaseStatus base={query.reviewBase} />
        </div>
      </div>
    );
  }
  if (query.isPending) {
    return (
      <div className="flex min-h-0 flex-1 flex-col bg-card">
        <ReviewModeBar tab={tab} pane={pane} commands={commands} active={active} />
        <div className="flex min-h-0 flex-1 items-center justify-center gap-2 text-xs text-muted-foreground">
          <Spinner /> Loading {modeLabel} changes
        </div>
      </div>
    );
  }
  if (query.isError) {
    return (
      <div className="flex min-h-0 flex-1 flex-col bg-card">
        <ReviewModeBar tab={tab} pane={pane} commands={commands} active={active} />
        <Empty className="min-h-0 flex-1 rounded-none p-5">
          <EmptyHeader>
            <EmptyTitle>Could not load changes</EmptyTitle>
            <EmptyDescription>{query.error.message}</EmptyDescription>
          </EmptyHeader>
          <Button type="button" variant="outline" size="sm" onClick={() => void query.refetch()}>
            <RefreshCw data-icon="inline-start" /> Retry
          </Button>
        </Empty>
      </div>
    );
  }
  if (diffs.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 flex-col bg-card">
        <ReviewModeBar tab={tab} pane={pane} commands={commands} active={active} />
        <Empty className="min-h-0 flex-1 rounded-none p-5">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FileCode2 aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>No {modeLabel} changes</EmptyTitle>
            <EmptyDescription>
              {tab.resource.mode === "branch"
                ? "Changes from this branch relative to the selected review base appear here."
                : "Working tree changes for this workspace appear here."}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
        <ChangesSourceControlPanel controller={sourceControl} />
      </div>
    );
  }

  return (
    <div
      className="flex min-h-0 flex-1 flex-col bg-card"
      onKeyDown={(event) => {
        find.onKeyDown(event);
        navigation.onKeyDown(event);
      }}
    >
      <div className="flex h-9 shrink-0 items-center gap-1.5 border-b border-border bg-background px-2">
        <ReviewModeToggle tab={tab} pane={pane} commands={commands} />
        <Button
          type="button"
          variant={showTree ? "secondary" : "ghost"}
          size="xs"
          aria-label={showTree ? "Hide changed files" : "Show changed files"}
          aria-pressed={showTree}
          onClick={() => setShowTree((visible) => !visible)}
        >
          <FolderTree data-icon="inline-start" />
          <span className="hidden @min-[28rem]/workbench:inline">Files</span>
        </Button>
        <ChangedFileNavigationControls navigation={navigation} />
        <span
          className="ml-1 flex shrink-0 items-center gap-1 text-meta text-muted-foreground tabular-nums"
          aria-live="polite"
          data-palot-changes-viewed=""
          title={`${viewedCount} of ${paths.length} viewed`}
        >
          {/* Narrow panes keep the count as an eye and "1/8", apart from the file position;
              the sentence is what assistive tech reads. */}
          <Eye aria-hidden="true" className="size-3 @min-[34rem]/workbench:hidden" />
          <span aria-hidden="true" className="@min-[34rem]/workbench:hidden">
            {viewedCount}/{paths.length}
          </span>
          <span className="sr-only @min-[34rem]/workbench:not-sr-only">
            {viewedCount} of {paths.length} viewed
          </span>
        </span>
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <ChangeSummaryCounts summary={summary} className="hidden @min-[46rem]/workbench:flex" />
          <div className="mx-0.5 hidden h-4 w-px bg-border @min-[46rem]/workbench:block" />
          <DiffContextToggle expanded={expandUnchanged} onExpandedChange={setExpandUnchanged} />
          <DiffViewOptionsMenu layout={diffStyle} onFind={find.openFind} collapseQuietAvailable />
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant={lineWrap ? "secondary" : "ghost"}
                  size="icon-sm"
                  aria-label={lineWrap ? "Disable line wrap" : "Enable line wrap"}
                  aria-pressed={lineWrap}
                  onClick={() => setLineWrap((enabled) => !enabled)}
                />
              }
            >
              <WrapText />
            </TooltipTrigger>
            <TooltipContent>{lineWrap ? "Disable line wrap" : "Enable line wrap"}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={allCollapsed ? "Expand all diffs" : "Collapse all diffs"}
                  onClick={() =>
                    setCollapseOverrides(new Map(paths.map((path) => [path, !allCollapsed])))
                  }
                />
              }
            >
              {allCollapsed ? <ChevronsUpDown /> : <ChevronsDownUp />}
            </TooltipTrigger>
            <TooltipContent>
              {allCollapsed ? "Expand all diffs" : "Collapse all diffs"}
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Refresh changes"
                  onClick={() => {
                    void query.refetch();
                    if (sourceControl.availability === "ready") void sourceControl.refetch();
                  }}
                />
              }
            >
              <RefreshCw className={cn(query.isFetching && "animate-spin")} />
            </TooltipTrigger>
            <TooltipContent>Refresh changes</TooltipContent>
          </Tooltip>
        </div>
      </div>
      {tab.resource.mode === "branch" ? (
        <div className="min-w-0 shrink-0 border-b border-border bg-background px-2">
          <ReviewBasePicker location={tab.resource.location} active={active} />
        </div>
      ) : null}
      <div className="relative grid min-h-0 flex-1 grid-cols-1 overflow-hidden @min-[46rem]/workbench:grid-cols-[13rem_minmax(0,1fr)]">
        <aside
          className={cn(
            "absolute inset-0 z-10 min-h-0 border-r border-border bg-background @min-[46rem]/workbench:static @min-[46rem]/workbench:z-auto",
            showTree ? "flex flex-col" : "hidden",
          )}
          aria-label="Changed files"
          data-file-navigation-ignore=""
        >
          <div className="flex h-8 shrink-0 items-center border-b border-border px-2">
            <Files className="mr-1.5 size-3 text-muted-foreground" aria-hidden="true" />
            <span className="text-meta font-medium text-muted-foreground">Changed files</span>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="ml-auto"
              aria-label="Search changed files"
              onClick={() => tree.openSearch()}
            >
              <Search />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="ml-0.5 @min-[46rem]/workbench:hidden"
              aria-label="Close changed files"
              onClick={() => setShowTree(false)}
            >
              <X />
            </Button>
          </div>
          <div className="min-h-0 flex-1 py-1">
            <FileTree model={tree} style={treeStyle} />
          </div>
        </aside>
        <DiffFindBar controller={find} />
        <div
          className={cn(
            "flex min-h-0 min-w-0 overflow-hidden bg-card",
            !showTree && "@min-[46rem]/workbench:col-span-2",
          )}
          aria-label={tab.resource.mode === "branch" ? "Branch review" : "Working tree review"}
        >
          <CodeView
            ref={codeViewRef}
            containerRef={setCodeViewContainer}
            items={items}
            onScroll={navigation.onScroll}
            selectedLines={review.enabled ? selection : undefined}
            onSelectedLinesChange={
              review.enabled
                ? (next) => {
                    setSelection(
                      next &&
                        canCommentOnRange(next.range) &&
                        items.some((item) => item.id === next.id && item.type === "diff")
                        ? next
                        : null,
                    );
                  }
                : undefined
            }
            options={{
              ...pierreReviewTheme,
              theme: appearance.codeThemePair,
              themeType: appearance.scheme,
              diffStyle,
              expandUnchanged,
              overflow: lineWrap ? "wrap" : "scroll",
              diffIndicators: "none",
              hunkSeparators: "line-info-basic",
              itemMetrics: { lineHeight: 16, diffHeaderHeight: 32 },
              layout: { paddingTop: 0, paddingBottom: 4, gap: 2 },
              lineDiffType: preferences.inline,
              onPostRender: find.refresh,
              lineHoverHighlight: "line",
              stickyHeaders: true,
              enableLineSelection: review.enabled,
              searchOptions: DIFF_FIND_CODE_VIEW_SEARCH,
            }}
            className="h-full min-w-0 flex-1 overflow-auto"
            style={pierreViewerStyle}
            renderCustomHeader={(item) => {
              const file = diffByPath.get(item.id);
              const collapsed = collapsedPaths.has(item.id);
              const kind = kinds.get(item.id) ?? "regular";
              const quiet = isQuietKind(kind);
              const { directory, name } = filePathParts(item.id);
              return (
                <div
                  role="button"
                  tabIndex={0}
                  aria-expanded={!collapsed}
                  className="group/header flex h-8 w-full cursor-pointer items-center gap-2 px-2 text-left outline-none hover:bg-muted/55 focus-visible:bg-muted/55"
                  data-palot-diff-header={item.id}
                  title={item.id}
                  onClick={() => togglePath(item.id)}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" && event.key !== " ") return;
                    event.preventDefault();
                    togglePath(item.id);
                  }}
                >
                  <StageCheckbox controller={sourceControl} path={item.id} />
                  <FileCode2
                    className="size-3.5 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
                    <span className="min-w-0 truncate text-tree">
                      {directory ? (
                        <span className="text-muted-foreground">{directory}/</span>
                      ) : null}
                      <span
                        className={cn(
                          "font-medium",
                          quiet ? "text-muted-foreground" : "text-foreground",
                        )}
                      >
                        {name}
                      </span>
                    </span>
                    <ChangedFileKindBadge kind={kind} className="self-center" />
                    {file ? (
                      <span className="flex shrink-0 items-center gap-1 font-mono text-diff tabular-nums">
                        <span className="text-success">+{file.additions}</span>
                        <span className="text-destructive">-{file.deletions}</span>
                      </span>
                    ) : null}
                  </span>
                  {item.type === "file" ? (
                    <span className="shrink-0 text-micro text-muted-foreground">
                      {file?.whitespaceOnly ? "Whitespace changes hidden" : "Patch unavailable"}
                    </span>
                  ) : null}
                  {viewed.get(item.id) === "changed" ? <ChangedSinceViewed /> : null}
                  <span className="ml-1 flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover/header:opacity-100 group-focus-within/header:opacity-100">
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-xs"
                            className="size-6"
                            aria-label={`Copy ${item.id} path`}
                            onClick={(event) => {
                              event.stopPropagation();
                              void writeClipboardText(item.id);
                            }}
                          />
                        }
                      >
                        <Copy />
                      </TooltipTrigger>
                      <TooltipContent>Copy file path</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-xs"
                            className="size-6"
                            aria-label={`Open ${item.id} in a tab`}
                            onClick={(event) => {
                              event.stopPropagation();
                              commands.openTab(
                                {
                                  kind: "file-diff",
                                  location: tab.resource.location,
                                  path: item.id,
                                  mode: tab.resource.mode,
                                  sourceSessionID: tab.resource.sourceSessionID,
                                },
                                { pane },
                              );
                            }}
                          />
                        }
                      >
                        <ExternalLink />
                      </TooltipTrigger>
                      <TooltipContent>Open in tab</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-xs"
                            className="size-6"
                            aria-label={`${collapsed ? "Expand" : "Collapse"} ${item.id}`}
                            onClick={(event) => {
                              event.stopPropagation();
                              togglePath(item.id);
                            }}
                          />
                        }
                      >
                        {collapsed ? <ChevronRight /> : <ChevronDown />}
                      </TooltipTrigger>
                      <TooltipContent>{collapsed ? "Expand file" : "Collapse file"}</TooltipContent>
                    </Tooltip>
                  </span>
                  {/* The header folds the file; the checkbox keeps its press to itself. A span,
                      not a label: a label would toggle the checkbox a second time. */}
                  <span
                    title="Viewed"
                    className="flex shrink-0 items-center gap-1.5 text-micro text-muted-foreground select-none"
                    onClick={(event) => event.stopPropagation()}
                    onKeyDown={(event) => event.stopPropagation()}
                  >
                    <Checkbox
                      aria-label={`Mark ${item.id} as viewed`}
                      checked={viewed.get(item.id) === "viewed"}
                      onCheckedChange={(checked) => markViewed(item.id, checked)}
                    />
                    <span aria-hidden="true" className="hidden @min-[32rem]/workbench:inline">
                      Viewed
                    </span>
                  </span>
                </div>
              );
            }}
          />
          <DiffChangeRail
            container={codeViewContainer}
            source={codeViewRailSource(codeViewRef, railItems, CODE_VIEW_RAIL_METRICS)}
            layout={diffStyle}
            expandUnchanged={expandUnchanged}
            matches={find.open ? find.matches : undefined}
            layoutKey={railItems}
          />
        </div>
      </div>
      {review.enabled && selection && diffByPath.has(selection.id) ? (
        <ReviewCommentEditor
          key={`${selection.id}:${selection.range.start}:${selection.range.end}:${selection.range.side}`}
          path={selection.id}
          range={selection.range}
          onSave={(text) => {
            review.add(selection.id, selection.range, text);
            setSelection(null);
          }}
          onSend={
            review.send
              ? (text) =>
                  review.send?.(selection.id, selection.range, text).then((sent) => {
                    if (sent) setSelection(null);
                    return sent;
                  }) ?? Promise.resolve(false)
              : undefined
          }
          onCancel={() => setSelection(null)}
        />
      ) : null}
      <ChangesSourceControlPanel controller={sourceControl} />
    </div>
  );
}

function ReviewModeBar({
  tab,
  pane,
  commands,
  active,
}: {
  tab: Extract<WorkbenchTab, { kind: "changes" }>;
  pane: WorkbenchPaneID;
  commands: ReturnType<typeof useWorkbenchCommands>;
  active: boolean;
}) {
  return (
    <div className="flex shrink-0 flex-col border-b border-border bg-background px-2">
      <div className="flex h-9 items-center">
        <ReviewModeToggle tab={tab} pane={pane} commands={commands} />
      </div>
      {tab.resource.mode === "branch" ? (
        <ReviewBasePicker location={tab.resource.location} active={active} />
      ) : null}
    </div>
  );
}

function ReviewModeToggle({
  tab,
  pane,
  commands,
}: {
  tab: Extract<WorkbenchTab, { kind: "changes" }>;
  pane: WorkbenchPaneID;
  commands: ReturnType<typeof useWorkbenchCommands>;
}) {
  const vcs = useVcsInfo(tab.resource.location).data;
  const branchContext = vcs?.currentBranch ?? null;
  return (
    <div className="flex min-w-0 items-center gap-2">
      {/* Borderless segmented control: a quiet track with a raised segment that slides. */}
      <ToggleGroup
        variant="segmented"
        size="sm"
        aria-label="Review scope"
        value={[tab.resource.mode]}
        onValueChange={(value) => {
          const mode = value[0];
          // Pressing the active segment again would empty the group; the mode stays put.
          if (mode !== "working" && mode !== "branch") return;
          commands.openTab(
            {
              kind: "changes",
              location: tab.resource.location,
              mode,
              sourceSessionID: tab.resource.sourceSessionID,
            },
            { pane },
          );
        }}
      >
        <ToggleGroupItem value="working">Working</ToggleGroupItem>
        <ToggleGroupItem value="branch">Branch</ToggleGroupItem>
      </ToggleGroup>
      {branchContext ? (
        <span
          className="hidden min-w-0 items-center gap-1 text-micro text-muted-foreground @min-[46rem]/workbench:flex"
          title={branchContext}
        >
          <GitBranch className="size-3 shrink-0" aria-hidden="true" />
          <span className="truncate">{branchContext}</span>
        </span>
      ) : null}
    </div>
  );
}

function filePathParts(path: string): { directory: string; name: string } {
  const separator = path.lastIndexOf("/");
  return separator < 0
    ? { directory: "", name: path }
    : { directory: path.slice(0, separator), name: path.slice(separator + 1) };
}

function InitializeGitEmpty({ location }: { location: LocationRef }) {
  const initialize = useInitializeGit(location);
  return (
    <Empty className="min-h-0 flex-1 rounded-none p-5">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <FolderGit2 aria-hidden="true" />
        </EmptyMedia>
        <EmptyTitle>No Git repository</EmptyTitle>
        <EmptyDescription>
          Initialize Git to track, review, and undo changes in this project.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button
          type="button"
          size="sm"
          disabled={initialize.isPending}
          aria-busy={initialize.isPending || undefined}
          onClick={() => initialize.mutate()}
        >
          {initialize.isPending ? <Spinner data-icon="inline-start" aria-hidden="true" /> : null}
          {initialize.isPending ? "Initializing Git…" : "Initialize Git"}
        </Button>
        {initialize.isError ? (
          <p role="alert" className="text-meta text-destructive">
            Could not initialize Git: {errorMessage(initialize.error)}
          </p>
        ) : null}
      </EmptyContent>
    </Empty>
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "Unknown error";
}

function reviewItem(file: PresentedFileDiff, collapsed: boolean): CodeViewItem<undefined> {
  if (file.whitespaceOnly) {
    // Nothing left to show once whitespace changes are folded away; keep the header.
    const version =
      (contentVersion(`whitespace:${file.patch}`) ^ (collapsed ? 0x80000000 : 0)) >>> 0;
    return {
      id: file.file,
      type: "file",
      file: { name: file.file, contents: "", cacheKey: `${file.file}:${version}` },
      version,
      collapsed,
    };
  }
  const fileDiff = resolveFileDiff({ file: file.file, patch: file.patch });
  const version = (contentVersion(file.patch) ^ (collapsed ? 0x80000000 : 0)) >>> 0;
  if (fileDiff) return { id: file.file, type: "diff", fileDiff, version, collapsed };
  return {
    id: file.file,
    type: "file",
    file: { name: file.file, contents: "", cacheKey: `${file.file}:${version}` },
    version,
    collapsed,
  };
}

function contentVersion(value: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}
