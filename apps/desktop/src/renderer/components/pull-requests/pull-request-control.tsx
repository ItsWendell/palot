import {
  CircleAlert,
  ExternalLink,
  Eye,
  EyeOff,
  GitBranch,
  GitPullRequest,
  LoaderCircle,
  PanelsTopLeft,
  RefreshCw,
  Unlink,
} from "lucide-react";
import { useState, type FormEvent } from "react";
import type { PalotSession } from "../../../shared";
import type { PullRequestLink, SourceControlStatus } from "../../../shared/source-control-contract";
import { usePalotNavigation } from "../../hooks/use-navigation";
import {
  useLinkPullRequest,
  useRefreshPullRequests,
  useSessionPullRequests,
  useSourceControlStatus,
  useUnlinkPullRequest,
  useWatchPullRequest,
} from "../../hooks/use-source-control";
import { cn } from "../../lib/cn";
import { palot } from "../../services/palot";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import {
  CHECKS_DOT,
  CHECKS_LABEL,
  describePullRequest,
  GITHUB_SIGN_IN_HINT,
  primaryPullRequestLink,
  pullRequestCanWatch,
  PULL_REQUEST_STATE_ICON,
  PULL_REQUEST_STATE_LABEL,
  PULL_REQUEST_STATE_TEXT,
  REVIEW_LABEL,
  sourceControlErrorMessage,
  WATCH_END_LABEL,
  WATCH_EXPLANATION,
} from "./pull-request-presentation";
import { useArmedConfirm } from "./use-armed-confirm";

const UNSUPPORTED_FALLBACK = "Pull requests are only available for tasks on this computer.";

/**
 * The task header's "Pull request" control: linked PRs with state and checks, and the
 * link, refresh, watch, and unlink actions. Remote connections get a disabled trigger
 * with the reason instead of failing on open.
 */
export function PullRequestControl({ session }: { session: PalotSession }) {
  const status = useSourceControlStatus();
  const links = useSessionPullRequests(session.id);
  const [open, setOpen] = useState(false);
  const unsupportedReason = status.error
    ? UNSUPPORTED_FALLBACK
    : status.data && !status.data.supported
      ? (status.data.unsupportedReason ?? UNSUPPORTED_FALLBACK)
      : null;
  if (unsupportedReason) {
    return (
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-disabled="true"
              aria-label={`Pull request unavailable: ${unsupportedReason}`}
              className="window-no-drag shrink-0 text-muted-foreground/60 hover:bg-transparent hover:text-muted-foreground/60"
            />
          }
        >
          <GitPullRequest aria-hidden="true" />
        </TooltipTrigger>
        <TooltipContent>{unsupportedReason}</TooltipContent>
      </Tooltip>
    );
  }
  const linked = links.data ?? [];
  const primary = primaryPullRequestLink(linked);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size={primary ? "sm" : "icon-sm"}
            className="window-no-drag shrink-0 text-muted-foreground tabular-nums"
            aria-label={primary ? describePullRequest(primary) : "Pull request"}
            data-pull-request-control
          />
        }
      >
        {primary ? <TriggerContent link={primary} more={linked.length - 1} /> : null}
        {!primary ? <GitPullRequest aria-hidden="true" /> : null}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 gap-3 p-3" aria-label="Pull request">
        {open ? (
          <PullRequestPanel
            session={session}
            links={linked}
            loading={links.isPending}
            authenticated={anyGitHubHostAuthenticated(status.data)}
            onNavigate={() => setOpen(false)}
          />
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

/**
 * Linking and refreshing need a signed-in GitHub host, but not github.com in particular: a PR
 * on the GH_HOST instance is read with that host's credential. Unknown status stays enabled.
 */
function anyGitHubHostAuthenticated(status: SourceControlStatus | undefined): boolean {
  if (!status) return true;
  const hosts = status.githubHosts ?? [status.github];
  return hosts.some((host) => host.authenticated);
}

function TriggerContent({ link, more }: { link: PullRequestLink; more: number }) {
  const { pullRequest } = link;
  const Icon = PULL_REQUEST_STATE_ICON[pullRequest.state];
  return (
    <>
      <Icon className={PULL_REQUEST_STATE_TEXT[pullRequest.state]} aria-hidden="true" />
      <span className="text-meta">#{pullRequest.number}</span>
      {more > 0 ? <span className="text-meta">+{more}</span> : null}
      {pullRequest.checks !== "none" ? (
        <span
          className={cn("size-1.5 rounded-full", CHECKS_DOT[pullRequest.checks])}
          aria-hidden="true"
        />
      ) : null}
      {link.watch ? <Eye className="size-3" aria-hidden="true" /> : null}
    </>
  );
}

function PullRequestPanel({
  session,
  links,
  loading,
  authenticated,
  onNavigate,
}: {
  session: PalotSession;
  links: PullRequestLink[];
  loading: boolean;
  authenticated: boolean;
  onNavigate(): void;
}) {
  const refresh = useRefreshPullRequests();
  const [error, setError] = useState<string | null>(null);
  const run = async (action: () => Promise<unknown>) => {
    setError(null);
    try {
      await action();
    } catch (cause) {
      setError(sourceControlErrorMessage(cause));
    }
  };
  return (
    <div className="flex flex-col gap-3 text-sm">
      <div className="flex items-center gap-2">
        <span className="flex-1 font-medium">Pull request</span>
        {links.length > 0 ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Refresh pull requests"
            disabled={refresh.isPending || !authenticated}
            onClick={() => void run(() => refresh.mutateAsync({ sessionID: session.id }))}
          >
            <RefreshCw className={refresh.isPending ? "animate-spin" : undefined} />
          </Button>
        ) : null}
      </div>
      {!authenticated ? (
        <p className="text-meta text-muted-foreground">
          GitHub is not signed in. {GITHUB_SIGN_IN_HINT}
        </p>
      ) : null}
      {loading ? (
        <div className="flex items-center gap-2 text-meta text-muted-foreground">
          <LoaderCircle className="size-3 animate-spin" aria-hidden="true" />
          Loading
        </div>
      ) : null}
      {links.map((link) => (
        <LinkedPullRequest key={link.key} link={link} onRun={run} onNavigate={onNavigate} />
      ))}
      {!loading ? (
        <LinkForm
          session={session}
          hasLinks={links.length > 0}
          disabled={!authenticated}
          onRun={run}
        />
      ) : null}
      {error ? (
        <p role="alert" className="flex items-start gap-1.5 text-meta text-destructive">
          <CircleAlert className="mt-px size-3 shrink-0" aria-hidden="true" />
          {error}
        </p>
      ) : null}
    </div>
  );
}

function LinkedPullRequest({
  link,
  onRun,
  onNavigate,
}: {
  link: PullRequestLink;
  onRun(action: () => Promise<unknown>): Promise<void>;
  onNavigate(): void;
}) {
  const { pullRequest } = link;
  const { openPullRequests } = usePalotNavigation();
  const watch = useWatchPullRequest();
  const unlink = useUnlinkPullRequest();
  const confirmUnlink = useArmedConfirm(
    () =>
      void onRun(() =>
        unlink.mutateAsync({ sessionID: link.sessionID, key: link.key, profileID: link.profileID }),
      ),
  );
  const Icon = PULL_REQUEST_STATE_ICON[pullRequest.state];
  const watchable = pullRequestCanWatch(pullRequest);
  const facts = [
    PULL_REQUEST_STATE_LABEL[pullRequest.state],
    pullRequest.checks === "none" ? null : CHECKS_LABEL[pullRequest.checks],
    pullRequest.reviewDecision ? REVIEW_LABEL[pullRequest.reviewDecision] : null,
    pullRequest.mergeable === "conflicting" ? "Conflicts" : null,
  ].filter(Boolean);
  return (
    <section
      className="flex flex-col gap-1.5 rounded-md border border-border/70 p-2"
      aria-label={`#${pullRequest.number} ${pullRequest.title}`}
    >
      <div className="flex min-w-0 items-start gap-2">
        <Icon
          className={cn("mt-0.5 size-3.5 shrink-0", PULL_REQUEST_STATE_TEXT[pullRequest.state])}
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1">
          <div className="line-clamp-2 text-compact font-medium">
            <span className="text-muted-foreground tabular-nums">#{pullRequest.number}</span>{" "}
            {pullRequest.title}
          </div>
          <div className="truncate text-meta text-muted-foreground">
            {pullRequest.repository} · {facts.join(" · ")}
          </div>
          <div className="flex min-w-0 items-center gap-1 text-meta text-muted-foreground">
            <GitBranch className="size-3 shrink-0" aria-hidden="true" />
            <span className="truncate">
              {pullRequest.headBranch} → {pullRequest.baseBranch}
            </span>
          </div>
        </div>
      </div>
      {link.syncError ? (
        <p className="text-meta text-muted-foreground" title={link.syncError}>
          Last refresh failed: {link.syncError}
        </p>
      ) : null}
      {!link.watch && link.watchEnded ? (
        <p className="text-meta text-muted-foreground">{WATCH_END_LABEL[link.watchEnded.reason]}</p>
      ) : null}
      {watchable || link.watch ? (
        <p className="text-meta text-muted-foreground">{WATCH_EXPLANATION}</p>
      ) : null}
      <div className="flex flex-wrap items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            onNavigate();
            void openPullRequests(pullRequest);
          }}
        >
          <PanelsTopLeft data-icon="inline-start" aria-hidden="true" />
          Open in Pull requests
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => void palot.openExternalUrl(pullRequest.url)}
        >
          <ExternalLink data-icon="inline-start" aria-hidden="true" />
          Open on GitHub
        </Button>
        {watchable || link.watch ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-pressed={Boolean(link.watch)}
            disabled={watch.isPending}
            onClick={() =>
              void onRun(() =>
                watch.mutateAsync({
                  profileID: link.profileID,
                  sessionID: link.sessionID,
                  key: link.key,
                  watching: !link.watch,
                }),
              )
            }
          >
            {link.watch ? (
              <EyeOff data-icon="inline-start" aria-hidden="true" />
            ) : (
              <Eye data-icon="inline-start" aria-hidden="true" />
            )}
            {link.watch ? "Stop watching" : "Watch"}
          </Button>
        ) : null}
        <Button
          type="button"
          variant={confirmUnlink.armed ? "destructive" : "ghost"}
          size="sm"
          className="ml-auto"
          disabled={unlink.isPending}
          {...confirmUnlink.buttonProps}
        >
          <Unlink data-icon="inline-start" aria-hidden="true" />
          {confirmUnlink.armed ? "Confirm unlink" : "Unlink"}
        </Button>
      </div>
    </section>
  );
}

function LinkForm({
  session,
  hasLinks,
  disabled,
  onRun,
}: {
  session: PalotSession;
  hasLinks: boolean;
  disabled: boolean;
  onRun(action: () => Promise<unknown>): Promise<void>;
}) {
  const link = useLinkPullRequest();
  const [expanded, setExpanded] = useState(!hasLinks);
  const [url, setURL] = useState("");
  if (!expanded) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="self-start"
        disabled={disabled}
        onClick={() => setExpanded(true)}
      >
        <GitPullRequest data-icon="inline-start" aria-hidden="true" />
        Link another pull request…
      </Button>
    );
  }
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = url.trim();
    if (!trimmed) return;
    void onRun(async () => {
      await link.mutateAsync({ sessionID: session.id, url: trimmed });
      setURL("");
    });
  };
  return (
    <form className="flex flex-col gap-2" onSubmit={submit} aria-label="Link pull request">
      {!hasLinks ? (
        <p className="text-meta text-muted-foreground">
          No pull request is linked to this task. Detect it from the task's branch or paste its URL.
        </p>
      ) : null}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="self-start"
        disabled={disabled || link.isPending}
        onClick={() => void onRun(() => link.mutateAsync({ sessionID: session.id }))}
      >
        {link.isPending && !url.trim() ? (
          <LoaderCircle data-icon="inline-start" className="animate-spin" aria-hidden="true" />
        ) : (
          <GitBranch data-icon="inline-start" aria-hidden="true" />
        )}
        Detect from branch
      </Button>
      <div className="flex items-center gap-1.5">
        <Input
          aria-label="Pull request URL"
          placeholder="https://github.com/owner/repo/pull/123"
          value={url}
          disabled={disabled}
          className="h-7 min-w-0 flex-1 text-meta"
          onChange={(event) => setURL(event.target.value)}
        />
        <Button type="submit" size="sm" disabled={disabled || link.isPending || !url.trim()}>
          Link
        </Button>
      </div>
    </form>
  );
}
