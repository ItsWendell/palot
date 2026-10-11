/**
 * Surfaces the failure recorded on a turn's idle marker through the assistant error
 * rendering the transcript already has, so a failed turn still explains itself after reload.
 */

import type { JsonValue, PalotMessage } from "../../shared";

export interface PersistedTurnFailure {
  type: string | null;
  message: string;
}

function record(value: JsonValue | undefined): Record<string, JsonValue> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function text(value: JsonValue | undefined): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** The failure an idle marker recorded, or null for successful, interrupted or legacy markers. */
export function persistedTurnFailure(message: PalotMessage): PersistedTurnFailure | null {
  if (message.type !== "idle") return null;
  const data = record(message.data);
  if (data.outcome !== "failed") return null;
  const error = record(data.error);
  const detail = text(error.message);
  return detail ? { type: text(error.type), message: detail } : null;
}

// Mirrors the transcript projection's structured error check.
function hasStructuredError(message: PalotMessage): boolean {
  const error = record(record(message.data).error);
  return Boolean(
    text(error.type) ?? text(error.name) ?? text(error.message) ?? text(record(error.data).message),
  );
}

function failedCompaction(message: PalotMessage): boolean {
  const part = message.content.find((candidate) => candidate.type === "compaction");
  return part?.status === "failed" && !/abort|interrupt/i.test(part.error ?? "");
}

function errorData(failure: PersistedTurnFailure): Record<string, JsonValue> {
  return { ...(failure.type ? { type: failure.type } : {}), message: failure.message };
}

const failedSteps = new WeakMap<PalotMessage, { idle: PalotMessage; message: PalotMessage }>();
const carriers = new WeakMap<PalotMessage, PalotMessage>();

function failedStep(step: PalotMessage, idle: PalotMessage, failure: PersistedTurnFailure) {
  const cached = failedSteps.get(step);
  if (cached?.idle === idle) return cached.message;
  const message: PalotMessage = {
    ...step,
    completedAt: step.completedAt ?? idle.createdAt,
    data: { ...record(step.data), retry: null, error: errorData(failure) },
  };
  failedSteps.set(step, { idle, message });
  return message;
}

// A turn can fail before any step starts. The idle marker then carries the error itself.
function failureCarrier(idle: PalotMessage, failure: PersistedTurnFailure): PalotMessage {
  const cached = carriers.get(idle);
  if (cached) return cached;
  const message: PalotMessage = {
    id: idle.id,
    type: "assistant",
    createdAt: idle.createdAt,
    completedAt: idle.createdAt,
    text: null,
    agent: null,
    model: null,
    tokens: null,
    finish: "error",
    content: [],
    data: { ...record(idle.data), error: errorData(failure) },
  };
  carriers.set(idle, message);
  return message;
}

/**
 * Attaches each failed idle marker's error to the last step of the turn it ended, the
 * same shape a failed step already has. The projection then renders one failure card and
 * suppresses the live execution error for that turn. Steps that already show their own
 * failure, including a failed compaction, are left alone. Returns the input array when
 * nothing changes, and stable message references across calls for unchanged inputs.
 */
export function withPersistedTurnFailures(messages: PalotMessage[]): PalotMessage[] {
  let next: PalotMessage[] | null = null;
  let turnStart = 0;
  for (const [index, message] of messages.entries()) {
    if (message.type !== "idle") continue;
    const start = turnStart;
    turnStart = index + 1;
    const failure = persistedTurnFailure(message);
    if (!failure) continue;

    let stepIndex = -1;
    let inputAfterStep = false;
    for (let cursor = index - 1; cursor >= start; cursor -= 1) {
      const candidate = messages[cursor]!;
      if (candidate.type === "assistant" || candidate.type === "compaction") {
        stepIndex = cursor;
        break;
      }
      if (candidate.type === "user") inputAfterStep = true;
    }
    const step = stepIndex >= 0 ? messages[stepIndex]! : null;
    if (step?.type === "compaction" && failedCompaction(step)) continue;
    if (step?.type === "assistant" && hasStructuredError(step)) continue;

    next ??= [...messages];
    // A prompt that arrived after the last step keeps the failure after that prompt.
    if (step?.type === "assistant" && !inputAfterStep) {
      next[stepIndex] = failedStep(step, message, failure);
    } else {
      next[index] = failureCarrier(message, failure);
    }
  }
  return next ?? messages;
}
