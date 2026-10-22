/**
 * Cross-task message search for the global palette: bounded, in-memory, and explicit about
 * coverage.
 *
 * OpenCode's native session search matches titles only and there is no message-content search
 * API, so the palette searches transcripts it can see: ones already hydrated in this window,
 * plus (on request) the latest page of messages from a few recent tasks per connection. This is
 * never a full-history search and must not be presented as one.
 */
import type { PalotMessage } from "../../shared";
import type { PaletteTask } from "./palette-tasks";
import { normalizeTranscriptQuery, transcriptPartText } from "./transcript-search";

/** Recent tasks per connection whose latest messages a bounded search fetches. */
export const MESSAGE_SEARCH_TASK_LIMIT = 30;
/** Latest messages fetched per task; older history is not searched. */
export const MESSAGE_SEARCH_MESSAGE_LIMIT = 50;
/** Parallel message requests across all connections. */
export const MESSAGE_SEARCH_CONCURRENCY = 3;
/** Matches shown per task, so one long task cannot fill the list. */
export const MESSAGE_SEARCH_PER_TASK = 2;
/** Matches the All tab shows; the Tasks tab shows up to `MESSAGE_SEARCH_LIMIT`. */
export const ALL_TAB_MESSAGE_LIMIT = 5;
export const MESSAGE_SEARCH_LIMIT = 30;
/** Message search needs at least this many characters, like remote task search. */
export const MESSAGE_SEARCH_MIN_QUERY = 2;

const EXCERPT_BEFORE = 36;
const EXCERPT_AFTER = 120;

export type MessageSearchAuthor = "user" | "assistant";

/** One task's searchable messages, in chronological order. */
export interface MessageSearchSource {
  task: PaletteTask;
  messages: readonly PalotMessage[];
}

export interface MessageExcerpt {
  before: string;
  match: string;
  after: string;
}

export interface MessageSearchHit {
  /** Stable row identity across connections. */
  id: string;
  task: PaletteTask;
  messageID: string;
  /**
   * The user message whose turn holds the match; transcript navigation jumps to turns.
   * `null` when that prompt is outside the searched window.
   */
  anchorMessageID: string | null;
  author: MessageSearchAuthor;
  createdAt: number;
  excerpt: MessageExcerpt;
}

/** Connection key a task's transcript is cached and fetched under. */
export function messageSearchConnectionKey(task: Pick<PaletteTask, "connectionID">): string {
  return task.connectionID ?? "disconnected";
}

export function messageSearchTaskKey(task: PaletteTask): string {
  return `${messageSearchConnectionKey(task)}\0${task.session.id}`;
}

function messageAuthor(message: PalotMessage): MessageSearchAuthor | null {
  if (message.type === "user") return "user";
  if (message.type === "assistant") return "assistant";
  return null;
}

const textCache = new WeakMap<PalotMessage, string[]>();

/** Text a reader sees for a user or assistant message; tools, reasoning and shells excluded. */
export function messageSearchTexts(message: PalotMessage): string[] {
  const cached = textCache.get(message);
  if (cached) return cached;
  const parts =
    message.content.length > 0 ? message.content : [{ type: "text", text: message.text ?? "" }];
  const texts = parts.flatMap((part) => {
    const text = transcriptPartText(message, part);
    return text ? [text] : [];
  });
  textCache.set(message, texts);
  return texts;
}

/** A single-line excerpt around one match, cut at word edges where possible. */
export function messageExcerpt(text: string, index: number, length: number): MessageExcerpt {
  let start = Math.max(0, index - EXCERPT_BEFORE);
  let end = Math.min(text.length, index + length + EXCERPT_AFTER);
  if (start > 0) {
    const space = text.indexOf(" ", start);
    if (space !== -1 && space < index) start = space + 1;
  }
  if (end < text.length) {
    const space = text.lastIndexOf(" ", end);
    if (space > index + length) end = space;
  }
  const flat = (value: string) => value.replaceAll(/\s+/g, " ");
  return {
    before: `${start > 0 ? "…" : ""}${flat(text.slice(start, index)).trimStart()}`,
    match: flat(text.slice(index, index + length)),
    after: `${flat(text.slice(index + length, end)).trimEnd()}${end < text.length ? "…" : ""}`,
  };
}

function findInText(text: string, needle: string): { index: number; length: number } | null {
  const lower = text.toLowerCase();
  const index = lower.indexOf(needle);
  if (index === -1) return null;
  // Lowercasing can change length for a few scripts; fall back to the lowered text there.
  return lower.length === text.length ? { index, length: needle.length } : null;
}

/**
 * Case-insensitive substring matches, newest task first and newest message first within a
 * task, at most `perTask` per task and `limit` overall.
 */
export function searchMessages(
  sources: readonly MessageSearchSource[],
  query: string,
  options: { limit?: number; perTask?: number } = {},
): MessageSearchHit[] {
  const needle = normalizeTranscriptQuery(query);
  const limit = options.limit ?? MESSAGE_SEARCH_LIMIT;
  const perTask = options.perTask ?? MESSAGE_SEARCH_PER_TASK;
  const hits: MessageSearchHit[] = [];
  if (needle.length < MESSAGE_SEARCH_MIN_QUERY) return hits;
  const ordered = sources.toSorted(
    (left, right) => right.task.session.updatedAt - left.task.session.updatedAt,
  );
  for (const { task, messages } of ordered) {
    let taskHits = 0;
    for (let index = messages.length - 1; index >= 0 && taskHits < perTask; index -= 1) {
      const message = messages[index]!;
      const author = messageAuthor(message);
      if (!author) continue;
      for (const text of messageSearchTexts(message)) {
        const lowerIndex = text.toLowerCase().indexOf(needle);
        if (lowerIndex === -1) continue;
        const found = findInText(text, needle);
        const excerpt = found
          ? messageExcerpt(text, found.index, found.length)
          : messageExcerpt(text.toLowerCase(), lowerIndex, needle.length);
        hits.push({
          id: `${messageSearchTaskKey(task)}\0${message.id}`,
          task,
          messageID: message.id,
          anchorMessageID: author === "user" ? message.id : precedingUserMessageID(messages, index),
          author,
          createdAt: message.createdAt,
          excerpt,
        });
        taskHits += 1;
        break;
      }
      if (hits.length >= limit) return hits;
    }
  }
  return hits;
}

function precedingUserMessageID(messages: readonly PalotMessage[], index: number): string | null {
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    if (messages[cursor]!.type === "user") return messages[cursor]!.id;
  }
  return null;
}

/**
 * The most recent connected tasks a bounded search may fetch: at most `perConnection` per
 * connection, in recency order. Offline connections contribute nothing.
 */
export function messageSearchCandidates(
  tasks: readonly PaletteTask[],
  perConnection = MESSAGE_SEARCH_TASK_LIMIT,
): PaletteTask[] {
  const counts = new Map<string, number>();
  const candidates: PaletteTask[] = [];
  for (const task of tasks) {
    if (!task.connected || task.session.parentID) continue;
    const key = messageSearchConnectionKey(task);
    const count = counts.get(key) ?? 0;
    if (count >= perConnection) continue;
    counts.set(key, count + 1);
    candidates.push(task);
  }
  return candidates;
}

/**
 * Runs `worker` over `items` with at most `concurrency` in flight. Stops starting new work once
 * `signal` aborts; a failing item never stops the others.
 */
export async function runBounded<T>(
  items: readonly T[],
  concurrency: number,
  signal: AbortSignal,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const lane = async () => {
    while (!signal.aborted && next < items.length) {
      const item = items[next]!;
      next += 1;
      try {
        await worker(item);
      } catch {
        // Workers record their own failures.
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, lane));
}

export interface MessageSearchCoverage {
  /** Tasks whose messages were searched, loaded or fetched. */
  searched: number;
  /** Recent tasks covered once the bounded search has finished; `null` before it runs. */
  recent: number | null;
  /** Progress of a bounded search still running. */
  pending?: { done: number; total: number } | null;
}

function taskCount(count: number): string {
  return `${count} ${count === 1 ? "task" : "tasks"}`;
}

/** Heading hint that states exactly what was searched, never implying full history. */
export function messageSearchCoverageLabel(coverage: MessageSearchCoverage): string {
  if (coverage.pending) {
    return `Searching ${coverage.pending.done} of ${taskCount(coverage.pending.total)}…`;
  }
  if (coverage.recent !== null) {
    const extra = coverage.searched - coverage.recent;
    const loaded = extra > 0 ? ` + ${extra} loaded` : "";
    return `Searched ${coverage.recent} recent ${coverage.recent === 1 ? "task" : "tasks"}${loaded} · latest messages only`;
  }
  return coverage.searched > 0 ? `Searched ${taskCount(coverage.searched)} loaded in Palot` : "";
}
