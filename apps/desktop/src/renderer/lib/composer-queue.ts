/**
 * Pending composer inputs mirror OpenCode's session inbox. OpenCode owns order, delivery
 * (steer or queue) and lifetime; Palot only tracks the outcome of its own requests.
 *
 * After an interrupt OpenCode keeps every undelivered inbox item parked: nothing is dropped
 * and nothing is sent until something wakes the session. Steering an item wakes it, and the
 * drain then continues through the remaining queue one turn at a time. A new prompt wakes it
 * the same way, so its turn runs first and the parked queue follows.
 */

import type { PalotFileAttachment } from "../../shared";
import type { SessionExecutionState } from "../atoms/workspace";
import { palot } from "../services/palot";
import type { PendingRequestView } from "./view-models";

export type ComposerQueueAction = "steer" | "queue" | "edit" | "delete";

export type ComposerQueueItemState =
  | { phase: "sending"; action: ComposerQueueAction }
  | { phase: "failed"; action: ComposerQueueAction; error: string };

export interface ComposerQueuePreview {
  /** One-line label: the message text, or its attachment names when it has no text. */
  label: string;
  /** Attachments shown beside a text label; zero when the label already names them. */
  attachments: number;
}

export function composerQueuePreview(
  request: PendingRequestView,
  files: readonly PalotFileAttachment[] | undefined,
): ComposerQueuePreview {
  const text = request.detail?.replace(/\s+/g, " ").trim();
  const count = files?.length ?? 0;
  if (text) return { label: text, attachments: count };
  if (count === 0) return { label: "Pending message", attachments: 0 };
  const first = files![0]!.name;
  return { label: count > 1 ? `${first} (+${count - 1} more)` : first, attachments: 0 };
}

/** Undelivered inputs are paused whenever the task is idle; OpenCode delivers nothing on its own. */
export function composerQueuePauseMessage(
  execution: SessionExecutionState["status"] | undefined,
): string {
  if (execution === "interrupted") return "Queue paused because you stopped the task";
  if (execution === "failed") return "Queue paused because the task failed";
  return "Queue paused";
}

/**
 * Resumes a parked inbox through OpenCode's own wake path: steering an item wakes the
 * session, which then drains the rest. A parked steer cannot be steered again, so it is
 * queued and steered back to request the same wake.
 */
export async function resumeComposerQueue(
  sessionID: string,
  requests: readonly PendingRequestView[],
): Promise<void> {
  const next =
    requests.find((request) => request.delivery === "queue") ??
    requests.find((request) => request.delivery === "steer");
  if (!next) return;
  if (next.delivery === "steer") {
    await palot.updatePending({ sessionID, inputID: next.id, action: "queue" });
  }
  await palot.updatePending({ sessionID, inputID: next.id, action: "steer" });
}

/** Cancels every pending input and returns the IDs OpenCode refused to cancel. */
export async function clearComposerQueue(
  sessionID: string,
  requests: readonly PendingRequestView[],
): Promise<string[]> {
  const results = await Promise.allSettled(
    requests.map((request) =>
      palot.updatePending({ sessionID, inputID: request.id, action: "cancel" }),
    ),
  );
  return requests.flatMap((request, index) =>
    results[index]!.status === "rejected" ? [request.id] : [],
  );
}

export function composerQueueErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}
