import {
  changedFileKindLabel,
  describeQuietFiles,
  type ChangeSummary,
  type ChangedFileKind,
} from "../lib/changed-file-kind";
import { cn } from "../lib/cn";
import { Badge } from "./ui/badge";

/** "Lockfile", "Generated", "Migration" or "Test" beside a file name; nothing for a regular file. */
export function ChangedFileKindBadge({
  kind,
  className,
}: {
  kind: ChangedFileKind;
  className?: string;
}) {
  const label = changedFileKindLabel(kind);
  if (!label) return null;
  return (
    <Badge variant="neutral" size="sm" className={className} data-palot-file-kind={kind}>
      {label}
    </Badge>
  );
}

/**
 * A change's totals with lockfiles, generated files and migrations counted apart:
 * "3 files +40 −12 + 1 lockfile". Shows plain totals when there is nothing to split.
 */
export function ChangeSummaryCounts({
  summary,
  showFileCount = true,
  className,
}: {
  summary: ChangeSummary;
  showFileCount?: boolean;
  className?: string;
}) {
  const { main, quiet } = summary;
  const split = main.files > 0 && quiet.files > 0;
  const shown = split
    ? main
    : {
        files: main.files + quiet.files,
        additions: main.additions + quiet.additions,
        deletions: main.deletions + quiet.deletions,
      };
  return (
    <span
      className={cn("flex shrink-0 items-center gap-2 font-mono text-diff tabular-nums", className)}
    >
      {showFileCount ? (
        <span className="text-muted-foreground">
          {shown.files} {shown.files === 1 ? "file" : "files"}
        </span>
      ) : null}
      <span className="text-success">+{shown.additions}</span>
      <span className="text-destructive">-{shown.deletions}</span>
      {split ? <QuietChangesNote summary={summary} /> : null}
    </span>
  );
}

/** "+ 1 lockfile, 2 generated", with their line counts in the tooltip and accessible name. */
export function QuietChangesNote({
  summary,
  className,
}: {
  summary: ChangeSummary;
  className?: string;
}) {
  const { quiet } = summary;
  if (quiet.files === 0) return null;
  const description = describeQuietFiles(quiet.kinds);
  const detail = `${description}: +${quiet.additions} −${quiet.deletions}`;
  return (
    <span
      className={cn("truncate font-sans text-muted-foreground", className)}
      title={detail}
      data-palot-quiet-changes=""
    >
      + {description}
      <span className="sr-only">
        {" "}
        (+{quiet.additions} −{quiet.deletions})
      </span>
    </span>
  );
}
