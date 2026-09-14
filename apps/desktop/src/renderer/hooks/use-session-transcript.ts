import type { SessionMessageInfo, SessionMessagesResponse } from "@opencode/client";
import {
  infiniteQueryOptions,
  useInfiniteQuery,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
} from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import { selectAtom } from "jotai/utils";
import { useEffect, useMemo } from "react";
import type {
  OpenCodeRuntimeStatus,
  PalotMessage,
  PalotMessageContent,
  PalotSession,
} from "../../shared";
import { messagesAtom, runtimeAtom } from "../atoms/workspace";
import { compareMessages, mergeMessages, reconcileMessage } from "../lib/message-reconcile";
import {
  openCodeReconciler,
  type OpenCodeSnapshotToken,
  type OpenCodeTranscriptSnapshotMode,
} from "../lib/open-code-reconciler";
import { openCodeKeys } from "../lib/opencode-query";
import { canFetchOpenCode } from "../lib/opencode-runtime-query";
import { mapMessage } from "../services/opencode-mappers";
import { palot } from "../services/palot";
import { useOpenCodeRecords } from "./use-open-code-records";

export type TranscriptPageParam = string | null;
export type TranscriptData = InfiniteData<SessionMessagesResponse, TranscriptPageParam>;

export const transcriptQueryRoot = (connectionID: string) => openCodeKeys.transcripts(connectionID);

export const transcriptQueryKey = (connectionID: string, sessionID: string) =>
  openCodeKeys.transcript(connectionID, sessionID);

const projectedMessageCache = new WeakMap<SessionMessageInfo, PalotMessage>();
const projectedPartCache = new WeakMap<object, PalotMessageContent>();

export function projectTranscriptMessages(messages: SessionMessageInfo[]): PalotMessage[] {
  // React Query structurally shares unchanged wire objects, so cache their immutable projections.
  return messages.map((message) => {
    const cached = projectedMessageCache.get(message);
    if (cached) return cached;

    const projected = mapMessage(message);
    if (message.type === "assistant") {
      projected.content = message.content.map((part, index) => {
        const cachedPart = projectedPartCache.get(part);
        if (cachedPart) return cachedPart;
        const nextPart = projected.content[index]!;
        projectedPartCache.set(part, nextPart);
        return nextPart;
      });
    }
    projectedMessageCache.set(message, projected);
    return projected;
  });
}

export function transcriptMessages(data: TranscriptData | undefined): PalotMessage[] {
  if (!data) return [];
  return data.pages.reduce(
    (messages, page) => mergeMessages(projectTranscriptMessages(page.data), messages, true),
    [] as PalotMessage[],
  );
}

function messageTypeOrder(message: SessionMessageInfo): number {
  if (message.type === "user") return 0;
  if (message.type === "assistant") return 1;
  return 2;
}

function mergeSessionMessages(
  authoritative: SessionMessageInfo[],
  current: SessionMessageInfo[],
): SessionMessageInfo[] {
  const messages = new Map(current.map((message) => [message.id, message]));
  for (const message of authoritative) messages.set(message.id, message);
  return [...messages.values()].toSorted((left, right) => {
    const chronological =
      left.time.created - right.time.created || messageTypeOrder(left) - messageTypeOrder(right);
    if (chronological !== 0) return chronological;
    return left.type === "user" && right.type === "user" ? left.id.localeCompare(right.id) : 0;
  });
}

export function mergeTranscriptMessages(
  authoritative: PalotMessage[],
  overlay: PalotMessage[],
): PalotMessage[] {
  if (overlay.length === 0) return authoritative;
  const live = new Map(
    overlay
      .filter((message) => message.optimistic !== true)
      .map((message) => [message.id, message]),
  );
  const optimistic = new Map(
    overlay
      .filter((message) => message.optimistic === true)
      .map((message) => [message.id, message]),
  );
  const seen = new Set<string>();
  let changed = false;
  const messages = authoritative.map((message) => {
    seen.add(message.id);
    const withLive = reconcileMessage(message, live.get(message.id), true) ?? message;
    const merged = reconcileMessage(withLive, optimistic.get(message.id), false) ?? withLive;
    if (merged !== message) changed = true;
    return merged;
  });
  const additions = [...live.keys(), ...optimistic.keys()]
    .filter((id, index, ids) => !seen.has(id) && ids.indexOf(id) === index)
    .flatMap((id) => {
      const merged = reconcileMessage(live.get(id), optimistic.get(id), false);
      return merged ? [merged] : [];
    });
  if (additions.length === 0) return changed ? messages : authoritative;
  return [...messages, ...additions].toSorted(compareMessages);
}

export function getTranscriptMessages(
  queryClient: QueryClient,
  connectionID: string,
  sessionID: string,
): PalotMessage[] {
  return openCodeReconciler(queryClient).messages(connectionID, sessionID);
}

export function hasTranscript(
  queryClient: QueryClient,
  connectionID: string,
  sessionID: string,
): boolean {
  return (
    openCodeReconciler(queryClient).messages(connectionID, sessionID).length > 0 ||
    queryClient.getQueryData(transcriptQueryKey(connectionID, sessionID)) !== undefined
  );
}

export function setTranscriptSnapshot(
  queryClient: QueryClient,
  connectionID: string,
  sessionID: string,
  page: SessionMessagesResponse,
  mode: Exclude<OpenCodeTranscriptSnapshotMode, "older">,
  token?: OpenCodeSnapshotToken,
): void {
  queryClient.setQueryData<TranscriptData>(
    transcriptQueryKey(connectionID, sessionID),
    (current) => {
      if (!current || mode === "rooted") {
        return { pages: [page], pageParams: [null] };
      }
      const currentHead = current.pages[0];
      if (!currentHead) return { pages: [page], pageParams: [null] };
      const head = {
        data: mergeSessionMessages(page.data, currentHead.data),
        cursor: {
          previous: page.cursor.previous,
          next: current.pages.length > 1 ? currentHead.cursor.next : page.cursor.next,
        },
      };
      return { pages: [head, ...current.pages.slice(1)], pageParams: current.pageParams };
    },
  );
  openCodeReconciler(queryClient).setTranscriptSnapshot(
    connectionID,
    sessionID,
    projectTranscriptMessages(page.data),
    mode,
    token,
  );
}

export function removeTranscriptMessage(
  queryClient: QueryClient,
  connectionID: string,
  sessionID: string,
  messageID: string,
): void {
  openCodeReconciler(queryClient).removeMessage(connectionID, sessionID, messageID);
  removeTranscriptCacheMessage(queryClient, connectionID, sessionID, messageID);
}

export function removeTranscriptCacheMessage(
  queryClient: QueryClient,
  connectionID: string,
  sessionID: string,
  messageID: string,
): void {
  queryClient.setQueryData<TranscriptData>(
    transcriptQueryKey(connectionID, sessionID),
    (current) =>
      current
        ? {
            ...current,
            pages: current.pages.map((page) => ({
              ...page,
              data: page.data.filter((message) => message.id !== messageID),
            })),
          }
        : current,
  );
}

export function sessionTranscriptQueryOptions(
  queryClient: QueryClient,
  session: PalotSession,
  runtime: OpenCodeRuntimeStatus | null,
  requireAvailableOwner = false,
) {
  const connectionID = runtime?.connectionID ?? "disconnected";
  return infiniteQueryOptions({
    queryKey: transcriptQueryKey(connectionID, session.id),
    enabled: canFetchOpenCode(runtime),
    initialPageParam: null as TranscriptPageParam,
    queryFn: async ({ pageParam, signal }) => {
      if (requireAvailableOwner && !canFetchOpenCode(runtime)) {
        throw new Error("The task's connection is unavailable");
      }
      const reconciler = openCodeReconciler(queryClient);
      const token = reconciler.beginSnapshot(connectionID);
      const page =
        pageParam !== null
          ? await palot.loadOlder(session.id, pageParam, signal, connectionID)
          : await palot.loadTranscript(session, "rooted", signal, connectionID);
      reconciler.setTranscriptSnapshot(
        connectionID,
        session.id,
        projectTranscriptMessages(page.data),
        pageParam === null ? "rooted" : "older",
        token,
      );
      return page;
    },
    getNextPageParam: (page, _pages, _lastPageParam, pageParams) => {
      const next = page.cursor.next ?? undefined;
      return next && !pageParams.includes(next) ? next : undefined;
    },
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnMount: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  });
}

export function useSessionTranscript(session: PalotSession, owner?: OpenCodeRuntimeStatus | null) {
  const activeRuntime = useAtomValue(runtimeAtom);
  const runtime = owner === undefined ? activeRuntime : owner;
  const queryClient = useQueryClient();
  const connectionID = runtime?.connectionID ?? null;
  const overlayAtom = useMemo(
    () =>
      selectAtom(messagesAtom, (messages) =>
        runtime && runtime.connectionID === activeRuntime?.connectionID
          ? (messages.get(session.id) ?? [])
          : [],
      ),
    [activeRuntime?.connectionID, runtime?.connectionID, session.id],
  );
  const overlay = useAtomValue(overlayAtom);
  const records = useOpenCodeRecords(connectionID ?? "disconnected", "session-message", session.id);
  const queryKey = transcriptQueryKey(connectionID ?? "disconnected", session.id);
  const query = useInfiniteQuery(
    sessionTranscriptQueryOptions(queryClient, session, runtime, owner !== undefined),
  );
  useEffect(() => {
    if (records.length > 0) return;
    const cached = queryClient.getQueryData<TranscriptData>(queryKey);
    if (!cached) return;
    openCodeReconciler(queryClient).setTranscriptSnapshot(
      connectionID ?? "disconnected",
      session.id,
      projectTranscriptMessages(cached.pages.flatMap((page) => page.data)),
      "rooted",
    );
  }, [connectionID, queryClient, queryKey, records.length, session.id]);
  const authoritative = useMemo(
    () => records.map((record) => record.value).toSorted(compareMessages),
    [records],
  );
  const snapshotMessageCount = useMemo(
    // Overlapping pages hydrate into one authoritative record per message ID.
    () =>
      query.data
        ? new Set(query.data.pages.flatMap((page) => page.data.map((message) => message.id))).size
        : 0,
    [query.data],
  );
  const messages = useMemo(
    () => mergeTranscriptMessages(authoritative, overlay),
    [authoritative, overlay],
  );

  return {
    connectionID: connectionID ?? "disconnected",
    messages,
    error: query.error,
    fetchNextPage: query.fetchNextPage,
    hasNextPage: query.hasNextPage,
    isFetchNextPageError: query.isFetchNextPageError,
    isFetchingNextPage: query.isFetchingNextPage,
    isHydrating: authoritative.length < snapshotMessageCount,
    isPending: query.isPending,
  };
}
