/** Stack of undelivered composer inputs, mirrored from OpenCode's session inbox. */

import { useAtom, useAtomValue } from "jotai";
import {
  ChevronRight,
  CircleAlert,
  Clock3,
  Paperclip,
  Pause,
  Pencil,
  RotateCcw,
  Trash2,
  Zap,
} from "lucide-react";
import { memo, useEffect, useId, useRef, useState, type ReactElement } from "react";
import type { PalotFileAttachment } from "../../shared";
import { attentionTargetAtom } from "../atoms/attention";
import { runtimeAtom } from "../atoms/workspace";
import { useOpenCodeRecords } from "../hooks/use-open-code-records";
import { cn } from "../lib/cn";
import {
  clearComposerQueue,
  composerQueueErrorMessage,
  composerQueuePauseMessage,
  composerQueuePreview,
  resumeComposerQueue,
  type ComposerQueueAction,
  type ComposerQueueItemState,
} from "../lib/composer-queue";
import type { PendingRequestView } from "../lib/view-models";
import { palot } from "../services/palot";
import { Button } from "./ui/button";
import { Spinner } from "./ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

/** Past this many inputs the stack collapses to a count. */
const EXPANDED_LIMIT = 2;
const CLEAR_CONFIRM_MS = 3_000;
const EMPTY_FILES = new Map<string, PalotFileAttachment[] | undefined>();

const FAILURE_FALLBACK: Record<ComposerQueueAction, string> = {
  steer: "Could not send the message.",
  queue: "Could not move the message to the queue.",
  edit: "Could not edit the message.",
  delete: "Could not delete the message.",
};

export interface ComposerQueueProps {
  sessionID: string;
  /** Undelivered inputs in OpenCode inbox order. */
  requests: PendingRequestView[];
  filesByID?: ReadonlyMap<string, PalotFileAttachment[] | undefined>;
  /** A turn is running or a submission is in flight, so the queue is not paused. */
  working: boolean;
  editDisabled?: boolean;
  onEdit?(request: PendingRequestView): Promise<void> | void;
  /** Defaults to cancelling the inbox item. */
  onDelete?(request: PendingRequestView): Promise<void> | void;
  onSteered?(request: PendingRequestView): void;
}

export function ComposerQueue({
  sessionID,
  requests,
  filesByID = EMPTY_FILES,
  working,
  editDisabled = false,
  onEdit,
  onDelete,
  onSteered,
}: ComposerQueueProps) {
  const listID = useId();
  const [expanded, setExpanded] = useState(false);
  const [states, setStates] = useState<Record<string, ComposerQueueItemState>>({});
  const inFlight = useRef(new Set<string>());
  const attentionTarget = useAtomValue(attentionTargetAtom);
  const collapsible = requests.length > EXPANDED_LIMIT;
  const targeted =
    attentionTarget?.sessionID === sessionID &&
    attentionTarget.type === "input" &&
    requests.some((request) => request.id === attentionTarget.requestID);
  // A focus request for a hidden input opens the list and keeps it open.
  if (collapsible && targeted && !expanded) setExpanded(true);
  const listVisible = !collapsible || expanded || targeted;
  const paused = !working && requests.length > 0;
  const queuedCount = requests.filter((request) => request.delivery === "queue").length;

  if (requests.length === 0) return null;

  function setState(id: string, state: ComposerQueueItemState | null) {
    setStates((current) => {
      if (!state) {
        if (!(id in current)) return current;
        const { [id]: _removed, ...rest } = current;
        return rest;
      }
      return { ...current, [id]: state };
    });
  }

  async function run(request: PendingRequestView, action: ComposerQueueAction) {
    if (inFlight.current.has(request.id)) return;
    inFlight.current.add(request.id);
    setState(request.id, { phase: "sending", action });
    try {
      if (action === "edit") await onEdit?.(request);
      else if (action === "delete") {
        if (onDelete) await onDelete(request);
        else await palot.updatePending({ sessionID, inputID: request.id, action: "cancel" });
      } else {
        await palot.updatePending({ sessionID, inputID: request.id, action });
        if (action === "steer") onSteered?.(request);
      }
      setState(request.id, null);
    } catch (error) {
      setState(request.id, {
        phase: "failed",
        action,
        error: composerQueueErrorMessage(error, FAILURE_FALLBACK[action]),
      });
    } finally {
      inFlight.current.delete(request.id);
    }
  }

  function markFailed(ids: readonly string[]) {
    setStates((current) => {
      const next = { ...current };
      for (const id of ids) {
        next[id] = { phase: "failed", action: "delete", error: FAILURE_FALLBACK.delete };
      }
      return next;
    });
  }

  return (
    <section
      aria-label="Pending messages"
      className="relative mx-2 -mb-4 min-w-0 rounded-t-2xl border border-b-0 border-foreground/10 bg-muted px-1 pt-1 pb-4"
    >
      {paused ? (
        <PausedQueueRow sessionID={sessionID} requests={requests} onClearFailed={markFailed} />
      ) : null}
      {collapsible ? (
        <button
          type="button"
          className="flex min-h-7 w-full min-w-0 items-center gap-1.5 rounded-lg px-2 text-left text-meta font-medium text-muted-foreground hover:bg-foreground/4 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
          aria-expanded={listVisible}
          aria-controls={listID}
          onClick={() => setExpanded(!listVisible)}
        >
          <ChevronRight
            className={cn("size-3 shrink-0 transition-transform", listVisible && "rotate-90")}
            aria-hidden="true"
          />
          {queuedCount === requests.length
            ? `${requests.length} queued`
            : `${requests.length} pending`}
        </button>
      ) : null}
      {listVisible ? (
        <div
          id={listID}
          className="palot-native-scrollbar flex max-h-[min(9rem,20cqh)] min-w-0 flex-col overflow-x-hidden overflow-y-auto overscroll-contain"
        >
          {requests.map((request, index) => (
            <ComposerQueueItem
              key={request.id}
              sessionID={sessionID}
              request={request}
              files={filesByID.get(request.id)}
              working={working}
              state={states[request.id]}
              editDisabled={editDisabled || !onEdit}
              queuedPosition={
                request.delivery === "queue"
                  ? requests
                      .slice(0, index + 1)
                      .filter((candidate) => candidate.delivery === "queue").length
                  : undefined
              }
              queuedCount={queuedCount}
              onAction={run}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function PausedQueueRow({
  sessionID,
  requests,
  onClearFailed,
}: {
  sessionID: string;
  requests: PendingRequestView[];
  onClearFailed(ids: readonly string[]): void;
}) {
  const runtime = useAtomValue(runtimeAtom);
  const execution = useOpenCodeRecords(
    runtime?.connectionID ?? "disconnected",
    "session-runtime",
    sessionID,
  )[0]?.value.execution?.status;
  const [busy, setBusy] = useState<"resume" | "clear" | null>(null);
  const [armed, setArmed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!armed) return;
    const timeout = window.setTimeout(() => setArmed(false), CLEAR_CONFIRM_MS);
    return () => window.clearTimeout(timeout);
  }, [armed]);

  async function resume() {
    setBusy("resume");
    setError(null);
    try {
      await resumeComposerQueue(sessionID, requests);
    } catch (cause) {
      setError(`Could not resume: ${composerQueueErrorMessage(cause, "OpenCode refused.")}`);
    } finally {
      setBusy(null);
    }
  }

  async function clear() {
    if (!armed) {
      setArmed(true);
      return;
    }
    setArmed(false);
    setBusy("clear");
    setError(null);
    try {
      const failed = await clearComposerQueue(sessionID, requests);
      if (failed.length > 0) onClearFailed(failed);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div
      role="group"
      aria-label="Paused queue"
      className="flex min-h-8 min-w-0 items-center gap-2 px-2 text-meta leading-none text-muted-foreground"
      data-palot-queue-paused={execution ?? "idle"}
    >
      <Pause className="size-3 shrink-0" aria-hidden="true" />
      <span role="status" className="min-w-0 flex-1 truncate font-medium text-foreground/75">
        {error ?? composerQueuePauseMessage(execution)}
      </span>
      <QueueTooltip label="Send the next message and continue the queue. Sending a new message also resumes it.">
        <Button
          type="button"
          variant="ghost"
          size="context"
          disabled={busy !== null}
          onClick={() => void resume()}
        >
          {busy === "resume" ? <Spinner aria-hidden="true" /> : null}
          Resume
        </Button>
      </QueueTooltip>
      <Button
        type="button"
        variant="ghost"
        size="context"
        className={cn(armed && "text-destructive hover:text-destructive")}
        aria-label={armed ? "Confirm clearing the queue" : "Clear queue"}
        disabled={busy !== null}
        onClick={() => void clear()}
        onBlur={() => setArmed(false)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && armed) {
            event.stopPropagation();
            setArmed(false);
          }
        }}
      >
        {busy === "clear" ? <Spinner aria-hidden="true" /> : null}
        {armed ? "Confirm clear" : "Clear"}
      </Button>
    </div>
  );
}

function QueueTooltip({ label, children }: { label: string; children: ReactElement }) {
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export const ComposerQueueItem = memo(function ComposerQueueItem({
  sessionID,
  request,
  files,
  working,
  state,
  editDisabled,
  queuedPosition,
  queuedCount,
  onAction,
}: {
  sessionID: string;
  request: PendingRequestView;
  files?: PalotFileAttachment[];
  working: boolean;
  state?: ComposerQueueItemState;
  editDisabled: boolean;
  queuedPosition?: number;
  queuedCount: number;
  onAction(request: PendingRequestView, action: ComposerQueueAction): void;
}) {
  const [attentionTarget, setAttentionTarget] = useAtom(attentionTargetAtom);
  const delivery = request.delivery ?? "steer";
  const preview = composerQueuePreview(request, files);
  const sending = state?.phase === "sending";
  const failed = state?.phase === "failed" ? state : null;
  const status = failed
    ? "Failed"
    : sending && state.action === "steer"
      ? "Sending"
      : delivery === "queue" && queuedCount > 1 && queuedPosition
        ? `Queued · ${queuedPosition}`
        : delivery === "queue"
          ? "Queued"
          : "Steering";

  useEffect(() => {
    if (
      attentionTarget?.sessionID !== sessionID ||
      attentionTarget.type !== "input" ||
      attentionTarget.requestID !== request.id
    ) {
      return;
    }
    const element = document.querySelector<HTMLElement>(
      `[data-palot-request-id="${CSS.escape(request.id)}"]`,
    );
    if (!element) return;
    element.scrollIntoView({ block: "nearest", behavior: "smooth" });
    element.querySelector<HTMLElement>("button")?.focus();
    setAttentionTarget(null);
  }, [attentionTarget, request.id, sessionID, setAttentionTarget]);

  return (
    <div
      className="flex min-h-8 min-w-0 items-center gap-2 rounded-lg px-2 text-meta leading-none text-muted-foreground hover:bg-foreground/4"
      role="region"
      data-palot-request-id={request.id}
      data-palot-queue-state={failed ? "failed" : sending ? "sending" : delivery}
      aria-label={`Pending message actions: ${preview.label}`}
      aria-busy={sending}
    >
      <span
        className={cn(
          "flex shrink-0 items-center gap-1 font-medium text-foreground/70",
          failed && "text-destructive",
        )}
      >
        {sending ? (
          <Spinner className="size-3" aria-hidden="true" />
        ) : failed ? (
          <CircleAlert className="size-3" aria-hidden="true" />
        ) : delivery === "queue" ? (
          <Clock3 className="size-3" aria-hidden="true" />
        ) : (
          <Zap className="size-3" aria-hidden="true" />
        )}
        {status}
      </span>
      <span className="min-w-0 flex-1 truncate" title={failed?.error ?? preview.label}>
        {preview.label}
        {failed ? <span className="sr-only">. {failed.error}</span> : null}
      </span>
      {preview.attachments > 0 ? (
        <span
          className="flex shrink-0 items-center gap-0.5 tabular-nums"
          aria-label={`${preview.attachments} ${preview.attachments === 1 ? "attachment" : "attachments"}`}
        >
          <Paperclip className="size-3" aria-hidden="true" />
          {preview.attachments}
        </span>
      ) : null}
      {failed ? (
        <QueueTooltip label={failed.error}>
          <Button
            type="button"
            variant="ghost"
            size="context"
            onClick={() => onAction(request, failed.action)}
          >
            <RotateCcw aria-hidden="true" />
            Retry
          </Button>
        </QueueTooltip>
      ) : delivery === "queue" ? (
        <QueueTooltip
          label={
            working
              ? "Send without waiting for the current turn"
              : "Send now, then continue the queue"
          }
        >
          <Button
            type="button"
            variant="ghost"
            size="context"
            disabled={sending}
            onClick={() => onAction(request, "steer")}
          >
            <Zap aria-hidden="true" />
            {working ? "Steer now" : "Send now"}
          </Button>
        </QueueTooltip>
      ) : working ? (
        <Button
          type="button"
          variant="ghost"
          size="context"
          aria-label="Run after current turn"
          disabled={sending}
          onClick={() => onAction(request, "queue")}
        >
          <Clock3 aria-hidden="true" />
          Queue
        </Button>
      ) : null}
      <QueueTooltip label="Edit in the composer">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Edit pending message"
          disabled={sending || editDisabled}
          onClick={() => onAction(request, "edit")}
        >
          <Pencil aria-hidden="true" />
        </Button>
      </QueueTooltip>
      <QueueTooltip label="Delete">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Delete pending message"
          disabled={sending}
          onClick={() => onAction(request, "delete")}
        >
          <Trash2 aria-hidden="true" />
        </Button>
      </QueueTooltip>
    </div>
  );
});
