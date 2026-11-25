import { CircleCheck } from "lucide-react";
import { readinessText, type PullRequestReadiness } from "../../../shared/pull-request-readiness";
import { cn } from "../../lib/cn";

/** "Ready to merge" or what is still needed, for an open PR. Merged and closed PRs show none. */
export function ReadinessLine({
  readiness,
  className,
}: {
  readiness: PullRequestReadiness | null;
  className?: string;
}) {
  if (!readiness) return null;
  const ready = readiness.status === "ready";
  return (
    <p
      data-pull-request-readiness={readiness.status}
      className={cn(
        "flex min-w-0 items-start gap-1 text-meta",
        ready ? "text-success" : "text-muted-foreground",
        className,
      )}
    >
      {ready ? <CircleCheck className="mt-px size-3 shrink-0" aria-hidden="true" /> : null}
      <span className="min-w-0">{readinessText(readiness)}</span>
    </p>
  );
}
