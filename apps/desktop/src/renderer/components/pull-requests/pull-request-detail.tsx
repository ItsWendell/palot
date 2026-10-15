import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  CircleAlert,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  FileDiff,
  GitBranch,
  GitPullRequest,
  GitPullRequestClosed,
  GitPullRequestDraft,
  Link2,
  LoaderCircle,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { lazy, Suspense, useState, type ReactNode } from "react";
import type { PalotSession } from "../../../shared";
import type {
  PullRequestDetail,
  PullRequestLink,
  PullRequestRef,
} from "../../../shared/source-control-contract";
import { pullRequestKey } from "../../../shared/source-control-contract";
import { useClipboardCopy } from "../../hooks/use-clipboard-copy";
import { usePalotNavigation } from "../../hooks/use-navigation";
import { useSelectedSession } from "../../hooks/use-session-catalog";
import {
  sourceControlKeys,
  useLinkPullRequest,
  usePullRequestDetail,
  usePullRequestFiles,
  useSetPullRequestDraft,
  useSetPullRequestState,
  useWatchPullRequest,
} from "../../hooks/use-source-control";
import { palot } from "../../services/palot";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import { useStartPullRequestTask } from "./pull-request-actions";
import { PullRequestPersonLabel, PullRequestStatePill } from "./pull-request-person";
import {
  formatPullRequestTime,
  sourceControlErrorMessage,
  WATCH_EXPLANATION,
} from "./pull-request-presentation";
import { PullRequestSummaryTab } from "./pull-request-summary-tab";
import { PullRequestTimelineTab } from "./pull-request-timeline-tab";
import { useArmedConfirm } from "./use-armed-confirm";
import { useReviewGuide, type ReviewGuideController } from "./guide/use-review-guide";

// Loaded on first use so the diff renderer stays out of the list's first paint.
const PullRequestCodeTab = lazy(() =>
  import("./code/pull-request-code-tab").then((module) => ({
    default: module.PullRequestCodeTab,
  })),
);

// The guide renders excerpts with the same diff renderer, so it loads on first use too.
const PullRequestGuideTab = lazy(() =>
  import("./guide/pull-request-guide-tab").then((module) => ({
    default: module.PullRequestGuideTab,
  })),
);

type DetailTab = "summary" | "timeline" | "code" | "guide";

export function PullRequestDetailPane({
  pullRequest,
  links,
  sessions,
  linkingSupported,
  knownLogins,
  onBack,
}: {
  pullRequest: PullRequestRef;
  links: readonly PullRequestLink[];
  sessions: readonly PalotSession[];
  linkingSupported: boolean;
  /** Logins seen elsewhere on the screen, offered when requesting reviewers. */
  knownLogins: readonly string[];
  onBack(): void;
}) {
  const detail = usePullRequestDetail(pullRequest);
  const files = usePullRequestFiles(pullRequest);
  const queryClient = useQueryClient();
  const refresh = () =>
    void queryClient.invalidateQueries({ queryKey: sourceControlKeys.pullRequest(pullRequest) });
  const viewed = files.data?.files.filter((file) => file.viewed === "viewed").length ?? 0;
  const total = files.data?.files.length;

  if (!detail.data) {
    return (
      <section aria-label="Pull request" className="flex min-h-0 flex-1 flex-col">
        <DetailTopBar pullRequest={pullRequest} onBack={onBack} />
        {detail.error ? (
          <div className="m-4 flex items-start gap-2 text-sm text-muted-foreground" role="alert">
            <CircleAlert className="mt-0.5 size-3.5 shrink-0 text-destructive" aria-hidden="true" />
            <div className="min-w-0">
              <p>{sourceControlErrorMessage(detail.error)}</p>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="mt-1 -ml-2"
                onClick={refresh}
              >
                Try again
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
            <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
            Loading pull request
          </div>
        )}
      </section>
    );
  }
  return (
    <LoadedDetail
      pullRequest={pullRequest}
      data={detail.data}
      refreshing={detail.isFetching}
      onRefresh={refresh}
      links={links}
      sessions={sessions}
      linkingSupported={linkingSupported}
      knownLogins={knownLogins}
      viewed={viewed}
      total={total}
      onBack={onBack}
    />
  );
}

function LoadedDetail({
  pullRequest,
  data,
  refreshing,
  onRefresh,
  links,
  sessions,
  linkingSupported,
  knownLogins,
  viewed,
  total,
  onBack,
}: {
  pullRequest: PullRequestRef;
  data: PullRequestDetail;
  refreshing: boolean;
  onRefresh(): void;
  links: readonly PullRequestLink[];
  sessions: readonly PalotSession[];
  linkingSupported: boolean;
  knownLogins: readonly string[];
  viewed: number;
  total: number | undefined;
  onBack(): void;
}) {
  const key = pullRequestKey(data);
  // The open tab belongs to one pull request; another starts on Summary.
  const [tabState, setTabState] = useState<{ key: string; tab: DetailTab }>({
    key,
    tab: "summary",
  });
  const tab = tabState.key === key ? tabState.tab : "summary";
  const setTab = (next: DetailTab) => setTabState({ key, tab: next });
  const guide = useReviewGuide(data, { catalogEnabled: tab === "guide" });
  const writeGuide = () => {
    setTab("guide");
    guide.write();
  };
  return (
    <section
      aria-label={`#${data.number} ${data.title}`}
      className="flex min-h-0 flex-1 flex-col"
      data-pull-request-detail={key}
    >
      <DetailTopBar
        pullRequest={pullRequest}
        onBack={onBack}
        actions={
          <DetailMenu
            detail={data}
            refreshing={refreshing}
            onRefresh={onRefresh}
            guide={guide}
            onWriteGuide={writeGuide}
          />
        }
      />
      <Tabs
        key={key}
        value={tab}
        onValueChange={(next) => setTab(next as DetailTab)}
        className="flex min-h-0 flex-1 flex-col gap-0"
      >
        <DetailHeader
          detail={data}
          links={links}
          sessions={sessions}
          linkingSupported={linkingSupported}
        />
        <div className="shrink-0 border-b border-border/60 px-4 py-1.5">
          <TabsList variant="subtle" aria-label="Pull request views">
            <TabsTrigger value="summary">Summary</TabsTrigger>
            <TabsTrigger value="timeline">Timeline</TabsTrigger>
            <TabsTrigger value="code">
              Code
              {total !== undefined ? (
                <span className="text-micro font-normal text-muted-foreground tabular-nums">
                  {viewed} of {total} viewed
                </span>
              ) : null}
            </TabsTrigger>
            <TabsTrigger value="guide">
              Guide
              <Badge variant="info" size="sm">
                Beta
              </Badge>
              {guide.running ? (
                <LoaderCircle className="size-3 animate-spin" aria-label="Writing guide" />
              ) : null}
            </TabsTrigger>
          </TabsList>
        </div>
        <TabsContent
          value="summary"
          className="palot-native-scrollbar min-h-0 flex-1 overflow-y-auto"
        >
          <PullRequestSummaryTab detail={data} knownLogins={knownLogins} />
        </TabsContent>
        <TabsContent
          value="timeline"
          className="palot-native-scrollbar min-h-0 flex-1 overflow-y-auto"
        >
          <PullRequestTimelineTab detail={data} />
        </TabsContent>
        <TabsContent value="code" className="flex min-h-0 flex-1 flex-col">
          <Suspense fallback={<TabLoading />}>
            <PullRequestCodeTab pullRequest={data} />
          </Suspense>
        </TabsContent>
        <TabsContent value="guide" className="flex min-h-0 flex-1 flex-col">
          <Suspense fallback={<TabLoading />}>
            <PullRequestGuideTab pullRequest={data} controller={guide} />
          </Suspense>
        </TabsContent>
      </Tabs>
    </section>
  );
}

function TabLoading() {
  return (
    <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
      <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
      Loading
    </div>
  );
}

function DetailTopBar({
  pullRequest,
  onBack,
  actions,
}: {
  pullRequest: PullRequestRef;
  onBack(): void;
  actions?: ReactNode;
}) {
  return (
    // Stacked under a narrow container, the bar starts at the window's leading controls.
    <div className="window-drag flex h-(--shell-header-height) shrink-0 items-center gap-1.5 border-b border-border/60 px-3 pr-(--window-controls-width) @max-[44rem]/pull-requests:pl-(--thread-header-leading-inset,18px)">
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="Back to pull requests"
        className="window-no-drag hidden @max-[44rem]/pull-requests:inline-flex"
        onClick={onBack}
      >
        <ArrowLeft aria-hidden="true" />
      </Button>
      <span className="min-w-0 truncate text-meta text-muted-foreground">
        {pullRequest.repository}
        <span className="tabular-nums"> #{pullRequest.number}</span>
      </span>
      <div className="window-no-drag ml-auto flex items-center gap-0.5">{actions}</div>
    </div>
  );
}

function DetailHeader({
  detail,
  links,
  sessions,
  linkingSupported,
}: {
  detail: PullRequestDetail;
  links: readonly PullRequestLink[];
  sessions: readonly PalotSession[];
  linkingSupported: boolean;
}) {
  const { openSession } = usePalotNavigation();
  const currentTask = useSelectedSession();
  const link = useLinkPullRequest();
  const watch = useWatchPullRequest();
  const startTask = useStartPullRequestTask();
  const { copy, copiedKey } = useClipboardCopy();
  const [error, setError] = useState<string | null>(null);
  const run = async (action: () => Promise<unknown>) => {
    setError(null);
    try {
      await action();
    } catch (cause) {
      setError(sourceControlErrorMessage(cause));
    }
  };
  const linkedCurrent = links.find((candidate) => candidate.sessionID === currentTask?.id);
  const watchLink = linkedCurrent ?? links[0];
  const watchable = detail.state === "open" || detail.state === "draft";
  const canLinkCurrent =
    linkingSupported && currentTask !== null && !currentTask.parentID && !linkedCurrent;
  const taskTitle = (sessionID: string) =>
    sessions.find((session) => session.id === sessionID)?.title?.trim() || "Untitled task";

  return (
    <header className="shrink-0 px-4 pt-4 pb-3">
      <h2
        className="line-clamp-2 text-lg/snug font-medium tracking-[-0.01em] text-balance"
        title={detail.title}
      >
        {detail.title}{" "}
        <span className="font-normal text-muted-foreground tabular-nums">#{detail.number}</span>
      </h2>
      <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-meta text-muted-foreground">
        <PullRequestStatePill state={detail.state} />
        <PullRequestPersonLabel
          person={detail.authorPerson}
          login={detail.authorPerson?.login ?? detail.author ?? "ghost"}
          className="text-foreground/80"
        />
        <span>opened {formatPullRequestTime(detail.createdAt)}</span>
        <span>· updated {formatPullRequestTime(detail.updatedAt)}</span>
      </div>
      <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-meta text-muted-foreground">
        <span className="flex min-w-0 items-center gap-1 font-mono">
          <GitBranch className="size-3 shrink-0" aria-hidden="true" />
          <BranchName
            name={detail.headBranch}
            copied={copiedKey === "head"}
            onCopy={() => void copy(detail.headBranch, "head")}
          />
          <span aria-label="into">→</span>
          <BranchName
            name={detail.baseBranch}
            copied={copiedKey === "base"}
            onCopy={() => void copy(detail.baseBranch, "base")}
          />
        </span>
        <span className="flex items-center gap-1.5 tabular-nums">
          <FileDiff className="size-3" aria-hidden="true" />
          {detail.changedFiles} {detail.changedFiles === 1 ? "file" : "files"}
          <span className="text-success">+{detail.additions}</span>
          <span className="text-destructive">−{detail.deletions}</span>
        </span>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-1">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void palot.openExternalUrl(detail.url)}
        >
          <ExternalLink data-icon="inline-start" aria-hidden="true" />
          Open on GitHub
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => void startTask("detail", detail)}
        >
          <Plus data-icon="inline-start" aria-hidden="true" />
          Start task
        </Button>
        {canLinkCurrent ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={link.isPending}
            aria-label={`Link to current task, ${currentTask?.title ?? "Untitled task"}`}
            onClick={() =>
              void run(() => link.mutateAsync({ sessionID: currentTask!.id, url: detail.url }))
            }
          >
            <Link2 data-icon="inline-start" aria-hidden="true" />
            Link to current task
          </Button>
        ) : null}
        {watchLink && (watchable || watchLink.watch) ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-pressed={Boolean(watchLink.watch)}
                  disabled={watch.isPending}
                  onClick={() =>
                    void run(() =>
                      watch.mutateAsync({
                        profileID: watchLink.profileID,
                        sessionID: watchLink.sessionID,
                        key: watchLink.key,
                        watching: !watchLink.watch,
                      }),
                    )
                  }
                />
              }
            >
              {watchLink.watch ? (
                <EyeOff data-icon="inline-start" aria-hidden="true" />
              ) : (
                <Eye data-icon="inline-start" aria-hidden="true" />
              )}
              {watchLink.watch ? "Stop watching" : "Watch"}
            </TooltipTrigger>
            <TooltipContent className="max-w-64">
              {WATCH_EXPLANATION} For {taskTitle(watchLink.sessionID)}.
            </TooltipContent>
          </Tooltip>
        ) : null}
      </div>
      {links.length ? (
        <div className="mt-2 flex min-w-0 flex-wrap items-center gap-1 text-meta text-muted-foreground">
          <span>Linked to</span>
          {links.map((candidate) => (
            <button
              key={candidate.sessionID}
              type="button"
              className="max-w-56 truncate rounded-sm px-1 text-foreground/80 underline-offset-2 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={`Open task ${taskTitle(candidate.sessionID)}`}
              onClick={() => void openSession(candidate.sessionID)}
            >
              {taskTitle(candidate.sessionID)}
            </button>
          ))}
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="mt-2 flex items-start gap-1.5 text-meta text-destructive">
          <CircleAlert className="mt-px size-3 shrink-0" aria-hidden="true" />
          {error}
        </p>
      ) : null}
    </header>
  );
}

function BranchName({ name, copied, onCopy }: { name: string; copied: boolean; onCopy(): void }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={`Copy branch ${name}`}
            className="group/branch inline-flex min-w-0 items-center gap-1 rounded-sm px-0.5 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            onClick={onCopy}
          />
        }
      >
        <span className="max-w-48 truncate">{name}</span>
        <Copy
          className="size-3 shrink-0 opacity-0 transition-opacity group-hover/branch:opacity-100 group-focus-visible/branch:opacity-100"
          aria-hidden="true"
        />
      </TooltipTrigger>
      <TooltipContent>{copied ? "Copied" : "Copy branch name"}</TooltipContent>
    </Tooltip>
  );
}

function DetailMenu({
  detail,
  refreshing,
  onRefresh,
  guide,
  onWriteGuide,
}: {
  detail: PullRequestDetail;
  refreshing: boolean;
  onRefresh(): void;
  guide: ReviewGuideController;
  onWriteGuide(): void;
}) {
  const setDraft = useSetPullRequestDraft();
  const setState = useSetPullRequestState();
  const { copy } = useClipboardCopy();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = { host: detail.host, repository: detail.repository, number: detail.number };
  const run = (action: () => Promise<unknown>) => {
    setError(null);
    void action().catch((cause: unknown) => setError(sourceControlErrorMessage(cause)));
  };
  const close = useArmedConfirm(() => {
    setOpen(false);
    run(() => setState.mutateAsync({ ...ref, state: "closed" }));
  });
  const busy = setDraft.isPending || setState.isPending;
  const canUpdate = detail.viewer.canUpdate;
  return (
    <>
      {error ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <span
                role="alert"
                aria-label={error}
                className="flex size-6 items-center justify-center text-destructive"
              />
            }
          >
            <CircleAlert className="size-3.5" aria-hidden="true" />
          </TooltipTrigger>
          <TooltipContent className="max-w-72">{error}</TooltipContent>
        </Tooltip>
      ) : null}
      <DropdownMenu
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) close.disarm();
        }}
      >
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Pull request actions"
              disabled={busy}
            />
          }
        >
          {busy || refreshing ? (
            <LoaderCircle className="animate-spin" aria-hidden="true" />
          ) : (
            <MoreHorizontal aria-hidden="true" />
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuGroup>
            {detail.state === "open" ? (
              <DropdownMenuItem
                disabled={!canUpdate}
                onClick={() => run(() => setDraft.mutateAsync({ ...ref, draft: true }))}
              >
                <GitPullRequestDraft aria-hidden="true" />
                Convert to draft
              </DropdownMenuItem>
            ) : null}
            {detail.state === "draft" ? (
              <DropdownMenuItem
                disabled={!canUpdate}
                onClick={() => run(() => setDraft.mutateAsync({ ...ref, draft: false }))}
              >
                <GitPullRequest aria-hidden="true" />
                Ready for review
              </DropdownMenuItem>
            ) : null}
            {detail.state === "open" || detail.state === "draft" ? (
              <DropdownMenuItem
                variant="destructive"
                closeOnClick={false}
                disabled={!canUpdate}
                {...close.buttonProps}
              >
                <GitPullRequestClosed aria-hidden="true" />
                {close.armed ? "Confirm close" : "Close pull request"}
              </DropdownMenuItem>
            ) : null}
            {detail.state === "closed" ? (
              <DropdownMenuItem
                disabled={!canUpdate}
                onClick={() => run(() => setState.mutateAsync({ ...ref, state: "open" }))}
              >
                <GitPullRequest aria-hidden="true" />
                Reopen
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuGroup>
          {detail.state !== "merged" ? <DropdownMenuSeparator /> : null}
          <DropdownMenuGroup>
            <DropdownMenuItem onClick={() => void copy(detail.url)}>
              <Copy aria-hidden="true" />
              Copy link
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onRefresh}>
              <RefreshCw aria-hidden="true" />
              Refresh
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem
              disabled={guide.running || guide.disabledReason !== null}
              title={guide.disabledReason ?? undefined}
              onClick={onWriteGuide}
            >
              <Sparkles aria-hidden="true" />
              {guide.running ? "Writing guide…" : guide.guide ? "Rewrite guide" : "Write guide"}
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
