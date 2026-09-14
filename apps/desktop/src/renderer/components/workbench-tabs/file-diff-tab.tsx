import { FileCode2, FolderOpen, RefreshCw, SquareArrowOutUpRight } from "lucide-react";
import { useState } from "react";
import { useAtomValue } from "jotai";
import { runtimeAtom } from "../../atoms/workspace";
import { cn } from "../../lib/cn";
import { useLocationDiffs } from "../../hooks/use-location-diffs";
import type { WorkbenchTab } from "../../lib/workbench-tabs";
import { palot } from "../../services/palot";
import { FileDiffView } from "../file-diff-view";
import { DiffContextToggle } from "../diff-context-toggle";
import { Button } from "../ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "../ui/empty";
import { Spinner } from "../ui/spinner";
import { ReviewBasePicker, ReviewBaseStatus } from "./review-base-picker";

export function FileDiffTab({
  tab,
  active = true,
}: {
  tab: Extract<WorkbenchTab, { kind: "file-diff" }>;
  active?: boolean;
}) {
  const [expandUnchanged, setExpandUnchanged] = useState(false);
  const query = useLocationDiffs(
    tab.resource.location,
    active,
    tab.resource.mode,
    expandUnchanged ? null : 3,
  );
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-card">
      {tab.resource.mode === "branch" ? (
        <div className="min-w-0 shrink-0 border-b border-border bg-background px-2">
          <ReviewBasePicker location={tab.resource.location} active={active} />
        </div>
      ) : null}
      {tab.resource.mode === "branch" && !query.reviewBase.ref ? (
        <div className="flex min-h-0 flex-1 items-center justify-center p-5">
          <ReviewBaseStatus base={query.reviewBase} />
        </div>
      ) : (
        <FileDiffContent
          tab={tab}
          query={query}
          expandUnchanged={expandUnchanged}
          setExpandUnchanged={setExpandUnchanged}
        />
      )}
    </div>
  );
}

function FileDiffContent({
  tab,
  query,
  expandUnchanged,
  setExpandUnchanged,
}: {
  tab: Extract<WorkbenchTab, { kind: "file-diff" }>;
  query: ReturnType<typeof useLocationDiffs>;
  expandUnchanged: boolean;
  setExpandUnchanged(value: boolean): void;
}) {
  const runtime = useAtomValue(runtimeAtom);
  const diff = query.data?.find((file) => file.file === tab.resource.path);

  if (query.isPending) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center gap-2 text-xs text-muted-foreground">
        <Spinner /> Loading diff
      </div>
    );
  }
  if (query.isError) {
    return (
      <Empty className="rounded-none p-5">
        <EmptyHeader>
          <EmptyTitle>Could not load diff</EmptyTitle>
          <EmptyDescription>{query.error.message}</EmptyDescription>
        </EmptyHeader>
        <Button type="button" variant="outline" size="sm" onClick={() => void query.refetch()}>
          <RefreshCw data-icon="inline-start" /> Retry
        </Button>
      </Empty>
    );
  }
  if (!diff) {
    return (
      <Empty className="rounded-none p-5">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <FileCode2 aria-hidden="true" />
          </EmptyMedia>
          <EmptyTitle>Diff unavailable</EmptyTitle>
          <EmptyDescription>
            {tab.resource.path} is no longer present in the {tab.resource.mode} changes.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  const fullPath =
    diff.file.startsWith("/") || diff.file.startsWith("~")
      ? diff.file
      : `${tab.resource.location.directory.replace(/\/+$/, "")}/${diff.file}`;
  const fileHref = `file://${encodeURI(fullPath)}`;

  return diff.patch ? (
    <div className="flex min-h-0 flex-1 flex-col bg-card">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border bg-background px-2">
        <FileCode2 className="size-3 text-muted-foreground" aria-hidden="true" />
        <a
          href={fileHref}
          className="min-w-0 flex-1 truncate text-meta hover:underline"
          title={diff.file}
          onClick={(event) => event.preventDefault()}
        >
          {diff.file}
        </a>
        <span className="font-mono text-diff text-success">+{diff.additions}</span>
        <span className="font-mono text-diff text-destructive">-{diff.deletions}</span>
        <DiffContextToggle expanded={expandUnchanged} onExpandedChange={setExpandUnchanged} />
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label="Open in editor"
          title="Open in editor"
          disabled={
            runtime?.profileID !== tab.resource.profileID ||
            runtime?.capabilities?.localPathActions !== true
          }
          onClick={() => {
            void palot.externalOpen(
              {
                resource: {
                  kind: "file",
                  path: fullPath,
                },
              },
              runtime?.connectionID,
            );
          }}
        >
          <SquareArrowOutUpRight className="size-3.5" aria-hidden="true" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label="Reveal in Finder"
          title="Reveal in Finder"
          disabled={
            runtime?.profileID !== tab.resource.profileID ||
            runtime?.capabilities?.localPathActions !== true
          }
          onClick={() => {
            void palot.revealFileInFinder(fullPath, runtime?.connectionID);
          }}
        >
          <FolderOpen className="size-3.5" aria-hidden="true" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label="Refresh diff"
          onClick={() => void query.refetch()}
        >
          <RefreshCw className={cn(query.isFetching && "animate-spin")} aria-hidden="true" />
        </Button>
      </div>
      <FileDiffView
        file={diff.file}
        patch={diff.patch}
        expandUnchanged={expandUnchanged}
        className="min-h-0 flex-1"
      />
    </div>
  ) : (
    <Empty className="rounded-none p-5">
      <EmptyHeader>
        <EmptyTitle>Diff details unavailable</EmptyTitle>
        <EmptyDescription>OpenCode did not return a patch for this file.</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
