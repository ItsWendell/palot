import { QueryClientContext } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import { useContext, type ReactNode } from "react";
import { runtimeAtom } from "../atoms/workspace";
import { useCatalogSession } from "../hooks/use-session-catalog";
import { useSessionActivityForSession } from "../hooks/use-session-activity";
import { useSessionFamilyRequestViews } from "../hooks/use-session-requests";
import { cn } from "../lib/cn";

interface TaskMentionChipProps {
  sessionID: string;
  connectionID?: string;
  onOpen(sessionID: string): void;
  children?: ReactNode;
}

export function TaskMentionChip(props: TaskMentionChipProps) {
  const client = useContext(QueryClientContext);
  const runtime = useAtomValue(runtimeAtom);
  // Detached/static Markdown still keeps the original, scoped session opener.
  return client && props.connectionID && props.connectionID === runtime?.connectionID ? (
    <LiveTaskMentionChip {...props} />
  ) : (
    <TaskChip {...props} />
  );
}

function LiveTaskMentionChip(props: TaskMentionChipProps) {
  const session = useCatalogSession(props.sessionID);
  const activity = useSessionActivityForSession(props.sessionID).data;
  const requests = useSessionFamilyRequestViews(props.sessionID);
  const running =
    activity.active ||
    activity.status?.type === "busy" ||
    activity.status?.type === "retry" ||
    [...activity.execution.values()].some((state) => state.status === "running");
  return (
    <TaskChip
      {...props}
      title={session?.title?.trim() || undefined}
      status={requests.length ? "Needs input" : running ? "Running" : "Idle"}
    />
  );
}

function TaskChip({
  sessionID,
  onOpen,
  children,
  title,
  status,
}: TaskMentionChipProps & {
  title?: string;
  status?: "Needs input" | "Running" | "Idle";
}) {
  return (
    <button
      type="button"
      data-palot-task-mention={sessionID}
      title={`${title ?? sessionID}${status ? ` · ${status}` : ""}\n${sessionID}`}
      className="inline-flex max-w-full cursor-pointer items-center gap-1.5 rounded-md border border-foreground/10 bg-background/45 px-1.5 align-baseline text-compact text-info outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
      onClick={() => onOpen(sessionID)}
    >
      {status ? (
        <span
          aria-label={status}
          className={cn(
            "size-1.5 shrink-0 rounded-full",
            status === "Needs input"
              ? "bg-warning"
              : status === "Running"
                ? "bg-info"
                : "bg-muted-foreground",
          )}
        />
      ) : null}
      <span className="min-w-0 truncate">{title ?? children ?? sessionID}</span>
    </button>
  );
}
