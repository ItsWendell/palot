import type { FileDiffInfo } from "@opencode/client";
import { FileDiff, RefreshCw } from "lucide-react";
import { memo, useEffect, useMemo, useState, type ReactNode } from "react";
import { useTurnDiffs } from "../../hooks/use-turn-diffs";
import {
  classifyChangedFile,
  describeQuietFiles,
  isQuietKind,
  orderQuietLast,
  summarizeChanges,
  type ChangedFileKind,
} from "../../lib/changed-file-kind";
import { cn } from "../../lib/cn";
import { ChangedFileKindBadge } from "../changed-file-kind";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";

const VISIBLE_FILES = 5;
/** The card needs counts, not full files, so a few lines of hunk context keep responses small. */
const DIFF_CONTEXT = 3;

/**
 * Lists the files one turn changed. Names come from the steps' snapshot data and show at once;
 * counts load from OpenCode's turn diff once the card is near the viewport.
 */
export const TurnChangedFiles = memo(function TurnChangedFiles({
  profileID,
  sessionID,
  userMessageID,
  files,
  onOpenDiff,
  actions,
}: {
  profileID: string;
  sessionID: string;
  /** Any user message of the turn; OpenCode resolves it to the whole turn. */
  userMessageID: string;
  files: readonly string[];
  /** Opens the turn's diff, at `file` when one was chosen. */
  onOpenDiff(file?: string): void;
  /** Host controls after "Review changes", such as the latest turn's follow-ups. */
  actions?: ReactNode;
}) {
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const nearVisible = useNearVisible(root);
  const query = useTurnDiffs(profileID, sessionID, userMessageID, nearVisible, DIFF_CONTEXT);
  const [expanded, setExpanded] = useState(false);

  const diffs = query.available ? query.data : undefined;
  const byFile = useMemo(() => new Map(diffs?.map((diff) => [diff.file, diff])), [diffs]);
  const { shown, kinds } = useMemo(() => {
    const listed = new Set(files);
    // Snapshot data can lag behind live steps; files only the diff knows still belong here.
    const all = [
      ...files,
      ...(diffs ?? []).map((diff) => diff.file).filter((file) => !listed.has(file)),
    ];
    const byPath = new Map(all.map((file) => [file, classifyChangedFile(file)]));
    // Lockfiles, generated files and migrations follow the files the turn is about.
    return { shown: orderQuietLast(all, (file) => byPath.get(file)!), kinds: byPath };
  }, [diffs, files]);
  const summary = useMemo(
    () =>
      diffs?.length
        ? summarizeChanges(
            diffs.map((diff) => ({
              kind: kinds.get(diff.file) ?? "regular",
              additions: diff.additions,
              deletions: diff.deletions,
            })),
          )
        : null,
    [diffs, kinds],
  );
  // Name only the files the turn is about; the quiet ones get their own note.
  const mainFiles = useMemo(
    () => shown.filter((file) => !isQuietKind(kinds.get(file) ?? "regular")),
    [kinds, shown],
  );
  const quietKinds = useMemo(
    () =>
      summarizeChanges(
        shown.map((file) => ({ kind: kinds.get(file) ?? "regular", additions: 0, deletions: 0 })),
      ).quiet.kinds,
    [kinds, shown],
  );

  if (shown.length === 0) {
    // Keep an anchor so a turn without snapshot data can still learn its files from the diff.
    const settled = !query.available || query.isError || query.isSuccess;
    return settled ? null : <div ref={setRoot} aria-hidden="true" />;
  }

  const unavailable = query.available && (query.isError || (query.isSuccess && !diffs?.length));
  const visible = expanded ? shown : shown.slice(0, VISIBLE_FILES);
  const hidden = shown.length - VISIBLE_FILES;
  const split = mainFiles.length > 0 && mainFiles.length < shown.length;
  const named = split ? mainFiles : shown;
  const only = named.length === 1 ? named[0] : undefined;
  const totals = summary
    ? split
      ? summary.main
      : {
          additions: summary.main.additions + summary.quiet.additions,
          deletions: summary.main.deletions + summary.quiet.deletions,
        }
    : null;

  return (
    <div
      ref={setRoot}
      role="group"
      aria-label="Files changed in this turn"
      data-palot-turn-changed-files={userMessageID}
      className="mt-3 max-w-full rounded-md border border-border/60 bg-muted/15 text-meta text-muted-foreground"
    >
      <div className="flex flex-wrap items-center gap-x-1 gap-y-0.5 py-0.5 pr-0.5 pl-2">
        <span className="flex min-w-0 flex-1 items-center gap-1.5 pr-1 tabular-nums">
          <FileDiff className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate" title={only}>
            {only ? (
              <>
                Changed <span className="text-foreground">{baseName(only)}</span>
              </>
            ) : (
              `${named.length} files changed`
            )}
          </span>
          {totals ? <Counts additions={totals.additions} deletions={totals.deletions} /> : null}
          {split ? (
            <span
              className="min-w-0 truncate"
              title={
                summary ? `+${summary.quiet.additions} −${summary.quiet.deletions}` : undefined
              }
              data-palot-quiet-changes=""
            >
              + {describeQuietFiles(quietKinds)}
            </span>
          ) : null}
          {unavailable ? <span className="shrink-0">Diff unavailable</span> : null}
        </span>
        {unavailable ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-meta"
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
          >
            <RefreshCw data-icon="inline-start" aria-hidden="true" />
            Retry
          </Button>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-meta"
          onClick={() => onOpenDiff()}
        >
          Review changes
        </Button>
        {actions}
      </div>
      <ul className="flex flex-col border-t border-border/60 p-0.5">
        {visible.map((file) => (
          <li key={file}>
            <FileRow
              file={file}
              kind={kinds.get(file) ?? "regular"}
              diff={byFile.get(file)}
              onOpen={() => onOpenDiff(file)}
            />
          </li>
        ))}
      </ul>
      {hidden > 0 ? (
        <div className="px-0.5 pb-0.5">
          <Button
            type="button"
            variant="ghost"
            size="xs"
            aria-expanded={expanded}
            onClick={() => setExpanded((current) => !current)}
          >
            {expanded ? "Show fewer" : `Show ${hidden} more`}
          </Button>
        </div>
      ) : null}
    </div>
  );
});

function FileRow({
  file,
  kind,
  diff,
  onOpen,
}: {
  file: string;
  kind: ChangedFileKind;
  diff: FileDiffInfo | undefined;
  onOpen(): void;
}) {
  const quiet = isQuietKind(kind);
  const directory = directoryName(file);
  const status =
    diff?.status === "added" ? "Added" : diff?.status === "deleted" ? "Deleted" : undefined;
  const label = [
    file,
    quiet ? kind : undefined,
    status?.toLowerCase(),
    diff ? `+${diff.additions} −${diff.deletions}` : undefined,
  ]
    .filter(Boolean)
    .join(", ");
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      aria-label={label}
      title={file}
      className={cn("w-full justify-start text-meta font-normal", quiet && "opacity-75")}
      data-palot-quiet-file={quiet ? kind : undefined}
      onClick={onOpen}
    >
      <span className="min-w-0 shrink truncate text-foreground">{baseName(file)}</span>
      {directory ? (
        <span className="min-w-0 flex-1 truncate text-left text-muted-foreground">{directory}</span>
      ) : (
        <span className="flex-1" />
      )}
      {quiet ? <ChangedFileKindBadge kind={kind} /> : null}
      {status ? (
        <Badge variant={status === "Added" ? "success" : "destructive"} size="sm">
          {status}
        </Badge>
      ) : null}
      {diff ? <Counts additions={diff.additions} deletions={diff.deletions} /> : null}
    </Button>
  );
}

function Counts({ additions, deletions }: { additions: number; deletions: number }) {
  return (
    <span className="flex shrink-0 items-center gap-1 tabular-nums">
      <span className="text-success">+{additions}</span>
      <span className="text-destructive">−{deletions}</span>
    </span>
  );
}

function baseName(file: string) {
  return file.slice(file.lastIndexOf("/") + 1) || file;
}

function directoryName(file: string) {
  const slash = file.lastIndexOf("/");
  return slash > 0 ? file.slice(0, slash) : "";
}

/** True once the element has come within a screen of the viewport; it never turns false. */
function useNearVisible(element: Element | null): boolean {
  const [nearVisible, setNearVisible] = useState(() => typeof IntersectionObserver === "undefined");
  useEffect(() => {
    if (nearVisible || !element) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        setNearVisible(true);
        observer.disconnect();
      },
      { rootMargin: "600px 0px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [element, nearVisible]);
  return nearVisible;
}
