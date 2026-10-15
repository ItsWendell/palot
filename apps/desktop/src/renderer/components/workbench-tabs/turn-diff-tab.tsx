import type { CodeViewItem } from "@pierre/diffs";
import { CodeView, type CodeViewHandle } from "@pierre/diffs/react";
import { FileDiff, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAtomValue } from "jotai";
import { resolvedAppearanceAtom } from "../../atoms/appearance";
import { useElementWidth } from "../../hooks/use-element-width";
import { useTurnDiffs } from "../../hooks/use-turn-diffs";
import { hasTwoSidedChanges, resolveDiffLayout } from "../../lib/diff-layout";
import { presentFileDiff, type PresentedFileDiff } from "../../lib/diff-whitespace";
import { contentCacheKey, resolveFileDiff } from "../../lib/file-diffs";
import type { WorkbenchTab } from "../../lib/workbench-tabs";
import { cn } from "../../lib/cn";
import { pierreBuiltInHeaderCSS, pierreReviewTheme, pierreViewerStyle } from "../file-viewer-theme";
import { Button } from "../ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "../ui/empty";
import { Spinner } from "../ui/spinner";
import { DiffFindBar, useDiffFind } from "./diff-find";
import { DiffViewOptionsMenu, useDiffViewPreferences } from "./diff-view-options";

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
  const items = useMemo<CodeViewItem<undefined>[]>(() => presented.map(toReviewItem), [presented]);
  const totals = useMemo(
    () =>
      presented.reduce(
        (sum, file) => ({
          additions: sum.additions + file.additions,
          deletions: sum.deletions + file.deletions,
        }),
        { additions: 0, deletions: 0 },
      ),
    [presented],
  );
  const codeViewRef = useRef<CodeViewHandle<undefined, undefined>>(null);
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
  const find = useDiffFind({
    sources: findSources,
    codeView: codeViewRef,
    container: scrollContainer,
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
      <div className="relative flex min-h-0 flex-1 flex-col">
        <DiffFindBar controller={find} />
        <CodeView
          ref={codeViewRef}
          items={items}
          containerRef={setScrollContainer}
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
          }}
          className="min-h-0 flex-1 overflow-auto"
          style={pierreViewerStyle}
        />
      </div>
    );
  }

  return (
    <div
      className="flex min-h-0 min-w-0 flex-1 flex-col bg-card"
      onKeyDown={diffs?.length ? find.onKeyDown : undefined}
    >
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border bg-background px-2">
        <FileDiff className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-compact font-medium">Turn changes</span>
        {diffs?.length ? (
          <span className="flex shrink-0 items-center gap-2 font-mono text-diff tabular-nums">
            <span className="text-muted-foreground">
              {diffs.length} {diffs.length === 1 ? "file" : "files"}
            </span>
            <span className="text-success">+{totals.additions}</span>
            <span className="text-destructive">-{totals.deletions}</span>
          </span>
        ) : null}
        {diffs?.length ? <DiffViewOptionsMenu layout={diffStyle} onFind={find.openFind} /> : null}
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

function toReviewItem(file: PresentedFileDiff): CodeViewItem<undefined> {
  const cacheKey = contentCacheKey(file.file, file.patch);
  const version = Number(cacheKey.split(":").at(-1));
  const diff = file.whitespaceOnly ? null : resolveFileDiff({ file: file.file, patch: file.patch });
  if (diff) return { id: file.file, type: "diff", fileDiff: diff, version };
  return {
    id: file.file,
    type: "file",
    file: {
      name: file.file,
      contents: file.whitespaceOnly ? "Whitespace changes hidden" : "Patch unavailable",
      cacheKey: file.whitespaceOnly ? `whitespace:${cacheKey}` : cacheKey,
    },
    version: file.whitespaceOnly ? (version ^ 1) >>> 0 : version,
  };
}
