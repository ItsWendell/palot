import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useEffect, useEffectEvent, useMemo, useState } from "react";
import type { PalotMessage } from "../../shared";
import {
  MESSAGE_SEARCH_CONCURRENCY,
  MESSAGE_SEARCH_MIN_QUERY,
  messageSearchCandidates,
  messageSearchConnectionKey,
  messageSearchCoverageLabel,
  messageSearchTaskKey,
  runBounded,
  searchMessages,
  type MessageSearchHit,
  type MessageSearchSource,
} from "../lib/message-search";
import { normalizeTranscriptQuery } from "../lib/transcript-search";
import type { PaletteTask } from "../lib/palette-tasks";
import { loadRecentSessionMessages } from "../services/opencode-message-search";
import { getTranscriptMessages, transcriptQueryKey } from "./use-session-transcript";

export const MESSAGE_SEARCH_DEBOUNCE_MS = 200;

export interface MessageSearchFailure {
  connectionKey: string;
  serverName: string | null;
  message: string;
}

export interface MessageSearch {
  /** The debounced query the hits belong to; empty while idle. */
  query: string;
  hits: MessageSearchHit[];
  /** Heading hint describing exactly what was searched. */
  coverage: string;
  /** Recent tasks a bounded search covers, including ones already loaded. */
  recentTaskCount: number;
  /** The bounded recent-task search can still be started in this palette session. */
  canSearchRecent: boolean;
  pending: boolean;
  failures: MessageSearchFailure[];
  searchRecent(): void;
  retry(): void;
}

interface FetchState {
  messages: ReadonlyMap<string, readonly PalotMessage[]>;
  failures: ReadonlyMap<string, MessageSearchFailure>;
}

const EMPTY_FETCH: FetchState = { messages: new Map(), failures: new Map() };

function errorText(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "Request failed";
}

function hydratedMessages(queryClient: QueryClient, task: PaletteTask): PalotMessage[] {
  return getTranscriptMessages(queryClient, messageSearchConnectionKey(task), task.session.id);
}

/**
 * Message search for the global palette. Always searches transcripts already hydrated in this
 * window; once requested, also fetches the latest messages of the most recent tasks on each
 * connected server with bounded concurrency. Fetched messages live only in this hook's state and
 * are dropped when the palette closes; a query change aborts requests still in flight.
 */
export function useMessageSearch(input: {
  open: boolean;
  /** The current tab and page show message results. */
  active: boolean;
  query: string;
  /** Root tasks in recency order, each owned by its connection. */
  tasks: readonly PaletteTask[];
  /** Whether network fetches are possible at all. */
  canFetch: boolean;
  limit: number;
}): MessageSearch {
  const queryClient = useQueryClient();
  const { open, active, tasks, canFetch, limit } = input;
  const normalized = normalizeTranscriptQuery(input.query);
  const [debounced, setDebounced] = useState("");
  const [recentRequested, setRecentRequested] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [fetched, setFetched] = useState<FetchState>(EMPTY_FETCH);

  // Fetched messages belong to one palette session.
  useEffect(() => {
    if (open) return;
    setFetched(EMPTY_FETCH);
    setRecentRequested(false);
    setProgress(null);
    setDebounced("");
  }, [open]);

  const searchable = open && active && normalized.length >= MESSAGE_SEARCH_MIN_QUERY;
  useEffect(() => {
    if (!searchable) return;
    const timer = window.setTimeout(() => setDebounced(normalized), MESSAGE_SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [normalized, searchable]);
  const query = searchable ? debounced : "";

  const candidates = useMemo(
    () => (canFetch ? messageSearchCandidates(tasks) : []),
    [canFetch, tasks],
  );
  const candidatesSignature = candidates.map(messageSearchTaskKey).join("\n");

  const startRecentSearch = useEffectEvent(() => {
    const pending = candidates.filter(
      (task) =>
        !fetched.messages.has(messageSearchTaskKey(task)) &&
        !fetched.failures.has(messageSearchConnectionKey(task)) &&
        hydratedMessages(queryClient, task).length === 0,
    );
    if (pending.length === 0) {
      setProgress(null);
      return undefined;
    }
    const controller = new AbortController();
    const failed = new Set<string>();
    let done = 0;
    setProgress({ done, total: pending.length });
    void runBounded(pending, MESSAGE_SEARCH_CONCURRENCY, controller.signal, async (task) => {
      const connectionKey = messageSearchConnectionKey(task);
      if (failed.has(connectionKey)) return;
      try {
        const messages = await loadRecentSessionMessages(
          task.session.id,
          // Single-connection tasks use the focused client, like task search.
          task.profileID === null ? undefined : (task.connectionID ?? undefined),
          controller.signal,
        );
        if (controller.signal.aborted) return;
        setFetched((current) => ({
          ...current,
          messages: new Map(current.messages).set(messageSearchTaskKey(task), messages),
        }));
      } catch (error) {
        if (controller.signal.aborted) return;
        // An unreachable server stops its own remaining requests, not the others.
        failed.add(connectionKey);
        const failure = { connectionKey, serverName: task.serverName, message: errorText(error) };
        setFetched((current) => ({
          ...current,
          failures: new Map(current.failures).set(connectionKey, failure),
        }));
      }
      done += 1;
      setProgress({ done, total: pending.length });
    }).then(() => {
      if (!controller.signal.aborted) setProgress(null);
    });
    return () => {
      controller.abort();
      setProgress(null);
    };
  });
  useEffect(() => {
    if (!recentRequested || !query) return;
    return startRecentSearch();
  }, [recentRequested, query, candidatesSignature, retryNonce]);

  const result = useMemo(() => {
    if (!query) return { hits: [], searched: 0, recentSearched: 0 };
    const recentKeys = new Set(candidates.map(messageSearchTaskKey));
    const sources: MessageSearchSource[] = [];
    let recentSearched = 0;
    for (const task of tasks) {
      const key = messageSearchTaskKey(task);
      const hydrated = hydratedMessages(queryClient, task);
      const messages = hydrated.length > 0 ? hydrated : fetched.messages.get(key);
      if (!messages) continue;
      sources.push({ task, messages });
      if (recentKeys.has(key)) recentSearched += 1;
    }
    return {
      hits: searchMessages(sources, query, { limit }),
      searched: sources.length,
      recentSearched,
    };
  }, [query, tasks, candidates, limit, queryClient, fetched.messages]);

  return {
    query,
    hits: result.hits,
    coverage: query
      ? messageSearchCoverageLabel({
          searched: result.searched,
          recent: recentRequested && progress === null ? result.recentSearched : null,
          pending: progress,
        })
      : "",
    recentTaskCount: candidates.length,
    canSearchRecent: !recentRequested && candidates.length > 0,
    pending: progress !== null,
    failures: [...fetched.failures.values()],
    searchRecent: () => setRecentRequested(true),
    retry: () => {
      setFetched((current) => ({ ...current, failures: new Map() }));
      setRetryNonce((value) => value + 1);
    },
  };
}

let cancelPendingJump: (() => void) | null = null;

/**
 * Asks a task's transcript to scroll to a turn once that transcript has hydrated. The thread
 * consumes a jump as soon as it mounts, so a jump set before a cold transcript arrives would
 * find no turns and be lost.
 */
export function requestTranscriptJump(
  queryClient: QueryClient,
  setTarget: (target: { sessionID: string; messageID: string }) => void,
  target: { connectionID: string; sessionID: string; messageID: string },
  timeoutMs = 15_000,
): void {
  cancelPendingJump?.();
  const key = transcriptQueryKey(target.connectionID, target.sessionID);
  const jump = () => setTarget({ sessionID: target.sessionID, messageID: target.messageID });
  if (queryClient.getQueryData(key) !== undefined) {
    jump();
    return;
  }
  const unsubscribe = queryClient.getQueryCache().subscribe(() => {
    if (queryClient.getQueryData(key) === undefined) return;
    stop();
    jump();
  });
  const timer = window.setTimeout(() => stop(), timeoutMs);
  function stop() {
    unsubscribe();
    window.clearTimeout(timer);
    if (cancelPendingJump === stop) cancelPendingJump = null;
  }
  cancelPendingJump = stop;
}
