/**
 * Messages already written and not yet delivered, inside the composer card above the text.
 * They mirror OpenCode's session inbox; Palot only tracks the outcome of its own actions.
 * Each row's actions show while it is hovered or focused; the first queued row keeps Steer now
 * in view while a turn runs. A steer stuck behind foreground work offers to background it on
 * its row, and a message pulled back for editing shows as a row of its own.
 */

import { useAtom, useAtomValue } from "jotai";
import {
  ArrowUpToLine,
  CircleAlert,
  Clock3,
  LoaderCircle,
  Paperclip,
  Pause,
  Pencil,
  RotateCcw,
  SendToBack,
  Trash2,
  Zap,
} from "lucide-react";
import {
  memo,
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
  type Ref,
} from "react";
import type { PalotFileAttachment } from "../../shared";
import { attentionTargetAtom } from "../atoms/attention";
import { runtimeAtom } from "../atoms/workspace";
import { useOpenCodeRecords } from "../hooks/use-open-code-records";
import { cn } from "../lib/cn";
import { formatShortcut, useShortcutKeys } from "../lib/keyboard-shortcuts";
import {
  clearComposerQueue,
  composerQueueErrorMessage,
  composerQueuePauseMessage,
  composerQueuePreview,
  resumeComposerQueue,
  type ComposerQueueAction,
  type ComposerQueueItemState,
} from "../lib/composer-queue";
import {
  moveQueuedInputFirst,
  queueDisplayRows,
  type QueueDisplayRow,
} from "../lib/composer-queue-reorder";
import type { PendingRequestView } from "../lib/view-models";
import type { BackgroundWorkItem } from "./subagent-activity";
import { palot } from "../services/palot";
import { toast } from "./ui/toast";
import { Button } from "./ui/button";
import {
  ComposerQueue as ComposerQueueFrame,
  ComposerQueueRow,
  ComposerQueueRowActions,
  ComposerQueueRowStatus,
  ComposerQueueRowText,
  ComposerQueueSummary,
} from "./ui/composer";
import { Spinner } from "./ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

/** Past this many inputs the stack collapses to a count. */
const EXPANDED_LIMIT = 2;
const CLEAR_CONFIRM_MS = 3_000;
/** How long the moved order shows while OpenCode's inbox events catch up with a finished move. */
const MOVE_SETTLE_MS = 5_000;
const EMPTY_FILES = new Map<string, PalotFileAttachment[] | undefined>();

function newInputID(): string {
  return `msg_${crypto.randomUUID().replaceAll("-", "")}`;
}

const FAILURE_FALLBACK: Record<ComposerQueueAction, string> = {
  steer: "Could not send the message.",
  queue: "Could not move the message to the queue.",
  edit: "Could not edit the message.",
  delete: "Could not delete the message.",
};

export interface ComposerQueueHandle {
  /** Runs the first queued input's Steer now, unless that row is sending or failed. */
  steerFirst(): void;
  /**
   * Moves a queued input to the front of the queue. `send` is a message just queued with
   * Alt+Enter; a failure says it waits at the end instead. Moves run one at a time.
   */
  moveFirst(id: string, origin: "row" | "send"): Promise<void>;
}

/** A steer waiting behind foreground work, and the offer to move that work aside. */
export interface ComposerQueueBlocked {
  /** The waiting steer's input ID, or the time it was submitted while its ID is not known. */
  id: string;
  submittedAt: number;
  /** The foreground work it waits for. */
  items: readonly BackgroundWorkItem[];
  backgrounding: boolean;
  /** The last attempt failed. */
  retry: boolean;
  error: string | null;
  onBackground(): void;
}

/** A queued message pulled into the text field for editing; it leaves the inbox meanwhile. */
export interface ComposerQueueEditing {
  onDiscard(): void;
}

export interface ComposerQueueProps {
  ref?: Ref<ComposerQueueHandle>;
  sessionID: string;
  /** Undelivered inputs in OpenCode inbox order. */
  requests: PendingRequestView[];
  filesByID?: ReadonlyMap<string, PalotFileAttachment[] | undefined>;
  /** A turn is running or a submission is in flight, so the queue is not paused. */
  working: boolean;
  editDisabled?: boolean;
  /** The composer would steer the first queued input on its steer keys, so its row names them. */
  steerFirstShortcut?: boolean;
  /**
   * Copy ID → the message it stands for, written while a move admits copies. Shared with
   * `useSettledInputs` so a copy shows at once and its row keeps its place and key.
   */
  copies?: Map<string, string>;
  /** A queued input is being pulled into the composer, so nothing may move meanwhile. */
  moveDisabled?: boolean;
  blocked?: ComposerQueueBlocked | null;
  editing?: ComposerQueueEditing | null;
  onEdit?(request: PendingRequestView): Promise<void> | void;
  /** Defaults to cancelling the inbox item. */
  onDelete?(request: PendingRequestView): Promise<void> | void;
  onSteered?(request: PendingRequestView): void;
}

export function ComposerQueue({
  ref,
  sessionID,
  requests,
  filesByID = EMPTY_FILES,
  working,
  editDisabled = false,
  steerFirstShortcut = false,
  copies: sharedCopies,
  moveDisabled = false,
  blocked = null,
  editing = null,
  onEdit,
  onDelete,
  onSteered,
}: ComposerQueueProps) {
  const listID = useId();
  const [expanded, setExpanded] = useState(false);
  const [states, setStates] = useState<Record<string, ComposerQueueItemState>>({});
  const inFlight = useRef(new Set<string>());
  const [ownCopies] = useState(() => new Map<string, string>());
  const copies = sharedCopies ?? ownCopies;
  /** The order a move is heading for, by message key, until the inbox shows it. */
  const [order, setOrder] = useState<{ keys: string[]; done: boolean } | null>(null);
  const moveChain = useRef<Promise<void>>(Promise.resolve());
  const latestRequests = useRef(requests);
  latestRequests.current = requests;
  const natural = queueDisplayRows(requests, copies, null);
  const rows = order ? queueDisplayRows(requests, copies, order.keys) : natural;
  const moving = order !== null && !order.done;
  const settledOrder =
    order?.done === true &&
    rows.length === natural.length &&
    rows.every((row, index) => row.key === natural[index]!.key);
  useEffect(() => {
    if (!order?.done) return;
    if (settledOrder) {
      setOrder(null);
      return;
    }
    const timeout = window.setTimeout(() => setOrder(null), MOVE_SETTLE_MS);
    return () => window.clearTimeout(timeout);
  }, [order, settledOrder]);
  const attentionTarget = useAtomValue(attentionTargetAtom);
  const collapsible = requests.length > EXPANDED_LIMIT;
  const targeted =
    attentionTarget?.sessionID === sessionID &&
    attentionTarget.type === "input" &&
    requests.some((request) => request.id === attentionTarget.requestID);
  const blockedID = blocked
    ? (requests.find(
        (request) => request.id === blocked.id || request.createdAt === blocked.submittedAt,
      )?.id ?? null)
    : null;
  // A focus request for a hidden input opens the list and keeps it open.
  if (collapsible && targeted && !expanded) setExpanded(true);
  const listVisible = !collapsible || expanded || targeted || blockedID !== null;
  const paused = !working && requests.length > 0;
  const queuedCount = rows.filter((row) => row.request.delivery === "queue").length;
  const firstQueuedID = rows.find((row) => row.request.delivery === "queue")?.request.id;

  useImperativeHandle(ref, () => ({
    steerFirst() {
      const first = rows.find((row) => row.request.delivery === "queue")?.request;
      // A sending or failed row shows no Steer now, so the shortcut leaves it alone.
      if (!first || !working || moving || inFlight.current.has(first.id) || states[first.id])
        return;
      void run(first, "steer");
    },
    moveFirst: enqueueMove,
  }));

  function enqueueMove(id: string, origin: "row" | "send"): Promise<void> {
    const next = moveChain.current.then(() => move(id, origin));
    moveChain.current = next;
    return next;
  }

  /** Never rejects: a failure leaves every message queued and is reported in a toast. */
  async function move(id: string, origin: "row" | "send") {
    const key = copies.get(id) ?? id;
    const queued = queueDisplayRows(latestRequests.current, copies, null)
      .filter((row) => row.request.delivery === "queue")
      .map((row) => row.key);
    setOrder({ keys: [key, ...queued.filter((candidate) => candidate !== key)], done: false });
    try {
      const result = await moveQueuedInputFirst(
        {
          list: () => palot.loadSessionInbox(sessionID),
          admit: (copy, item) => palot.requeuePendingInput(sessionID, copy, item),
          cancel: (inputID) => palot.updatePending({ sessionID, inputID, action: "cancel" }),
          newID: newInputID,
        },
        id,
        {
          copied: (original, copy) => copies.set(copy, copies.get(original) ?? original),
          withdrawn: (copy) => copies.delete(copy),
        },
      );
      // Rows hold the moved order until the inbox events show it, so nothing jumps back.
      if (result === "unchanged") setOrder(null);
      else setOrder((current) => (current ? { ...current, done: true } : current));
    } catch (error) {
      setOrder(null);
      toast.add({
        type: "error",
        title:
          origin === "send" ? "Queued, but not first" : "Could not move the message to the top",
        description:
          origin === "send"
            ? `${composerQueueErrorMessage(error, "OpenCode refused.")} It waits at the end of the queue.`
            : composerQueueErrorMessage(error, "OpenCode refused."),
      });
    }
  }

  if (requests.length === 0 && !editing) return null;

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
    if (inFlight.current.has(request.id) || moving) return;
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

  const filesOf = (row: QueueDisplayRow) => filesByID.get(row.request.id) ?? filesByID.get(row.key);
  const next = rows[0] ? composerQueuePreview(rows[0].request, filesOf(rows[0])) : null;
  return (
    <ComposerQueueFrame aria-label="Pending messages">
      {paused ? (
        <PausedQueueRow sessionID={sessionID} requests={requests} onClearFailed={markFailed} />
      ) : null}
      {collapsible ? (
        <ComposerQueueSummary
          aria-expanded={listVisible}
          aria-controls={listID}
          onClick={() => setExpanded(!listVisible)}
        >
          <Clock3 aria-hidden="true" />
          <span className="shrink-0 font-medium text-foreground/80">
            {queuedCount === requests.length
              ? `${requests.length} queued`
              : `${requests.length} pending`}
          </span>
          {!listVisible && next ? (
            <span className="min-w-0 truncate">· next: {next.label}</span>
          ) : null}
        </ComposerQueueSummary>
      ) : null}
      {listVisible ? (
        <div
          id={listID}
          className="palot-native-scrollbar flex max-h-[min(9rem,20cqh)] min-w-0 flex-col overflow-x-hidden overflow-y-auto overscroll-contain"
        >
          {rows.map((row, index) => (
            <ComposerQueueItem
              key={row.key}
              sessionID={sessionID}
              request={row.request}
              files={filesOf(row)}
              working={working}
              state={states[row.request.id]}
              editDisabled={editDisabled || !onEdit}
              moving={moving}
              queuedPosition={
                row.request.delivery === "queue"
                  ? rows
                      .slice(0, index + 1)
                      .filter((candidate) => candidate.request.delivery === "queue").length
                  : undefined
              }
              queuedCount={queuedCount}
              first={row.request.id === firstQueuedID}
              steerShortcut={steerFirstShortcut && row.request.id === firstQueuedID}
              blocked={row.request.id === blockedID ? blocked : null}
              onAction={run}
              onMoveFirst={
                moveDisabled ? undefined : (request) => void enqueueMove(request.id, "row")
              }
            />
          ))}
        </div>
      ) : null}
      {editing ? <EditingRow editing={editing} /> : null}
    </ComposerQueueFrame>
  );
}

/** The message being edited in the text field; sending it adds it to the end of the queue. */
function EditingRow({ editing }: { editing: ComposerQueueEditing }) {
  return (
    <ComposerQueueRow
      state="editing"
      aria-label="Editing a pending message"
      data-palot-queue-state="editing"
    >
      <Pencil aria-hidden="true" />
      <ComposerQueueRowText>Editing in the message box</ComposerQueueRowText>
      <ComposerQueueRowActions>
        <QueueTooltip label="Discard the edit and bring back the draft you had">
          <Button type="button" variant="ghost" size="context" onClick={editing.onDiscard}>
            Cancel edit
          </Button>
        </QueueTooltip>
      </ComposerQueueRowActions>
      <ComposerQueueRowStatus>Sending it adds it to the end of the queue.</ComposerQueueRowStatus>
    </ComposerQueueRow>
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
    <ComposerQueueRow
      state="paused"
      tabIndex={-1}
      aria-label="Paused queue"
      data-palot-queue-paused={execution ?? "idle"}
    >
      <Pause aria-hidden="true" />
      <ComposerQueueRowText role="status" className="font-medium text-foreground/75">
        {error ?? composerQueuePauseMessage(execution)}
      </ComposerQueueRowText>
      <ComposerQueueRowActions>
        <QueueTooltip label="Send the next message and continue the queue. Sending a new message also resumes it.">
          <Button
            type="button"
            variant="ghost"
            size="context"
            data-pinned=""
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
          data-pinned=""
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
      </ComposerQueueRowActions>
    </ComposerQueueRow>
  );
}

function QueueTooltip({ label, children }: { label: ReactNode; children: ReactElement }) {
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function SteerNowLabel({ shortcut }: { shortcut: boolean }) {
  const keys = useShortcutKeys("composer.steer-first");
  return shortcut
    ? `Send without waiting for the current turn · ${formatShortcut(keys)}`
    : "Send without waiting for the current turn";
}

const ComposerQueueItem = memo(function ComposerQueueItem({
  sessionID,
  request,
  files,
  working,
  state,
  editDisabled,
  moving,
  queuedPosition,
  queuedCount,
  first,
  steerShortcut,
  blocked,
  onAction,
  onMoveFirst,
}: {
  sessionID: string;
  request: PendingRequestView;
  files?: PalotFileAttachment[];
  working: boolean;
  state?: ComposerQueueItemState;
  editDisabled: boolean;
  /** A move to the top is rewriting the queue; the rows' actions wait for it. */
  moving: boolean;
  queuedPosition?: number;
  queuedCount: number;
  /** The first queued input: its Steer now stays in view while a turn runs. */
  first: boolean;
  steerShortcut: boolean;
  blocked: ComposerQueueBlocked | null;
  onAction(request: PendingRequestView, action: ComposerQueueAction): void;
  onMoveFirst?(request: PendingRequestView): void;
}) {
  const [attentionTarget, setAttentionTarget] = useAtom(attentionTargetAtom);
  const rowRef = useRef<HTMLDivElement>(null);
  const delivery = request.delivery ?? "steer";
  const preview = composerQueuePreview(request, files);
  const sending = state?.phase === "sending";
  const busy = sending || moving;
  const failed = state?.phase === "failed" ? state : null;
  const status = failed
    ? "Failed"
    : sending && state.action === "steer"
      ? "Sending"
      : delivery === "queue" && queuedCount > 1 && queuedPosition
        ? `Queued · ${queuedPosition}`
        : delivery === "queue"
          ? "Queued"
          : blocked
            ? "Waiting"
            : "Steering";

  useEffect(() => {
    if (
      attentionTarget?.sessionID !== sessionID ||
      attentionTarget.type !== "input" ||
      attentionTarget.requestID !== request.id
    ) {
      return;
    }
    const element = rowRef.current;
    if (!element) return;
    element.scrollIntoView({ block: "nearest", behavior: "smooth" });
    element.focus();
    setAttentionTarget(null);
  }, [attentionTarget, request.id, sessionID, setAttentionTarget]);

  return (
    <ComposerQueueRow
      ref={rowRef}
      state={failed ? "queued" : blocked ? "blocked" : "queued"}
      data-palot-request-id={request.id}
      data-palot-queue-state={failed ? "failed" : sending ? "sending" : delivery}
      aria-label={`Pending message actions: ${preview.label}`}
      aria-busy={sending}
      className={cn(failed && "[&>svg]:text-destructive")}
    >
      {sending ? (
        <Spinner className="size-3.5" aria-hidden="true" />
      ) : failed ? (
        <CircleAlert aria-hidden="true" />
      ) : delivery === "queue" ? (
        <Clock3 aria-hidden="true" />
      ) : (
        <Zap aria-hidden="true" />
      )}
      <ComposerQueueRowText title={failed?.error ?? preview.label}>
        <span
          className={cn(
            "me-1.5 text-meta font-medium text-muted-foreground",
            failed && "text-destructive",
          )}
        >
          {status}
        </span>
        {preview.label}
        {preview.attachments > 0 ? (
          <span
            className="ms-1.5 inline-flex items-center gap-0.5 text-meta text-muted-foreground tabular-nums"
            aria-label={`${preview.attachments} ${preview.attachments === 1 ? "attachment" : "attachments"}`}
          >
            <Paperclip className="size-3" aria-hidden="true" />
            {preview.attachments}
          </span>
        ) : null}
      </ComposerQueueRowText>
      <ComposerQueueRowActions>
        {failed ? (
          <QueueTooltip label={failed.error}>
            <Button
              type="button"
              variant="ghost"
              size="context"
              data-pinned=""
              onClick={() => onAction(request, failed.action)}
            >
              <RotateCcw aria-hidden="true" />
              Retry
            </Button>
          </QueueTooltip>
        ) : delivery === "queue" ? (
          <QueueTooltip
            label={
              working ? (
                <SteerNowLabel shortcut={steerShortcut} />
              ) : (
                "Send now, then continue the queue"
              )
            }
          >
            <Button
              type="button"
              variant="ghost"
              size="context"
              data-pinned={first && working ? "" : undefined}
              disabled={busy}
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
            disabled={busy}
            onClick={() => onAction(request, "queue")}
          >
            <Clock3 aria-hidden="true" />
            Queue
          </Button>
        ) : null}
        {delivery === "queue" && !first && !failed && onMoveFirst ? (
          <QueueTooltip label="Send it before the other queued messages">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Move to top"
              disabled={busy}
              onClick={() => onMoveFirst(request)}
            >
              <ArrowUpToLine aria-hidden="true" />
            </Button>
          </QueueTooltip>
        ) : null}
        <QueueTooltip label="Edit in the composer">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Edit pending message"
            disabled={busy || editDisabled}
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
            disabled={busy}
            onClick={() => onAction(request, "delete")}
          >
            <Trash2 aria-hidden="true" />
          </Button>
        </QueueTooltip>
      </ComposerQueueRowActions>
      {failed ? (
        <ComposerQueueRowStatus className="text-destructive">{failed.error}</ComposerQueueRowStatus>
      ) : blocked ? (
        <ComposerQueueRowStatus data-palot-background-work-prompt>
          <span className="min-w-0 truncate">
            Waiting for {blockerLabel(blocked.items)} to finish
            {blocked.error ? <span className="ms-1 text-destructive">{blocked.error}</span> : null}
          </span>
          <span aria-hidden="true">·</span>
          <button
            type="button"
            className="inline-flex shrink-0 items-center gap-1 font-medium text-foreground/80 underline-offset-2 outline-none hover:text-foreground hover:underline focus-visible:underline disabled:opacity-60"
            aria-label={
              blocked.retry
                ? "Retry sending blocking work to background"
                : "Send blocking work to background so the message can steer this turn"
            }
            disabled={blocked.backgrounding}
            onClick={blocked.onBackground}
          >
            {blocked.backgrounding ? (
              <LoaderCircle className="size-3 animate-spin" aria-hidden="true" />
            ) : (
              <SendToBack className="size-3" aria-hidden="true" />
            )}
            {blocked.retry ? "Try again" : "Send it to the background"}
          </button>
        </ComposerQueueRowStatus>
      ) : null}
    </ComposerQueueRow>
  );
});

/** What a waiting steer waits for: "`bun test`", "the explore subagent", "2 shell commands". */
export function blockerLabel(items: readonly BackgroundWorkItem[]): string {
  if (items.length === 1) {
    const item = items[0]!;
    if (item.kind === "shell") {
      return item.command === "Shell command" ? "the shell command" : `\`${item.command}\``;
    }
    return `the ${item.description} subagent`;
  }
  const shells = items.filter((item) => item.kind === "shell").length;
  const subagents = items.length - shells;
  return [
    shells > 0 ? `${shells} ${shells === 1 ? "shell command" : "shell commands"}` : null,
    subagents > 0 ? `${subagents} ${subagents === 1 ? "subagent" : "subagents"}` : null,
  ]
    .filter((label): label is string => label !== null)
    .join(" and ");
}
