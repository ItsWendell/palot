import { DEFAULT_CODE_VIEW_FILE_METRICS, type CodeViewItem } from "@pierre/diffs";
import { CodeView, type CodeViewHandle } from "@pierre/diffs/react";
import { ChevronDown, ChevronRight, FileDiff, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAtomValue } from "jotai";
import { resolvedAppearanceAtom } from "../../atoms/appearance";
import { useElementWidth } from "../../hooks/use-element-width";
import { useTurnDiffs } from "../../hooks/use-turn-diffs";
import { hasTwoSidedChanges, resolveDiffLayout } from "../../lib/diff-layout";
import { presentFileDiff, type PresentedFileDiff } from "../../lib/diff-whitespace";
import { contentCacheKey, resolveFileDiff } from "../../lib/file-diffs";
import type { WorkbenchTab } from "../../lib/workbench-tabs";
import { cn } from "../../lib/cn";
import { classifyChangedFile, isQuietKind, summarizeChanges } from "../../lib/changed-file-kind";
import { ChangedFileKindBadge, ChangeSummaryCounts } from "../changed-file-kind";
import { pierreBuiltInHeaderCSS, pierreReviewTheme, pierreViewerStyle } from "../file-viewer-theme";
import { Button } from "../ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "../ui/empty";
import { Spinner } from "../ui/spinner";
import { DIFF_FIND_CODE_VIEW_SEARCH, DiffFindBar, useDiffFind } from "./diff-find";
import { DiffChangeRail, codeViewRailSource } from "./diff-change-rail";
import { DiffViewOptionsMenu, useDiffViewPreferences } from "./diff-view-options";
import { ChangedFileNavigationControls, useChangedFileNavigation } from "./changed-file-navigation";

/** The CodeView below uses the default file metrics and this layout; the rail follows them. */
const TURN_RAIL_METRICS = {
  headerHeight: DEFAULT_CODE_VIEW_FILE_METRICS.diffHeaderHeight,
  gap: 2,
  paddingBottom: 4,
};

export function TurnDiffTab({
  tab,
  active = true,
}: {
  tab: Extract<WorkbenchTab, { kind: "turn-diff" }>;
  active?: boolean;
}) {
  const appearance = useAtomValue(resolvedAppearanceAtom);
  const query = useTurnDiffs(
    tab.resource.profileID,
    tab.resource.sessionID,
    tab.resource.userMessageID,
    active,
  );
  const diffs = query.data;
  const [preferences] = useDiffViewPreferences();
  const presented = useMemo(
    () => (diffs ?? []).map((file) => presentFileDiff(file, preferences.hideWhitespace)),
    [diffs, preferences.hideWhitespace],
  );
  const kinds = useMemo(
    () => new Map(presented.map((file) => [file.file, classifyChangedFile(file.file)])),
    [presented],
  );
  // What the reader folded or opened; files without an entry follow their kind.
  const [collapseOverrides, setCollapseOverrides] = useState<ReadonlyMap<string, boolean>>(
    () => new Map(),
  );
  const isCollapsed = useCallback(
    (path: string) =>
      collapseOverrides.get(path) ??
      (preferences.collapseQuietFiles && isQuietKind(kinds.get(path) ?? "regular")),
    [collapseOverrides, kinds, preferences.collapseQuietFiles],
  );
  const setCollapsed = useCallback((path: string, collapsed: boolean) => {
    setCollapseOverrides((current) => {
      if (current.get(path) === collapsed) return current;
      const next = new Map(current);
      next.set(path, collapsed);
      return next;
    });
  }, []);
  const items = useMemo<CodeViewItem<undefined>[]>(
    () => presented.map((file) => toReviewItem(file, isCollapsed(file.file))),
    [isCollapsed, presented],
  );
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
  const codeViewRef = useRef<CodeViewHandle<undefined, undefined>>(null);
  const ids = useMemo(() => items.map((item) => item.id), [items]);
  const navigation = useChangedFileNavigation({ ids, codeView: codeViewRef });
  const reveal = tab.resource.file;
  const revealedRequest = useRef<number | null>(null);
  const goToFile = navigation.goTo;
  const showingDiffs =
    query.available && !query.isPending && !query.isError && Boolean(diffs?.length);
  useEffect(() => {
    // Wait until the review lists the file; a refetch must not pull the reader back to it.
    if (!reveal || revealedRequest.current === reveal.request) return;
    if (!showingDiffs || !codeViewRef.current || !ids.includes(reveal.path)) return;
    revealedRequest.current = reveal.request;
    // Asking for one file opens it, even a lockfile that starts folded.
    setCollapsed(reveal.path, false);
    goToFile(reveal.path);
  }, [goToFile, ids, reveal, setCollapsed, showingDiffs]);
  const [scrollContainer, setScrollContainer] = useState<HTMLDivElement | null>(null);
  const diffWidth = useElementWidth(scrollContainer);
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
    () =>
      items.map((item) => ({
        id: item.id,
        fileDiff: item.type === "diff" ? item.fileDiff : null,
        collapsed: item.collapsed === true,
      })),
    [items],
  );
  const find = useDiffFind({
    sources: findSources,
    codeView: codeViewRef,
    container: scrollContainer,
    // Find searches folded files too and opens the one holding the match.
    onRevealItem: (path) => setCollapsed(path, false),
  });
  useEffect(() => {
    if (!scrollContainer) return;
    scrollContainer.tabIndex = 0;
    scrollContainer.setAttribute("role", "region");
    scrollContainer.setAttribute("aria-label", "Turn diff review");
  }, [scrollContainer]);

  let content;
  if (!query.available) {
    content = (
      <TurnDiffEmpty
        title="Connection unavailable"
        description="Reconnect to this task's connection to view its changes."
      />
    );
  } else if (query.isPending) {
    content = (
      <div
        role="status"
        className="flex min-h-0 flex-1 items-center justify-center gap-2 text-meta text-muted-foreground"
      >
        <Spinner /> Loading turn changes
      </div>
    );
  } else if (query.isError) {
    content = (
      <Empty className="min-h-0 flex-1 rounded-none p-5">
        <EmptyHeader>
          <EmptyTitle>Could not load turn changes</EmptyTitle>
          <EmptyDescription>{query.error.message}</EmptyDescription>
        </EmptyHeader>
        <Button type="button" variant="outline" size="sm" onClick={() => void query.refetch()}>
          <RefreshCw data-icon="inline-start" /> Retry
        </Button>
      </Empty>
    );
  } else if (!diffs?.length) {
    content = (
      <TurnDiffEmpty
        title="No changes in this turn"
        description="OpenCode reported no file changes for this response."
      />
    );
  } else {
    content = (
      <div className="relative flex min-h-0 flex-1">
        <DiffFindBar controller={find} />
        <CodeView
          ref={codeViewRef}
          items={items}
          containerRef={setScrollContainer}
          onScroll={navigation.onScroll}
          options={{
            ...pierreReviewTheme,
            unsafeCSS: `${pierreReviewTheme.unsafeCSS}${pierreBuiltInHeaderCSS}`,
            // Match the Changes tab: no top margin before the first sticky file header.
            layout: { paddingTop: 0, paddingBottom: 4, gap: 2 },
            theme: appearance.codeThemePair,
            themeType: appearance.scheme,
            diffStyle,
            diffIndicators: "none",
            hunkSeparators: "line-info-basic",
            lineDiffType: preferences.inline,
            stickyHeaders: true,
            onPostRender: find.refresh,
            searchOptions: DIFF_FIND_CODE_VIEW_SEARCH,
          }}
          className="h-full min-w-0 flex-1 overflow-auto"
          style={pierreViewerStyle}
          renderHeaderPrefix={(item) => {
            if (item.type !== "diff") return null;
            const collapsed = item.collapsed === true;
            const label = `${collapsed ? "Expand" : "Collapse"} ${item.id}`;
            return (
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className="-ml-1 size-6"
                aria-label={label}
                aria-expanded={!collapsed}
                title={collapsed ? "Expand file" : "Collapse file"}
                onClick={() => setCollapsed(item.id, !collapsed)}
              >
                {collapsed ? <ChevronRight /> : <ChevronDown />}
              </Button>
            );
          }}
          renderHeaderFilenameSuffix={(item) => (
            <ChangedFileKindBadge kind={kinds.get(item.id) ?? "regular"} className="ml-1.5" />
          )}
        />
        <DiffChangeRail
          container={scrollContainer}
          source={codeViewRailSource(codeViewRef, railItems, TURN_RAIL_METRICS)}
          layout={diffStyle}
          expandUnchanged={false}
          matches={find.open ? find.matches : undefined}
          layoutKey={railItems}
        />
      </div>
    );
  }

  return (
    <div
      className="flex min-h-0 min-w-0 flex-1 flex-col bg-card"
      onKeyDown={
        diffs?.length
          ? (event) => {
              find.onKeyDown(event);
              navigation.onKeyDown(event);
            }
          : undefined
      }
    >
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border bg-background px-2">
        <FileDiff className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-compact font-medium">Turn changes</span>
        {diffs?.length ? <ChangeSummaryCounts summary={summary} /> : null}
        {diffs?.length ? <ChangedFileNavigationControls navigation={navigation} /> : null}
        {diffs?.length ? (
          <DiffViewOptionsMenu layout={diffStyle} onFind={find.openFind} collapseQuietAvailable />
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Refresh turn changes"
          disabled={!query.available || query.isFetching}
          onClick={() => void query.refetch()}
        >
          <RefreshCw className={cn(query.isFetching && "animate-spin")} aria-hidden="true" />
        </Button>
      </div>
      {content}
    </div>
  );
}

function TurnDiffEmpty({ title, description }: { title: string; description: string }) {
  return (
    <Empty className="min-h-0 flex-1 rounded-none p-5">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <FileDiff aria-hidden="true" />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

function toReviewItem(file: PresentedFileDiff, collapsed: boolean): CodeViewItem<undefined> {
  const cacheKey = contentCacheKey(file.file, file.patch);
  const contentVersion = Number(cacheKey.split(":").at(-1));
  const diff = file.whitespaceOnly ? null : resolveFileDiff({ file: file.file, patch: file.patch });
  // The top bit carries the fold, so folding or opening a file redraws only that item.
  const version = (contentVersion ^ (collapsed ? 0x80000000 : 0)) >>> 0;
  if (diff) return { id: file.file, type: "diff", fileDiff: diff, version, collapsed };
  return {
    id: file.file,
    type: "file",
    file: {
      name: file.file,
      contents: file.whitespaceOnly ? "Whitespace changes hidden" : "Patch unavailable",
      cacheKey: file.whitespaceOnly ? `whitespace:${cacheKey}` : cacheKey,
    },
    version: file.whitespaceOnly ? (contentVersion ^ 1) >>> 0 : contentVersion,
  };
}
