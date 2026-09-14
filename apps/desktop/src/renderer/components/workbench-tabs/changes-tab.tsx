import type { FileDiffInfo } from "@opencode/client";
import type { CodeViewItem } from "@pierre/diffs";
import type { GitStatusEntry } from "@pierre/trees";
import { CodeView, type CodeViewHandle } from "@pierre/diffs/react";
import { FileTree, useFileTree } from "@pierre/trees/react";
import {
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Columns2,
  Copy,
  ExternalLink,
  FileCode2,
  Files,
  FolderTree,
  GitBranch,
  RefreshCw,
  Rows3,
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
import { useWorkbenchCommands } from "../../atoms/workbench";
import type { WorkbenchScope } from "../../lib/workbench-tabs";
import { resolveFileDiff } from "../../lib/file-diffs";
import { cn } from "../../lib/cn";
import { writeClipboardText } from "../../lib/clipboard";
import { pierreReviewTheme, pierreViewerStyle } from "../file-viewer-theme";
import { DiffContextToggle } from "../diff-context-toggle";
import { Button } from "../ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "../ui/empty";
import { Spinner } from "../ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import { ReviewBasePicker, ReviewBaseStatus } from "./review-base-picker";

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
  const [diffStyle, setDiffStyle] = useState<"unified" | "split">("unified");
  const [lineWrap, setLineWrap] = useState(false);
  const [collapsedPaths, setCollapsedPaths] = useState<Set<string>>(() => new Set());
  const codeViewRef = useRef<CodeViewHandle<undefined, undefined>>(null);
  const paths = useMemo(() => diffs.map((file) => file.file), [diffs]);
  const pathSetRef = useRef<Set<string>>(new Set());

  useLayoutEffect(() => {
    pathSetRef.current = new Set(paths);
  }, [paths]);
  const gitStatus = useMemo<GitStatusEntry[]>(
    () => diffs.map((file) => ({ path: file.file, status: file.status })),
    [diffs],
  );
  const items = useMemo<CodeViewItem<undefined>[]>(
    () => diffs.map((file) => reviewItem(file, collapsedPaths.has(file.file))),
    [collapsedPaths, diffs],
  );
  const diffByPath = useMemo(() => new Map(diffs.map((file) => [file.file, file])), [diffs]);
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
    onSelectionChange(selectedPaths) {
      const path = selectedPaths.at(-1);
      if (!path || !pathSetRef.current.has(path)) return;
      codeViewRef.current?.scrollTo({
        type: "item",
        id: path,
        align: "start",
        offset: 34,
        behavior: "smooth-auto",
      });
    },
  });
  const totals = useMemo(
    () =>
      diffs.reduce(
        (sum, file) => ({
          additions: sum.additions + file.additions,
          deletions: sum.deletions + file.deletions,
        }),
        { additions: 0, deletions: 0 },
      ),
    [diffs],
  );
  const allCollapsed = diffs.length > 0 && collapsedPaths.size === diffs.length;
  const togglePath = useCallback((path: string) => {
    setCollapsedPaths((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);
  const [codeViewContainer, setCodeViewContainer] = useState<HTMLDivElement | null>(null);
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
    tree.resetPaths(paths);
    tree.setGitStatus(gitStatus);
  }, [gitStatus, paths, tree]);

  useEffect(() => {
    setCollapsedPaths((current) => {
      const next = new Set([...current].filter((path) => pathSetRef.current.has(path)));
      return next.size === current.size ? current : next;
    });
  }, [paths]);

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
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-card">
      <div className="flex h-10 shrink-0 items-center gap-1.5 border-b border-border bg-background px-2">
        <ReviewModeToggle tab={tab} pane={pane} commands={commands} />
        <Button
          type="button"
          variant={showTree ? "secondary" : "ghost"}
          size="sm"
          aria-label={showTree ? "Hide changed files" : "Show changed files"}
          aria-pressed={showTree}
          onClick={() => setShowTree((visible) => !visible)}
        >
          <FolderTree data-icon="inline-start" />
          <span className="hidden @min-[28rem]/workbench:inline">Files</span>
        </Button>
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <div className="hidden shrink-0 items-center gap-2 font-mono text-diff tabular-nums @min-[46rem]/workbench:flex">
            <span className="text-muted-foreground">
              {diffs.length} {diffs.length === 1 ? "file" : "files"}
            </span>
            <span className="text-success">+{totals.additions}</span>
            <span className="text-destructive">-{totals.deletions}</span>
          </div>
          <div className="mx-0.5 hidden h-4 w-px bg-border @min-[46rem]/workbench:block" />
          <DiffContextToggle expanded={expandUnchanged} onExpandedChange={setExpandUnchanged} />
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={diffStyle === "unified" ? "Use split diff" : "Use unified diff"}
                  onClick={() =>
                    setDiffStyle((style) => (style === "unified" ? "split" : "unified"))
                  }
                />
              }
            >
              {diffStyle === "unified" ? <Columns2 /> : <Rows3 />}
            </TooltipTrigger>
            <TooltipContent>
              {diffStyle === "unified" ? "Split diff" : "Unified diff"}
            </TooltipContent>
          </Tooltip>
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
                  onClick={() => setCollapsedPaths(allCollapsed ? new Set() : new Set(paths))}
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
                  onClick={() => void query.refetch()}
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
        >
          <div className="flex h-8 shrink-0 items-center border-b border-border px-2">
            <Files className="mr-1.5 size-3 text-muted-foreground" aria-hidden="true" />
            <span className="text-micro font-semibold tracking-wide text-muted-foreground uppercase">
              Changed files
            </span>
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
        <div
          className={cn(
            "min-h-0 min-w-0 overflow-hidden bg-card",
            !showTree && "@min-[46rem]/workbench:col-span-2",
          )}
          aria-label={tab.resource.mode === "branch" ? "Branch review" : "Working tree review"}
        >
          <CodeView
            ref={codeViewRef}
            containerRef={setCodeViewContainer}
            items={items}
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
              lineDiffType: "word",
              lineHoverHighlight: "line",
              stickyHeaders: true,
            }}
            className="size-full overflow-auto"
            style={pierreViewerStyle}
            renderCustomHeader={(item) => {
              const file = diffByPath.get(item.id);
              const collapsed = collapsedPaths.has(item.id);
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
                  <FileCode2
                    className="size-3.5 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
                    <span className="min-w-0 truncate text-tree">
                      {directory ? (
                        <span className="text-muted-foreground">{directory}/</span>
                      ) : null}
                      <span className="font-medium text-foreground">{name}</span>
                    </span>
                    {file ? (
                      <span className="flex shrink-0 items-center gap-1 font-mono text-diff tabular-nums">
                        <span className="text-success">+{file.additions}</span>
                        <span className="text-destructive">-{file.deletions}</span>
                      </span>
                    ) : null}
                  </span>
                  {item.type === "file" ? (
                    <span className="shrink-0 text-micro text-muted-foreground">
                      Patch unavailable
                    </span>
                  ) : null}
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
                </div>
              );
            }}
          />
        </div>
      </div>
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
      <div className="flex h-10 items-center">
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
      <div className="flex shrink-0 items-center rounded-md border border-border bg-muted/30 p-0.5">
        {(["working", "branch"] as const).map((mode) => (
          <Button
            key={mode}
            type="button"
            variant={tab.resource.mode === mode ? "secondary" : "ghost"}
            size="xs"
            className="h-6 px-2"
            aria-pressed={tab.resource.mode === mode}
            onClick={() =>
              commands.openTab(
                {
                  kind: "changes",
                  location: tab.resource.location,
                  mode,
                  sourceSessionID: tab.resource.sourceSessionID,
                },
                { pane },
              )
            }
          >
            {mode === "working" ? "Working" : "Branch"}
          </Button>
        ))}
      </div>
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

function reviewItem(file: FileDiffInfo, collapsed: boolean): CodeViewItem<undefined> {
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
