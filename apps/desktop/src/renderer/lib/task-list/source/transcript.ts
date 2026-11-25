/**
 * What the list can learn from a transcript Palot already holds in memory. The list never
 * fetches a transcript; a task whose transcript is not loaded degrades to "Working" and
 * "Finished · 5m ago" (see `000-plan.md`, "Data Palot does not have").
 */

import type { PalotMessage } from "../../../../shared";
import type { SessionExecutionState, SessionRuntimeStatus } from "../../../atoms/workspace";
import { sessionActivityLabel, sessionActivityStatus } from "../../session-activity-status";
import {
  createSessionTranscriptProjector,
  projectTranscriptTurns,
  type SessionTranscriptProjector,
  type TranscriptTurn,
} from "../../turn-projection";
import { turnWorkSummary } from "../../turn-work-summary";
import { messageText } from "../../view-models";
import type { Task } from "../types";

/** The last finished turn of a loaded transcript, kept per task once seen. */
export interface TurnInsight {
  /** The task's `idleAt` the insight belongs to; a newer turn makes it stale. */
  idleAt: number;
  summary: NonNullable<Task["summary"]>;
  /** The turn's answer, trimmed to what a quick look can show. */
  lastAnswer: string;
}

const MAX_ANSWER_LENGTH = 4_000;

/** A small LRU: reads refresh an entry, and the oldest entry leaves past `limit`. */
export class LruCache<V> {
  readonly #entries = new Map<string, V>();
  constructor(readonly limit: number) {}
  get(key: string): V | undefined {
    const value = this.#entries.get(key);
    if (value === undefined) return undefined;
    this.#entries.delete(key);
    this.#entries.set(key, value);
    return value;
  }
  set(key: string, value: V): void {
    this.#entries.delete(key);
    this.#entries.set(key, value);
    while (this.#entries.size > this.limit) {
      const oldest = this.#entries.keys().next().value;
      if (oldest === undefined) break;
      this.#entries.delete(oldest);
    }
  }
  get size(): number {
    return this.#entries.size;
  }
  clear(): void {
    this.#entries.clear();
  }
}

/** Summaries of turns that ended in a loaded transcript, by task id. Bounded, memory only. */
export const turnInsightCache = new LruCache<TurnInsight>(300);

function conversationTurns(turns: readonly TranscriptTurn[]): TranscriptTurn[] {
  return turns.filter((turn) => !turn.kind || turn.kind === "conversation");
}

/** The summary and answer of the transcript's last finished turn, or null when it has none. */
export function finishedTurnInsight(
  messages: PalotMessage[],
  execution: SessionExecutionState | null,
  idleAt: number,
): TurnInsight | null {
  if (messages.length === 0) return null;
  const turn = conversationTurns(projectTranscriptTurns(messages, execution)).at(-1);
  if (!turn || turn.status === "working") return null;
  const work = turnWorkSummary(turn);
  const end = turn.completedAt ?? turn.workCompletedAt ?? turn.startedAt;
  const answer = turn.final ? messageText(turn.final.message, turn.final.part).trim() : "";
  return {
    idleAt,
    // A finished turn took some time, so it never reads "0s" (as the transcript's turn bar).
    summary: {
      durationMs: Math.max(1_000, end - turn.startedAt),
      filesChanged: work.changedFiles,
      commands: work.commands,
    },
    lastAnswer: answer.length > MAX_ANSWER_LENGTH ? answer.slice(0, MAX_ANSWER_LENGTH) : answer,
  };
}

// Projectors keep their previous projection, so a streaming transcript re-projects cheaply.
const projectors = new LruCache<SessionTranscriptProjector>(8);

/**
 * What a running task is doing, in the transcript's words ("Running 'bun test'"), or null when
 * the transcript says nothing more specific than "Working".
 */
export function runningTurnDetail(
  key: string,
  messages: PalotMessage[],
  execution: SessionExecutionState | null,
  runtimeStatus: SessionRuntimeStatus | null,
): string | null {
  if (messages.length === 0) return null;
  let projector = projectors.get(key);
  if (!projector) {
    projector = createSessionTranscriptProjector();
    projectors.set(key, projector);
  }
  const rows = projector.project({ messages, execution, runtimeStatus }).rows;
  const turn = conversationTurns(rows.map((row) => row.turn)).at(-1) ?? null;
  const status = sessionActivityStatus({ turn, requests: [], runtimeStatus });
  if (!status) return null;
  const { label, detail } = sessionActivityLabel(status);
  const text = detail ? `${label} · ${detail}` : label;
  return text === "Working" ? null : text;
}
