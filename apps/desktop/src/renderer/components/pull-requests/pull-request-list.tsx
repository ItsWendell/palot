import { useAtom, useAtomValue } from "jotai";
import { Check, ChevronRight, Link2, LoaderCircle, Search, X } from "lucide-react";
import { memo, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { PalotSession } from "../../../shared";
import {
  pullRequestKey,
  type PullRequestLink,
  type PullRequestRef,
  type PullRequestSearchList,
  type PullRequestSnapshot,
} from "../../../shared/source-control-contract";
import { usePullRequestSearch } from "../../hooks/use-source-control";
import { cn } from "../../lib/cn";
import { SidebarFluidList, sidebarFluidRowProps } from "../sidebar-fluid-list";
import { Button } from "../ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../ui/collapsible";
import { Input } from "../ui/input";
import { toast } from "../ui/toast";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import { quickActionsFor, useQuickAction, type QuickAction } from "./pull-request-actions";
import { PullRequestFilterChips } from "./pull-request-filters";
import {
  pullRequestCollapsedSectionsAtom,
  pullRequestFilterQuery,
  pullRequestFiltersAtom,
} from "./pull-request-preferences";
import {
  CHECKS_DOT,
  CHECKS_LABEL,
  formatPullRequestTime,
  PULL_REQUEST_STATE_ICON,
  PULL_REQUEST_STATE_LABEL,
  PULL_REQUEST_STATE_TEXT,
  REVIEW_LABEL,
  sourceControlErrorMessage,
} from "./pull-request-presentation";
import { sameRef } from "./pull-request-ref";
import { useArmedConfirm } from "./use-armed-confirm";

export const PULL_REQUEST_SECTIONS: ReadonlyArray<{
  list: PullRequestSearchList;
  title: string;
  empty: string;
}> = [
  {
    list: "review-requested",
    title: "Review requested",
    empty: "Nothing is waiting for your review.",
  },
  { list: "assigned", title: "Assigned", empty: "Nothing is assigned to you." },
  {
    list: "others",
    title: "Open by others",
    empty: "No one else has an open pull request here.",
  },
  { list: "authored", title: "Authored", empty: "You have no open pull requests." },
  { list: "mentioned", title: "Mentioned", empty: "No open pull requests mention you." },
  { list: "recently-merged", title: "Recently merged", empty: "Nothing merged recently." },
];

const SEARCH_DEBOUNCE_MS = 300;
/** Mirrors the main process's scope check: "Open by others" needs a repository or organization. */
const SEARCH_SCOPE = /(?:^|\s)(?:repo|org|user):\S/i;
const ROW_SELECTOR = "button[data-pull-request-row]";

/**
 * The review screen's left pane: a debounced GitHub search over five collapsible lists,
 * narrowed by the persisted filters (as GitHub qualifiers, so they apply beyond loaded rows).
 * ↑/↓ move between rows across sections, Enter opens one; holding Shift reveals quick
 * actions on every row.
 */
export function PullRequestList({
  host = "github.com",
  kind = "github",
  enabled,
  selected,
  onSelect,
  linksByKey,
  sessions,
  quickActions,
}: {
  host?: string;
  kind?: import("../../../shared/source-control-contract").CodeHostKind;
  enabled: boolean;
  selected: PullRequestRef | null;
  onSelect(pullRequest: PullRequestSnapshot): void;
  linksByKey: ReadonlyMap<string, PullRequestLink[]>;
  sessions: readonly PalotSession[];
  /** Shift is held: show each row's quick actions. */
  quickActions: boolean;
}) {
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const filterQuery = pullRequestFilterQuery(useAtomValue(pullRequestFiltersAtom));
  const combinedQuery = [kind === "github" || kind === "bitbucket" ? filterQuery : "", query]
    .filter(Boolean)
    .join(" ");
  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(draft.trim()), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [draft]);

  const moveFocus = (event: KeyboardEvent<HTMLElement>) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const rows = Array.from(
      listRef.current?.querySelectorAll<HTMLButtonElement>(ROW_SELECTOR) ?? [],
    );
    if (rows.length === 0) return;
    event.preventDefault();
    const current = rows.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? rows.length - 1
          : current === -1
            ? event.key === "ArrowDown"
              ? 0
              : rows.length - 1
            : Math.min(
                rows.length - 1,
                Math.max(0, current + (event.key === "ArrowDown" ? 1 : -1)),
              );
    rows[next]?.focus();
    rows[next]?.scrollIntoView({ block: "nearest" });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="relative shrink-0 px-3 pt-3 pb-2">
        <Search
          className="pointer-events-none absolute top-1/2 left-5 mt-0.5 size-3.5 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          type="search"
          aria-label="Search pull requests"
          placeholder="Search, e.g. repo:owner/name label:bug"
          value={draft}
          className="pl-7"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape" && draft) {
              event.preventDefault();
              setDraft("");
              return;
            }
            if (event.key === "ArrowDown") moveFocus(event);
          }}
        />
        {draft ? (
          <button
            type="button"
            aria-label="Clear search"
            className="absolute top-1/2 right-4 mt-0.5 flex size-5 -translate-y-1/2 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground"
            onClick={() => setDraft("")}
          >
            <X className="size-3" aria-hidden="true" />
          </button>
        ) : null}
      </div>
      {kind === "github" || kind === "bitbucket" ? <PullRequestFilterChips /> : null}
      <div
        ref={listRef}
        role="navigation"
        aria-label="Pull request lists"
        className="palot-native-scrollbar min-h-0 flex-1 overflow-y-auto px-2 pb-6"
        onKeyDown={moveFocus}
      >
        {PULL_REQUEST_SECTIONS.filter(
          (section) =>
            kind === "github" ||
            (kind === "gitlab" && section.list !== "mentioned" && section.list !== "others") ||
            (kind === "forgejo" &&
              section.list !== "mentioned" &&
              section.list !== "recently-merged" &&
              section.list !== "others") ||
            (kind === "bitbucket" && section.list === "authored"),
        ).map((section) => (
          <PullRequestSection
            key={section.list}
            host={host}
            list={section.list}
            title={kind === "bitbucket" ? "Repository pull requests" : section.title}
            empty={combinedQuery ? "No matches." : section.empty}
            query={combinedQuery}
            enabled={enabled}
            unscoped={
              section.list === "others" && !SEARCH_SCOPE.test(combinedQuery)
                ? "Choose a repository or organization in Filters to see everyone's open pull requests there."
                : undefined
            }
            selected={selected}
            onSelect={onSelect}
            linksByKey={linksByKey}
            sessions={sessions}
            quickActions={quickActions && kind === "github"}
          />
        ))}
      </div>
    </div>
  );
}

function PullRequestSection({
  host,
  list,
  title,
  empty,
  query,
  enabled,
  unscoped,
  selected,
  onSelect,
  linksByKey,
  sessions,
  quickActions,
}: {
  host: string;
  list: PullRequestSearchList;
  title: string;
  empty: string;
  query: string;
  enabled: boolean;
  /** Why this list can't load yet; it then shows this instead of searching. */
  unscoped?: string;
  selected: PullRequestRef | null;
  onSelect(pullRequest: PullRequestSnapshot): void;
  linksByKey: ReadonlyMap<string, PullRequestLink[]>;
  sessions: readonly PalotSession[];
  quickActions: boolean;
}) {
  const search = usePullRequestSearch(list, { enabled: enabled && !unscoped, query, host });
  const [collapsed, setCollapsed] = useAtom(pullRequestCollapsedSectionsAtom);
  const open = !collapsed[list];
  const items = useMemo(
    () => search.data?.pages.flatMap((page) => page.items) ?? [],
    [search.data],
  );
  const total = search.data?.pages[0]?.totalCount;
  return (
    <Collapsible
      open={open}
      onOpenChange={(next) => setCollapsed((current) => ({ ...current, [list]: !next }))}
      render={<section aria-label={title} className="pt-1" />}
    >
      <CollapsibleTrigger
        render={
          <button
            type="button"
            className="group/section-label flex h-7 w-full items-center gap-1 rounded-md px-1.5 text-xs font-semibold text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          />
        }
      >
        <span className="truncate">{title}</span>
        <ChevronRight
          className={cn(
            "size-3 shrink-0 text-muted-foreground/60 transition-transform",
            open && "rotate-90",
          )}
          aria-hidden="true"
        />
        <span className="ml-auto text-micro font-normal tabular-nums">
          {search.isFetching && !search.isFetchingNextPage ? (
            <LoaderCircle className="size-3 animate-spin" aria-label="Loading" />
          ) : (
            (total ?? "")
          )}
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        {unscoped ? (
          <p className="px-2 py-2 text-meta text-muted-foreground">{unscoped}</p>
        ) : search.error && items.length === 0 ? (
          <p className="px-2 py-2 text-meta text-muted-foreground">
            {sourceControlErrorMessage(search.error)}
          </p>
        ) : search.data && items.length === 0 ? (
          <p className="px-2 py-2 text-meta text-muted-foreground">{empty}</p>
        ) : (
          <SidebarFluidList className="flex flex-col" highlightClassName="bg-(--control-hover)">
            {items.map((pullRequest) => {
              const key = pullRequestKey(pullRequest);
              return (
                <PullRequestRow
                  key={key}
                  list={list}
                  pullRequest={pullRequest}
                  selected={sameRef(selected, pullRequest)}
                  onSelect={onSelect}
                  links={linksByKey.get(key)}
                  sessions={sessions}
                  quickActions={quickActions}
                />
              );
            })}
          </SidebarFluidList>
        )}
        {search.hasNextPage ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mt-0.5 ml-1 text-muted-foreground"
            disabled={search.isFetchingNextPage}
            onClick={() => void search.fetchNextPage()}
          >
            {search.isFetchingNextPage ? (
              <LoaderCircle data-icon="inline-start" className="animate-spin" aria-hidden="true" />
            ) : null}
            Load more
          </Button>
        ) : null}
      </CollapsibleContent>
    </Collapsible>
  );
}

const PullRequestRow = memo(function PullRequestRow({
  list,
  pullRequest,
  selected,
  onSelect,
  links,
  sessions,
  quickActions,
}: {
  list: PullRequestSearchList;
  pullRequest: PullRequestSnapshot;
  selected: boolean;
  onSelect(pullRequest: PullRequestSnapshot): void;
  links: PullRequestLink[] | undefined;
  sessions: readonly PalotSession[];
  quickActions: boolean;
}) {
  const Icon = PULL_REQUEST_STATE_ICON[pullRequest.state];
  const taskTitles = (links ?? []).map(
    (link) =>
      sessions.find((session) => session.id === link.sessionID)?.title?.trim() || "Untitled task",
  );
  const actions = quickActionsFor(list, pullRequest);
  const label = [
    `#${pullRequest.number} ${pullRequest.title}`,
    pullRequest.repository,
    PULL_REQUEST_STATE_LABEL[pullRequest.state],
    pullRequest.checks === "none" ? null : CHECKS_LABEL[pullRequest.checks],
    pullRequest.reviewDecision ? REVIEW_LABEL[pullRequest.reviewDecision] : null,
    pullRequest.author ? `by ${pullRequest.author}` : null,
  ]
    .filter(Boolean)
    .join(", ");
  return (
    <div
      {...sidebarFluidRowProps}
      className={cn(
        "group/pr-row relative flex min-w-0 items-center rounded-md",
        selected && "bg-(--control-selected-inactive)",
      )}
    >
      <button
        type="button"
        data-pull-request-row={pullRequestKey(pullRequest)}
        aria-current={selected ? "true" : undefined}
        aria-label={label}
        className="flex min-w-0 flex-1 items-start gap-2 rounded-md px-2 py-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        onClick={() => onSelect(pullRequest)}
      >
        <span className="flex w-4 shrink-0 flex-col items-center gap-1 pt-0.5" aria-hidden="true">
          <Icon className={cn("size-3.5", PULL_REQUEST_STATE_TEXT[pullRequest.state])} />
          {pullRequest.checks !== "none" ? (
            <span className={cn("size-1.5 rounded-full", CHECKS_DOT[pullRequest.checks])} />
          ) : null}
        </span>
        <span className="min-w-0 flex-1" aria-hidden="true">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="shrink-0 font-mono text-meta text-muted-foreground tabular-nums">
              #{pullRequest.number}
            </span>
            <span className="min-w-0 truncate text-compact">{pullRequest.title}</span>
            {pullRequest.reviewDecision === "approved" ? (
              <Check className="size-3 shrink-0 text-success" />
            ) : pullRequest.reviewDecision === "changes-requested" ? (
              <span className="size-1.5 shrink-0 rounded-full bg-destructive" />
            ) : null}
          </span>
          <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-micro text-muted-foreground">
            <span className="min-w-0 truncate">{pullRequest.repository}</span>
            {pullRequest.author ? (
              <span className="max-w-24 shrink-0 truncate">· {pullRequest.author}</span>
            ) : null}
            {taskTitles.length ? (
              <span className="flex min-w-0 shrink items-center gap-0.5 text-foreground/70">
                <Link2 className="size-3 shrink-0" />
                <span className="max-w-28 truncate">{taskTitles[0]}</span>
                {taskTitles.length > 1 ? <span>+{taskTitles.length - 1}</span> : null}
              </span>
            ) : null}
            <span className="ml-auto shrink-0 tabular-nums">
              {formatPullRequestTime(pullRequest.updatedAt)}
            </span>
          </span>
        </span>
      </button>
      {actions.length ? (
        <div
          role="group"
          aria-label={`Quick actions for #${pullRequest.number}`}
          data-visible={quickActions || undefined}
          className="hidden shrink-0 items-center gap-1 pr-1.5 data-visible:flex has-data-armed:flex has-data-pending:flex"
        >
          {actions.map((action) => (
            <QuickActionButton key={action} action={action} pullRequest={pullRequest} />
          ))}
        </div>
      ) : null}
    </div>
  );
});

const QUICK_ACTION_LABEL: Record<QuickAction, { idle: string; armed: string; done: string }> = {
  approve: { idle: "Approve", armed: "Confirm approve", done: "Approved" },
  merge: { idle: "Merge", armed: "Confirm merge", done: "Merged" },
  close: { idle: "Close", armed: "Confirm close", done: "Closed" },
};

function QuickActionButton({
  action,
  pullRequest,
}: {
  action: QuickAction;
  pullRequest: PullRequestSnapshot;
}) {
  const run = useQuickAction();
  const [pending, setPending] = useState(false);
  const labels = QUICK_ACTION_LABEL[action];
  const confirm = useArmedConfirm(() => {
    setPending(true);
    void run(action, pullRequest)
      .then(() => toast.add({ type: "success", title: `${labels.done} #${pullRequest.number}` }))
      .catch((error: unknown) =>
        toast.add({
          type: "error",
          title: `Could not ${labels.idle.toLowerCase()} #${pullRequest.number}`,
          description: sourceControlErrorMessage(error),
        }),
      )
      .finally(() => setPending(false));
  });
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            size="xs"
            variant={!confirm.armed ? "outline" : action === "close" ? "destructive" : "secondary"}
            aria-label={`${confirm.armed ? labels.armed : labels.idle} #${pullRequest.number}`}
            data-pending={pending || undefined}
            disabled={pending}
            {...confirm.buttonProps}
          />
        }
      >
        {pending ? (
          <LoaderCircle data-icon="inline-start" className="animate-spin" aria-hidden="true" />
        ) : null}
        {confirm.armed ? labels.armed : labels.idle}
      </TooltipTrigger>
      <TooltipContent>
        {confirm.armed ? "Click again to confirm" : `${labels.idle} #${pullRequest.number}`}
      </TooltipContent>
    </Tooltip>
  );
}

/** True while Shift is held outside text fields; resets when the window loses focus. */
export function useShiftHeld(): boolean {
  const [held, setHeld] = useState(false);
  useEffect(() => {
    const editable = (target: EventTarget | null) =>
      target instanceof HTMLElement &&
      (target.isContentEditable || target.closest("input, textarea, select") !== null);
    const down = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Shift" && !editable(event.target)) setHeld(true);
    };
    const up = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Shift") setHeld(false);
    };
    const reset = () => setHeld(false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", reset);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", reset);
    };
  }, []);
  return held;
}
