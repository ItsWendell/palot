import { Eye, TriangleAlert } from "lucide-react";
import { memo, type MouseEvent } from "react";
import type { PullRequestLink } from "../../../shared/source-control-contract";
import { cn } from "../../lib/cn";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import {
  CHECKS_DOT,
  CHECKS_LABEL,
  describePullRequest,
  primaryPullRequestLink,
  PULL_REQUEST_STATE_ICON,
  PULL_REQUEST_STATE_LABEL,
  PULL_REQUEST_STATE_TEXT,
  REVIEW_LABEL,
  samePullRequestLinks,
} from "./pull-request-presentation";

/**
 * Compact pull request marker for task rows: state glyph and `#N`, a checks dot, a
 * conflict marker, and an eye while Palot watches it. Rows pass their own links from
 * one batched per-list query; with no links it renders nothing, so rows without a PR
 * never reserve space.
 */
export const PullRequestBadge = memo(
  function PullRequestBadge({
    links,
    className,
    onActivate,
  }: {
    links: readonly PullRequestLink[] | undefined;
    className?: string;
    /**
     * For rows whose content layer ignores the pointer (inbox cards): the badge takes
     * the pointer for its tooltip, so a click must still open the task.
     */
    onActivate?(): void;
  }) {
    const primary = links ? primaryPullRequestLink(links) : undefined;
    if (!links || !primary) return null;
    const { pullRequest } = primary;
    const Icon = PULL_REQUEST_STATE_ICON[pullRequest.state];
    const others = links.length - 1;
    const summary =
      describePullRequest(primary) + (others > 0 ? `, and ${others} more linked` : "");
    return (
      <Tooltip>
        <TooltipTrigger
          render={
            <span
              role="img"
              aria-label={summary}
              data-pull-request-badge={pullRequest.state}
              data-checks={pullRequest.checks}
              data-watching={primary.watch ? "" : undefined}
              onClick={
                onActivate
                  ? (event: MouseEvent) => {
                      event.stopPropagation();
                      onActivate();
                    }
                  : undefined
              }
              className={cn(
                "inline-flex h-4 shrink-0 items-center gap-0.5 rounded-sm text-micro leading-none text-sidebar-foreground/65 tabular-nums",
                onActivate && "pointer-events-auto cursor-pointer",
                className,
              )}
            />
          }
        >
          <Icon
            className={cn("size-3! shrink-0", PULL_REQUEST_STATE_TEXT[pullRequest.state])}
            aria-hidden="true"
          />
          <span aria-hidden="true">#{pullRequest.number}</span>
          {others > 0 ? <span aria-hidden="true">+{others}</span> : null}
          {pullRequest.checks !== "none" ? (
            <span
              className={cn(
                "ml-0.5 size-1.5 shrink-0 rounded-full",
                CHECKS_DOT[pullRequest.checks],
              )}
              aria-hidden="true"
            />
          ) : null}
          {pullRequest.mergeable === "conflicting" ? (
            <TriangleAlert className="size-2.5! shrink-0 text-warning" aria-hidden="true" />
          ) : null}
          {primary.watch ? <Eye className="size-2.5! shrink-0" aria-hidden="true" /> : null}
        </TooltipTrigger>
        <TooltipContent className="max-w-80 flex-col items-start gap-1.5 px-2.5 py-2 leading-tight">
          {links.slice(0, 3).map((link) => (
            <PullRequestTooltipEntry key={link.key} link={link} />
          ))}
          {links.length > 3 ? (
            <span className="text-muted-foreground">+{links.length - 3} more</span>
          ) : null}
        </TooltipContent>
      </Tooltip>
    );
  },
  (previous, next) =>
    samePullRequestLinks(previous.links, next.links) &&
    previous.className === next.className &&
    previous.onActivate === next.onActivate,
);

function PullRequestTooltipEntry({ link }: { link: PullRequestLink }) {
  const { pullRequest } = link;
  const facts = [
    PULL_REQUEST_STATE_LABEL[pullRequest.state],
    pullRequest.checks === "none" ? null : CHECKS_LABEL[pullRequest.checks],
    pullRequest.reviewDecision ? REVIEW_LABEL[pullRequest.reviewDecision] : null,
    pullRequest.mergeable === "conflicting" ? "Conflicts" : null,
    link.watch ? "Watching" : null,
  ].filter(Boolean);
  return (
    <span className="flex min-w-0 flex-col gap-0.5">
      <span className="line-clamp-2 font-medium">
        #{pullRequest.number} {pullRequest.title}
      </span>
      <span className="text-muted-foreground">{facts.join(" · ")}</span>
    </span>
  );
}
