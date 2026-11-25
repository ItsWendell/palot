/**
 * The composer's primary control as one pure state machine: what pressing it does, what it is
 * called, whether it can be pressed, the alternate delivery it offers, and whether a separate
 * Stop sits beside it. The row, the tests and later layouts read the same rules.
 */

import type { ComposerDelivery } from "../../atoms/ui";
import { formatTokenCount } from "../../lib/context-usage";
import type { ComposerPrimaryView } from "../ui/composer";

type PrimaryActionKind = "send" | "compact-send" | "queue" | "steer" | "stop" | "run" | "update";

export interface PrimaryActionInput {
  /** A turn is running in an existing task. */
  working: boolean;
  /** Something can be sent now (see `composerCanSubmit`). */
  canSubmit: boolean;
  shell: boolean;
  /** A canceled pending message is open for editing. */
  editing: boolean;
  /** The delivery used while the agent works: the edit's own, or the default. */
  delivery: ComposerDelivery;
  /** The task is large and idle long enough that compacting first is suggested. */
  compactSuggested: boolean;
}

export interface PrimaryAction {
  kind: PrimaryActionKind;
  /** Accessible name of the control. */
  label: string;
  disabled: boolean;
  /** What Mod+Enter or a Mod-click sends instead while the agent works: the other delivery. */
  alternate: ComposerDelivery | null;
  /** A separate Stop button stays beside the control. */
  stop: boolean;
}

export const STOP_LABEL = "Stop task";

function deliveryLabel(delivery: ComposerDelivery): string {
  return delivery === "queue" ? "Queue message after current turn" : "Steer current turn";
}

export function primaryAction(input: PrimaryActionInput): PrimaryAction {
  const disabled = !input.canSubmit;
  if (input.working && !input.canSubmit)
    return { kind: "stop", label: STOP_LABEL, disabled: false, alternate: null, stop: false };
  if (input.shell)
    return {
      kind: "run",
      label: "Run shell command",
      disabled,
      alternate: null,
      stop: input.working,
    };
  if (input.working)
    return {
      kind: input.delivery,
      label: deliveryLabel(input.delivery),
      disabled,
      alternate: input.delivery === "queue" ? "steer" : "queue",
      stop: true,
    };
  // An edited pending message is never offered compaction first; it goes back as it is.
  if (input.editing)
    return { kind: "update", label: "Send message", disabled, alternate: null, stop: false };
  if (input.compactSuggested)
    return {
      kind: "compact-send",
      label: "Compact and send",
      disabled,
      alternate: null,
      stop: false,
    };
  return { kind: "send", label: "Send message", disabled, alternate: null, stop: false };
}

export interface ComposerSubmitInput {
  shell: boolean;
  /** The draft has non-whitespace text. */
  hasText: boolean;
  /** The draft is a `/btw` side question, which is allowed while a request or switch blocks. */
  btw: boolean;
  /** Attachments, line comments or browser comments would be sent. */
  hasContext: boolean;
  /** An attachment uploads. A prompt sent now waits for it; a shell command cannot run. */
  uploading: boolean;
  selectionBlocked: boolean;
  permissionsBusy: boolean;
  locationMissing: boolean;
  requestOpen: boolean;
  sending: boolean;
  /** A pending message is being canceled into the composer. */
  canceling: boolean;
  /** False only when the runtime reports a lost connection. */
  connected: boolean;
}

export function composerCanSubmit(input: ComposerSubmitInput): boolean {
  if (input.sending || input.canceling || !input.connected) return false;
  const free = !input.selectionBlocked && !input.permissionsBusy && !input.locationMissing;
  if (input.shell) return input.hasText && free && !input.uploading;
  return (
    (input.btw || (free && !input.requestOpen)) &&
    (input.hasText || input.hasContext || input.uploading)
  );
}

interface PrimaryPresentation {
  /** What the button shows; its kind picks the icon. */
  view: ComposerPrimaryView;
  /** What it shows while Mod is held: the alternate delivery. */
  preview?: ComposerPrimaryView;
  tooltip: string;
}

const DELIVERY_VIEW: Record<ComposerDelivery, ComposerPrimaryView> = {
  queue: { kind: "queue", label: "Queue", name: deliveryLabel("queue") },
  steer: { kind: "steer", label: "Steer", name: deliveryLabel("steer") },
};

/**
 * How the one primary button presents an action. Send and Stop are icons; Queue, Steer, Run
 * and Compact and send carry their word. An edited message goes back like any other send.
 */
export function primaryPresentation(
  action: PrimaryAction,
  {
    steerShortcut,
    queueFirstShortcut,
    multiModel,
    compactTokens,
  }: {
    /** The effective Mod+Enter binding (the alternate delivery), formatted. */
    steerShortcut: string;
    /** The effective Alt+Enter binding (queue ahead of the queued messages), formatted. */
    queueFirstShortcut?: string;
    /** Shift-click opens "Send to several models". */
    multiModel: boolean;
    /** History tokens compacting first would summarize. */
    compactTokens: number | null;
  },
): PrimaryPresentation {
  const queueFirst = queueFirstShortcut ? `. Queue it first · ${queueFirstShortcut}` : "";
  switch (action.kind) {
    case "stop":
      return { view: { kind: "stop", label: action.label }, tooltip: "Stop the agent" };
    case "queue":
      return {
        view: DELIVERY_VIEW.queue,
        preview: DELIVERY_VIEW.steer,
        tooltip: `Queue after the current turn · Enter. Steer it now · ${steerShortcut}${queueFirst}`,
      };
    case "steer":
      return {
        view: DELIVERY_VIEW.steer,
        preview: DELIVERY_VIEW.queue,
        tooltip: `Steer the current turn · Enter. Queue it after the turn · ${steerShortcut}${queueFirst}`,
      };
    case "run":
      return {
        view: { kind: "run", label: "Run", name: action.label },
        tooltip: "Run the command · Enter",
      };
    case "compact-send":
      return {
        view: { kind: "compact-send", label: action.label },
        tooltip:
          compactTokens === null
            ? "Compact the context, then send"
            : `Summarize ${formatTokenCount(compactTokens)} tokens of history, then send`,
      };
    case "send":
    case "update":
      return {
        view: { kind: "send", label: action.label },
        tooltip: multiModel
          ? "Send · Enter. Shift-click to send to several models"
          : "Send · Enter",
      };
  }
}
