import { useQueryClient } from "@tanstack/react-query";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { CircleAlert, GitPullRequest, LoaderCircle, RefreshCw } from "lucide-react";
import { useCallback, useMemo, type ReactNode } from "react";
import {
  pullRequestKey,
  type PullRequestLink,
  type PullRequestSearchPage,
  type PullRequestSnapshot,
} from "../../../shared/source-control-contract";
import { useSessionCatalog } from "../../hooks/use-session-catalog";
import {
  sourceControlKeys,
  usePullRequestLinks,
  useSourceControlStatus,
} from "../../hooks/use-source-control";
import { cn } from "../../lib/cn";
import { Button } from "../ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "../ui/empty";
import { PullRequestDetailPane } from "./pull-request-detail";
import { PullRequestList, useShiftHeld } from "./pull-request-list";
import { formatRetryTime, sourceControlErrorMessage } from "./pull-request-presentation";
import {
  formatPullRequestParam,
  parsePullRequestParam,
  validatePullRequestsSearch,
} from "./pull-request-ref";

const UNSUPPORTED_FALLBACK = "Linking pull requests to tasks only works on this computer.";
const NARROW = "@max-[44rem]/pull-requests";

/**
 * GitHub review screen: lists on the left, the selected pull request on the right. The
 * selection lives in the `pr` search param so tasks can deep-link into it. Under a narrow
 * container the panes stack and the detail gets a back button.
 */
export function PullRequestsPage() {
  const search = useRouterState({
    select: (state) => validatePullRequestsSearch(state.location.search as Record<string, unknown>),
  });
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const status = useSourceControlStatus();
  const links = usePullRequestLinks();
  const sessions = useSessionCatalog();
  const shiftHeld = useShiftHeld();
  const selected = useMemo(() => parsePullRequestParam(search.pr), [search.pr]);
  const github = status.data?.github;
  const authenticated = github?.authenticated === true;
  const linkUnsupported = status.error
    ? sourceControlErrorMessage(status.error)
    : status.data && !status.data.supported
      ? (status.data.unsupportedReason ?? UNSUPPORTED_FALLBACK)
      : null;
  const pausedUntil =
    github?.pausedUntil && github.pausedUntil > Date.now() ? github.pausedUntil : null;
  const authRejected = github?.error?.code === "github-auth-failed";

  const linksByKey = useMemo(() => {
    const grouped = new Map<string, PullRequestLink[]>();
    for (const link of links.data ?? [])
      grouped.set(link.key, [...(grouped.get(link.key) ?? []), link]);
    return grouped;
  }, [links.data]);

  const select = useCallback(
    (pullRequest: PullRequestSnapshot | null) =>
      void navigate({
        to: "/pull-requests",
        search: (previous) => {
          const { pr: _previous, ...rest } = previous as Record<string, unknown>;
          return pullRequest ? { ...rest, pr: formatPullRequestParam(pullRequest) } : rest;
        },
        replace: true,
      }),
    [navigate],
  );
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: [...sourceControlKeys.all, "status"] });
    void queryClient.invalidateQueries({ queryKey: sourceControlKeys.searches() });
    void links.refetch();
  };
  const knownLogins = () => {
    const logins = new Set<string>();
    for (const [, data] of queryClient.getQueriesData<{ pages: PullRequestSearchPage[] }>({
      queryKey: sourceControlKeys.searches(),
    }))
      for (const page of data?.pages ?? [])
        for (const item of page.items) if (item.author) logins.add(item.author);
    return [...logins].toSorted((left, right) => left.localeCompare(right));
  };

  return (
    <main
      className="palot-main-surface @container/pull-requests relative flex size-full min-h-0 min-w-0 overflow-hidden bg-background"
      aria-label="Pull requests"
    >
      {status.isPending ? (
        <PageMessage>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
            Checking GitHub sign-in
          </div>
        </PageMessage>
      ) : !authenticated || authRejected ? (
        <PageMessage>
          <Empty className="min-h-64 max-w-md border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <GitPullRequest aria-hidden="true" />
              </EmptyMedia>
              <EmptyTitle>Sign in to GitHub</EmptyTitle>
              <EmptyDescription>
                Run <code className="font-mono text-code-compact">gh auth login</code> in a terminal
                or set <code className="font-mono text-code-compact">GH_TOKEN</code>, then refresh.
              </EmptyDescription>
            </EmptyHeader>
            <Button type="button" variant="outline" size="sm" onClick={refresh}>
              <RefreshCw data-icon="inline-start" aria-hidden="true" />
              Refresh
            </Button>
          </Empty>
        </PageMessage>
      ) : (
        <>
          <aside
            aria-label="Pull request lists"
            className={cn(
              "flex w-[22.5rem] shrink-0 flex-col border-r border-border/60",
              `${NARROW}:w-full ${NARROW}:border-r-0`,
              selected && `${NARROW}:hidden`,
            )}
          >
            <div className="window-drag flex h-(--shell-header-height) shrink-0 items-center gap-2 border-b border-border/60 px-4">
              <h1 className="text-compact font-semibold">Pull requests</h1>
              {github?.login ? (
                <span className="truncate text-meta text-muted-foreground">{github.login}</span>
              ) : null}
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Refresh pull requests"
                className="window-no-drag ml-auto"
                onClick={refresh}
              >
                <RefreshCw aria-hidden="true" />
              </Button>
            </div>
            {pausedUntil ? (
              <p
                role="status"
                className="mx-3 mt-3 flex items-start gap-1.5 text-meta text-muted-foreground"
              >
                <CircleAlert className="mt-px size-3 shrink-0 text-warning" aria-hidden="true" />
                GitHub rate limit reached. Palot will try again after {formatRetryTime(pausedUntil)}
                .
              </p>
            ) : null}
            <PullRequestList
              enabled={authenticated}
              selected={selected}
              onSelect={select}
              linksByKey={linksByKey}
              sessions={sessions}
              quickActions={shiftHeld}
            />
            {linkUnsupported ? (
              <p className="shrink-0 border-t border-border/60 px-4 py-2 text-micro text-muted-foreground">
                Task linking is unavailable on this connection. {linkUnsupported}
              </p>
            ) : (
              <p className="shrink-0 border-t border-border/60 px-4 py-2 text-micro text-muted-foreground">
                Hold Shift for quick actions.
              </p>
            )}
          </aside>
          <div
            className={cn("flex min-h-0 min-w-0 flex-1 flex-col", !selected && `${NARROW}:hidden`)}
          >
            {selected ? (
              <PullRequestDetailPane
                key={pullRequestKey(selected)}
                pullRequest={selected}
                links={linksByKey.get(pullRequestKey(selected)) ?? []}
                sessions={sessions}
                linkingSupported={linkUnsupported === null}
                knownLogins={knownLogins()}
                onBack={() => select(null)}
              />
            ) : (
              <>
                <div className="window-drag h-(--shell-header-height) shrink-0 border-b border-border/60" />
                <PageMessage>
                  <Empty className="max-w-sm">
                    <EmptyHeader>
                      <EmptyMedia variant="icon">
                        <GitPullRequest aria-hidden="true" />
                      </EmptyMedia>
                      <EmptyTitle>Select a pull request</EmptyTitle>
                      <EmptyDescription>
                        Review changes, checks, and conversation, then merge without leaving Palot.
                      </EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                </PageMessage>
              </>
            )}
          </div>
        </>
      )}
    </main>
  );
}

function PageMessage({ children }: { children: ReactNode }) {
  return <div className="flex min-h-0 flex-1 items-center justify-center p-6">{children}</div>;
}
