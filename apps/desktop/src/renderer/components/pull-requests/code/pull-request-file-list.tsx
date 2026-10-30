import type { PullRequestFile } from "../../../../shared/source-control-contract";
import { cn } from "../../../lib/cn";
import { Checkbox } from "../../ui/checkbox";

const STATUS: Record<PullRequestFile["status"], { letter: string; label: string; tone: string }> = {
  added: { letter: "A", label: "Added", tone: "text-success" },
  modified: { letter: "M", label: "Modified", tone: "text-info" },
  changed: { letter: "M", label: "Changed", tone: "text-info" },
  removed: { letter: "D", label: "Deleted", tone: "text-destructive" },
  renamed: { letter: "R", label: "Renamed", tone: "text-info" },
  copied: { letter: "C", label: "Copied", tone: "text-info" },
};

export function fileStatusLabel(status: PullRequestFile["status"]) {
  return STATUS[status].label;
}

export function filePathParts(path: string): { directory: string; name: string } {
  const separator = path.lastIndexOf("/");
  return separator < 0
    ? { directory: "", name: path }
    : { directory: path.slice(0, separator), name: path.slice(separator + 1) };
}

/** Changed files in GitHub order with status, counts, and a viewed checkbox each. */
export function PullRequestFileList({
  files,
  activePath,
  onSelect,
  onViewedChange,
  viewedSupported = true,
}: {
  files: readonly PullRequestFile[];
  activePath: string | null;
  onSelect(path: string): void;
  onViewedChange(path: string, viewed: boolean): void;
  viewedSupported?: boolean;
}) {
  if (files.length === 0) {
    return (
      <p className="px-3 py-4 text-meta text-muted-foreground">Every file is marked viewed.</p>
    );
  }
  return (
    <ul aria-label="Changed files" className="flex flex-col py-1">
      {files.map((file) => {
        const status = STATUS[file.status];
        const { directory, name } = filePathParts(file.path);
        const viewed = file.viewed === "viewed";
        return (
          <li
            key={file.path}
            className={cn(
              "group/file flex h-7 items-center gap-1.5 px-2 text-tree hover:bg-muted/55",
              activePath === file.path && "bg-accent text-accent-foreground",
            )}
          >
            <Checkbox
              aria-label={`Viewed ${file.path}`}
              disabled={!viewedSupported}
              title={
                !viewedSupported
                  ? "Viewed marks are not supported for this host in Palot yet."
                  : undefined
              }
              checked={viewed}
              onCheckedChange={(checked) => onViewedChange(file.path, checked)}
            />
            <button
              type="button"
              className="flex min-w-0 flex-1 items-center gap-1.5 text-left outline-none focus-visible:underline"
              title={file.previousPath ? `${file.previousPath} → ${file.path}` : file.path}
              onClick={() => onSelect(file.path)}
            >
              <span
                className={cn("w-3 shrink-0 font-mono text-micro font-semibold", status.tone)}
                aria-label={status.label}
                title={status.label}
              >
                {status.letter}
              </span>
              <span className={cn("min-w-0 flex-1 truncate", viewed && "text-muted-foreground")}>
                <span className={cn(!viewed && "font-medium text-foreground")}>{name}</span>
                {directory ? (
                  <span className="ml-1 text-micro text-muted-foreground">{directory}</span>
                ) : null}
              </span>
              {file.viewed === "dismissed" ? <ChangedSinceViewed compact /> : null}
              <span className="flex shrink-0 items-center gap-1 font-mono text-micro tabular-nums">
                <span className="text-success">+{file.additions}</span>
                <span className="text-destructive">−{file.deletions}</span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** GitHub dropped the viewed mark because the file changed after it was viewed. */
export function ChangedSinceViewed({ compact = false }: { compact?: boolean }) {
  return (
    <span
      className="shrink-0 rounded-sm bg-warning/15 px-1 text-tag font-medium text-warning"
      title="This file changed since you marked it viewed"
    >
      {compact ? (
        <>
          Changed<span className="sr-only"> since viewed</span>
        </>
      ) : (
        "Changed since viewed"
      )}
    </span>
  );
}
