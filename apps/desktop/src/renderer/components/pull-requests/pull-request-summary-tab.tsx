import {
  CircleAlert,
  CircleCheck,
  CircleX,
  ExternalLink,
  GitMerge,
  LoaderCircle,
  UserPlus,
  X,
} from "lucide-react";
import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import type {
  PullRequestCheck,
  PullRequestDetail,
  PullRequestMergeMethod,
} from "../../../shared/source-control-contract";
import {
  useMergePullRequest,
  useRequestPullRequestReviewers,
} from "../../hooks/use-source-control";
import { cn } from "../../lib/cn";
import { palot } from "../../services/palot";
import { MarkdownContent } from "../markdown-content";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { refOf, useMergeMethod } from "./pull-request-actions";
import { PullRequestPersonLabel } from "./pull-request-person";
import {
  checkDuration,
  checkStatusLabel,
  formatPullRequestTime,
  groupChecks,
  MERGE_METHOD_LABEL,
  mergeAvailability,
  REVIEWER_STATE_LABEL,
  sourceControlErrorMessage,
  type CheckGroup,
} from "./pull-request-presentation";
import { useArmedConfirm } from "./use-armed-confirm";
import { PullRequestBranchActions, PullRequestLabelPicker } from "./pull-request-edit";

export function PullRequestSummaryTab({
  detail,
  knownLogins,
}: {
  detail: PullRequestDetail;
  knownLogins: readonly string[];
}) {
  return (
    <div className="flex flex-col gap-6 px-4 pt-4 pb-10">
      <MergeBox detail={detail} />
      <SummarySection title="Labels" aside={<PullRequestLabelPicker detail={detail} />}>
        {detail.labels.length ? (
          <div className="flex min-w-0 flex-wrap gap-1">
            {detail.labels.map((label) => (
              <span
                key={label.name}
                className="inline-flex h-5 items-center gap-1 rounded-full border border-border/70 px-2 text-tag"
              >
                <span
                  className="size-2 rounded-full"
                  style={{ backgroundColor: `#${label.color.replace(/^#/, "")}` }}
                  aria-hidden="true"
                />
                {label.name}
              </span>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No labels.</p>
        )}
      </SummarySection>
      <SummarySection title="Description">
        {detail.body.trim() ? (
          <MarkdownContent value={detail.body} baseUrl={detail.url} className="text-sm" />
        ) : (
          <p className="text-sm text-muted-foreground">No description.</p>
        )}
      </SummarySection>
      <ChecksSection detail={detail} />
      <ReviewersSection detail={detail} knownLogins={knownLogins} />
      {detail.assignees.length ? (
        <SummarySection title="Details">
          <dl className="grid grid-cols-[6rem_minmax(0,1fr)] gap-x-2 gap-y-1.5 text-meta">
            <dt className="text-muted-foreground">Assignees</dt>
            <dd className="flex min-w-0 flex-wrap gap-x-3 gap-y-1">
              {detail.assignees.map((assignee) => (
                <PullRequestPersonLabel key={assignee.login} person={assignee} />
              ))}
            </dd>
          </dl>
        </SummarySection>
      ) : null}
    </div>
  );
}

function SummarySection({
  title,
  aside,
  children,
}: {
  title: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section aria-label={title} className="min-w-0">
      <div className="mb-2 flex min-h-6 items-center gap-2">
        <h3 className="text-xs font-semibold text-muted-foreground">{title}</h3>
        {aside ? <div className="ml-auto flex items-center gap-1">{aside}</div> : null}
      </div>
      {children}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// Merge
// ---------------------------------------------------------------------------------------------

function MergeBox({ detail }: { detail: PullRequestDetail }) {
  const merge = useMergePullRequest();
  const [method, setMethod] = useMergeMethod(detail);
  const [error, setError] = useState<string | null>(null);
  const availability = mergeAvailability(detail);
  const confirm = useArmedConfirm(() => {
    if (!method) return;
    setError(null);
    setMethod(method);
    void merge
      .mutateAsync({ ...refOf(detail), method, expectedHeadOid: detail.headOid })
      .catch((cause: unknown) => setError(sourceControlErrorMessage(cause)));
  });

  if (detail.state === "merged" || detail.state === "closed") {
    return (
      <div
        role="status"
        className="flex items-center gap-2 rounded-lg border border-border/70 px-3 py-2.5 text-sm"
      >
        {detail.state === "merged" ? (
          <GitMerge className="size-4 text-info" aria-hidden="true" />
        ) : (
          <CircleX className="size-4 text-destructive" aria-hidden="true" />
        )}
        {detail.state === "merged"
          ? `Merged${detail.mergedAt ? ` ${formatPullRequestTime(detail.mergedAt)}` : ""}`
          : "Closed without merging"}
      </div>
    );
  }

  const label = method ? MERGE_METHOD_LABEL[method] : "Merge";
  const disabled = Boolean(availability.blocked) || !method || merge.isPending;
  return (
    <section
      aria-label="Merge"
      className="flex flex-col gap-2 rounded-lg border border-border/70 p-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        {detail.mergeMethods.length > 1 ? (
          <Select
            value={method ?? undefined}
            onValueChange={(next) => {
              if (next) setMethod(next as PullRequestMergeMethod);
            }}
          >
            <SelectTrigger aria-label="Merge method" className="h-7 min-w-44">
              <SelectValue>{label}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {detail.mergeMethods.map((candidate) => (
                <SelectItem key={candidate} value={candidate}>
                  {MERGE_METHOD_LABEL[candidate]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
        <Button
          type="button"
          size="sm"
          disabled={disabled}
          aria-describedby={availability.blocked ? "pull-request-merge-reason" : undefined}
          {...confirm.buttonProps}
        >
          {merge.isPending ? (
            <LoaderCircle data-icon="inline-start" className="animate-spin" aria-hidden="true" />
          ) : (
            <GitMerge data-icon="inline-start" aria-hidden="true" />
          )}
          {confirm.armed ? `Confirm ${label.toLowerCase()}` : label}
        </Button>
      </div>
      {availability.blocked ? (
        <p id="pull-request-merge-reason" className="text-meta text-muted-foreground">
          {availability.blocked}
        </p>
      ) : null}
      {availability.warning ? (
        <p className="flex items-start gap-1.5 text-meta text-warning">
          <CircleAlert className="mt-px size-3 shrink-0" aria-hidden="true" />
          {availability.warning}
        </p>
      ) : null}
      {detail.autoMerge ? (
        <p className="text-meta text-muted-foreground">
          Auto-merge is on ({MERGE_METHOD_LABEL[detail.autoMerge.method].toLowerCase()}). The host
          merges once every requirement passes.
        </p>
      ) : null}
      <PullRequestBranchActions detail={detail} method={method} />
      {error ? (
        <p role="alert" className="flex items-start gap-1.5 text-meta text-destructive">
          <CircleAlert className="mt-px size-3 shrink-0" aria-hidden="true" />
          {error}
        </p>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------------------------

const CHECK_GROUP_LABEL: Record<CheckGroup, string> = {
  failing: "Failing",
  pending: "Running",
  passing: "Passing",
};

function ChecksSection({ detail }: { detail: PullRequestDetail }) {
  const groups = useMemo(() => groupChecks(detail.checkRuns), [detail.checkRuns]);
  const order: CheckGroup[] = ["failing", "pending", "passing"];
  const summary = order
    .filter((group) => groups[group].length)
    .map((group) => `${groups[group].length} ${CHECK_GROUP_LABEL[group].toLowerCase()}`)
    .join(", ");
  return (
    <SummarySection
      title="Checks"
      aside={summary ? <span className="text-meta text-muted-foreground">{summary}</span> : null}
    >
      {detail.checkRuns.length === 0 ? (
        <p className="text-sm text-muted-foreground">No checks reported.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {order.map((group) =>
            groups[group].length ? (
              <ul
                key={group}
                aria-label={`${CHECK_GROUP_LABEL[group]} checks`}
                className="flex flex-col"
              >
                {groups[group].map((check) => (
                  <CheckRow
                    key={`${check.workflow ?? ""}/${check.name}`}
                    check={check}
                    group={group}
                  />
                ))}
              </ul>
            ) : null,
          )}
        </div>
      )}
      {!detail.checksComplete ? (
        <p className="mt-2 text-meta text-muted-foreground">
          This list is incomplete. Open the request on its code host for the rest.
        </p>
      ) : null}
    </SummarySection>
  );
}

function CheckRow({ check, group }: { check: PullRequestCheck; group: CheckGroup }) {
  const duration = checkDuration(check);
  return (
    <li className="flex min-h-7 min-w-0 items-center gap-2 text-meta">
      {group === "failing" ? (
        <CircleX className="size-3.5 shrink-0 text-destructive" aria-hidden="true" />
      ) : group === "pending" ? (
        <LoaderCircle className="size-3.5 shrink-0 animate-spin text-warning" aria-hidden="true" />
      ) : (
        <CircleCheck className="size-3.5 shrink-0 text-success" aria-hidden="true" />
      )}
      <span className="min-w-0 flex-1 truncate">
        <span className="text-foreground">{check.name}</span>
        {check.workflow ? <span className="text-muted-foreground"> · {check.workflow}</span> : null}
      </span>
      {check.required ? (
        <Badge variant="outline" className="h-4 px-1.5">
          Required
        </Badge>
      ) : null}
      <span className="shrink-0 text-muted-foreground tabular-nums">
        {checkStatusLabel(check)}
        {duration ? ` · ${duration}` : ""}
      </span>
      {check.url ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={`Open ${check.name} details`}
          onClick={() => void palot.openExternalUrl(check.url!)}
        >
          <ExternalLink aria-hidden="true" />
        </Button>
      ) : (
        <span className="size-5 shrink-0" aria-hidden="true" />
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------------------------
// Reviewers
// ---------------------------------------------------------------------------------------------

const REVIEWER_TONE: Record<PullRequestDetail["reviewers"][number]["state"], string> = {
  requested: "text-muted-foreground",
  approved: "text-success",
  "changes-requested": "text-destructive",
  commented: "text-muted-foreground",
  dismissed: "text-muted-foreground line-through",
};

function ReviewersSection({
  detail,
  knownLogins,
}: {
  detail: PullRequestDetail;
  knownLogins: readonly string[];
}) {
  const open = detail.state === "open" || detail.state === "draft";
  return (
    <SummarySection
      title="Reviewers"
      aside={
        open && detail.viewer.canUpdate && detail.capabilities?.reviewers !== false ? (
          <ReviewerPicker detail={detail} knownLogins={knownLogins} />
        ) : null
      }
    >
      {detail.reviewers.length === 0 ? (
        <p className="text-sm text-muted-foreground">No reviewers yet.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {detail.reviewers.map((reviewer) => (
            <li key={reviewer.name} className="flex min-h-6 min-w-0 items-center gap-2 text-meta">
              <PullRequestPersonLabel
                person={reviewer.person}
                login={reviewer.name}
                className="min-w-0 flex-1"
              />
              <span className={cn("shrink-0", REVIEWER_TONE[reviewer.state])}>
                {REVIEWER_STATE_LABEL[reviewer.state]}
              </span>
            </li>
          ))}
        </ul>
      )}
    </SummarySection>
  );
}

function parseLogins(value: string): string[] {
  return value
    .split(/[\s,]+/)
    .map((login) => login.trim().replace(/^@/, ""))
    .filter(Boolean);
}

function ReviewerPicker({
  detail,
  knownLogins,
}: {
  detail: PullRequestDetail;
  knownLogins: readonly string[];
}) {
  const request = useRequestPullRequestReviewers();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [chosen, setChosen] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const existing = new Set(detail.reviewers.map((reviewer) => reviewer.name.toLowerCase()));
  const author = (detail.authorPerson?.login ?? detail.author ?? "").toLowerCase();
  const query = draft.trim().replace(/^@/, "").toLowerCase();
  const suggestions = [
    ...new Set([...detail.assignees.map((assignee) => assignee.login), ...knownLogins]),
  ]
    .filter((login) => {
      const lower = login.toLowerCase();
      return (
        lower !== author &&
        !existing.has(lower) &&
        !chosen.some((candidate) => candidate.toLowerCase() === lower) &&
        (!query || lower.includes(query))
      );
    })
    .slice(0, 6);
  const add = (logins: string[]) => {
    setChosen((current) => [
      ...current,
      ...logins.filter(
        (login) => !current.some((candidate) => candidate.toLowerCase() === login.toLowerCase()),
      ),
    ]);
    setDraft("");
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const reviewers = [...chosen, ...parseLogins(draft)];
    if (reviewers.length === 0) return;
    setError(null);
    void request
      .mutateAsync({ ...refOf(detail), reviewers })
      .then(() => {
        setChosen([]);
        setDraft("");
        setOpen(false);
      })
      .catch((cause: unknown) => setError(sourceControlErrorMessage(cause)));
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button type="button" variant="ghost" size="sm" className="text-muted-foreground" />
        }
      >
        <UserPlus data-icon="inline-start" aria-hidden="true" />
        Request reviewers
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 gap-2 p-2.5" aria-label="Request reviewers">
        <form className="flex flex-col gap-2" onSubmit={submit}>
          {chosen.length ? (
            <div className="flex flex-wrap gap-1">
              {chosen.map((login) => (
                <span
                  key={login}
                  className="inline-flex h-5 items-center gap-1 rounded-full bg-muted pr-1 pl-2 text-tag"
                >
                  {login}
                  <button
                    type="button"
                    aria-label={`Remove ${login}`}
                    className="rounded-full text-muted-foreground hover:text-foreground"
                    onClick={() =>
                      setChosen((current) => current.filter((candidate) => candidate !== login))
                    }
                  >
                    <X className="size-3" aria-hidden="true" />
                  </button>
                </span>
              ))}
            </div>
          ) : null}
          <Input
            autoFocus
            aria-label="Reviewer login or team"
            placeholder="login or org/team"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if ((event.key === "," || event.key === " ") && draft.trim()) {
                event.preventDefault();
                add(parseLogins(draft));
              }
            }}
          />
          {suggestions.length ? (
            <ul aria-label="Suggestions" className="flex flex-col">
              {suggestions.map((login) => (
                <li key={login}>
                  <button
                    type="button"
                    className="flex w-full items-center rounded-md px-1.5 py-1 text-left text-meta outline-none hover:bg-(--control-hover) focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => add([login])}
                  >
                    <PullRequestPersonLabel login={login} />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {error ? (
            <p role="alert" className="text-meta text-destructive">
              {error}
            </p>
          ) : null}
          <Button
            type="submit"
            size="sm"
            className="self-end"
            disabled={request.isPending || (chosen.length === 0 && !draft.trim())}
          >
            {request.isPending ? (
              <LoaderCircle data-icon="inline-start" className="animate-spin" aria-hidden="true" />
            ) : null}
            Request
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}
