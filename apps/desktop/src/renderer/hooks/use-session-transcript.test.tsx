import type { SessionMessageInfo, SessionMessagesResponse } from "@opencode/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { Provider, createStore } from "jotai";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PalotMessage, PalotSession } from "../../shared";
import { runtimeAtom } from "../atoms/workspace";
import { createRendererQueryClient } from "../lib/query-client";
import { openCodeReconciler } from "../lib/open-code-reconciler";
import { createSessionTranscriptProjector } from "../lib/turn-projection";
import { palot } from "../services/palot";
import {
  getTranscriptMessages,
  mergeTranscriptMessages,
  projectTranscriptMessages,
  removeTranscriptMessage,
  setTranscriptSnapshot,
  transcriptQueryKey,
  transcriptMessages,
  type TranscriptData,
  useSessionTranscript,
} from "./use-session-transcript";

const session: PalotSession = {
  id: "session",
  parentID: null,
  projectID: "project",
  title: "Session",
  agent: null,
  model: null,
  location: { directory: "/repo" },
  createdAt: 1,
  updatedAt: 1,
  archivedAt: null,
  cost: null,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
};

afterEach(() => vi.restoreAllMocks());

function rawMessage(id: string, createdAt: number, text: string): SessionMessageInfo {
  if (id.startsWith("user")) {
    return { id, type: "user", time: { created: createdAt }, text };
  }
  return {
    id,
    type: "assistant",
    time: { created: createdAt, completed: createdAt + 1 },
    agent: "build",
    model: { id: "model", providerID: "provider" },
    finish: "stop",
    content: [{ type: "text", text }],
  };
}

function message(id: string, createdAt: number, text: string, optimistic = false): PalotMessage {
  return {
    id,
    type: id.startsWith("user") ? "user" : "assistant",
    createdAt,
    completedAt: optimistic ? null : createdAt + 1,
    text,
    agent: id.startsWith("user") ? null : "build",
    model: null,
    tokens: null,
    finish: optimistic ? null : "stop",
    content: [{ type: "text", text }],
    data: null,
    ...(optimistic ? { optimistic: true } : {}),
  };
}

function page(data: SessionMessageInfo[], next: string | null): SessionMessagesResponse {
  return { data, cursor: { previous: null, next } };
}

function projectedText(message: PalotMessage): string | null {
  return message.text ?? message.content.find((part) => part.type === "text")?.text ?? null;
}

function seedTranscriptData(
  queryClient: ReturnType<typeof createRendererQueryClient>,
  data: TranscriptData,
): void {
  queryClient.setQueryData<TranscriptData>(transcriptQueryKey("connection", "session"), data);
  openCodeReconciler(queryClient).setTranscriptSnapshot(
    "connection",
    "session",
    transcriptMessages(data),
    "rooted",
  );
}

describe("session transcript queries", () => {
  it.each(["succeeded", "failed", "interrupted"] as const)(
    "hydrates %s idle markers without changing visible transcript rows",
    (outcome) => {
      const first = [rawMessage("user-first", 1, "First"), rawMessage("answer-first", 2, "Done")];
      const next = [rawMessage("user-next", 5, "Next"), rawMessage("answer-next", 6, "Ready")];
      const idle: SessionMessageInfo = {
        id: "idle",
        type: "idle",
        time: { created: 4 },
        outcome,
      };
      const messages = transcriptMessages({
        pages: [page(next, "older"), page([...first, idle], null)],
        pageParams: [null, "older"],
      });

      expect(messages.map((message) => message.id)).toEqual([
        "user-first",
        "answer-first",
        "idle",
        "user-next",
        "answer-next",
      ]);
      expect(messages[2]?.data).toEqual(idle);

      const projection = createSessionTranscriptProjector().project({ messages });
      const withoutMarkers = createSessionTranscriptProjector().project({
        messages: projectTranscriptMessages([...first, ...next]),
      });
      expect(projection.rows.map((row) => row.id)).toEqual([
        "user-first",
        "answer-first",
        "user-next",
        "answer-next",
      ]);
      expect(projection.presentationRows).toEqual(withoutMarkers.presentationRows);
      expect(projection.prompts).toEqual(withoutMarkers.prompts);
    },
  );

  it("preserves completed message parts when a sibling text part streams", () => {
    const tool = {
      type: "tool" as const,
      id: "read-image",
      name: "read",
      time: { created: 1, ran: 2 },
      state: {
        status: "completed" as const,
        input: { path: "preview.png" },
        content: [{ type: "text", text: "Image read successfully" }] as [
          { type: "text"; text: string },
        ],
        metadata: {},
      },
    };
    const firstRaw: SessionMessageInfo = {
      id: "assistant",
      type: "assistant",
      time: { created: 1 },
      agent: "build",
      model: { id: "model", providerID: "provider" },
      content: [tool, { type: "text", text: "First" }],
    };
    const first = projectTranscriptMessages([firstRaw])[0]!;
    const second = projectTranscriptMessages([
      { ...firstRaw, content: [tool, { type: "text", text: "First second" }] },
    ])[0]!;

    expect(second).not.toBe(first);
    expect(second.content[0]).toBe(first.content[0]);
    expect(second.content[1]).not.toBe(first.content[1]);
  });

  it("flattens authoritative pages chronologically and keeps the newest duplicate", () => {
    const queryClient = createRendererQueryClient();
    seedTranscriptData(queryClient, {
      pages: [
        page([rawMessage("assistant", 2, "new")], "older"),
        page([rawMessage("user", 1, "old"), rawMessage("assistant", 2, "stale")], null),
      ],
      pageParams: [null, "older"],
    });

    expect(getTranscriptMessages(queryClient, "connection", "session").map(projectedText)).toEqual([
      "old",
      "new",
    ]);
  });

  it("patches a recent head without discarding loaded older pages", () => {
    const queryClient = createRendererQueryClient();
    seedTranscriptData(queryClient, {
      pages: [
        page([rawMessage("assistant", 3, "current")], "older"),
        page([rawMessage("user", 1, "old")], null),
      ],
      pageParams: [null, "older"],
    });

    setTranscriptSnapshot(
      queryClient,
      "connection",
      "session",
      page(
        [rawMessage("assistant", 3, "refreshed"), rawMessage("assistant-2", 4, "next")],
        "changed",
      ),
      "recent",
    );

    expect(getTranscriptMessages(queryClient, "connection", "session").map(projectedText)).toEqual([
      "old",
      "refreshed",
      "next",
    ]);
    const cached = queryClient.getQueryData<TranscriptData>(
      transcriptQueryKey("connection", "session"),
    );
    expect(cached?.pages[0]?.cursor.next).toBe("older");
    expect(cached?.pages[0]?.data[0]).toEqual(rawMessage("assistant", 3, "refreshed"));
    expect(cached?.pages[0]?.data[0]).not.toHaveProperty("createdAt");
  });

  it("layers live messages over snapshots while authoritative receipts replace optimistic copies", () => {
    const authoritative = [message("user-1", 1, "accepted"), message("assistant", 2, "A")];
    const overlay = [message("user-1", 1, "pending", true), message("assistant", 2, "AB")];

    expect(mergeTranscriptMessages(authoritative, overlay).map((item) => item.text)).toEqual([
      "accepted",
      "AB",
    ]);
  });

  it("removes cancelled inputs from every cached page", () => {
    const queryClient = createRendererQueryClient();
    seedTranscriptData(queryClient, {
      pages: [
        page([rawMessage("user-cancelled", 2, "cancelled")], "older"),
        page([rawMessage("user-old", 1, "old")], null),
      ],
      pageParams: [null, "older"],
    });

    removeTranscriptMessage(queryClient, "connection", "session", "user-cancelled");

    expect(
      getTranscriptMessages(queryClient, "connection", "session").map((item) => item.id),
    ).toEqual(["user-old"]);
  });

  it("hydrates a newly created DB graph from an existing Query transcript", async () => {
    const queryClient = createRendererQueryClient();
    queryClient.setQueryData<TranscriptData>(transcriptQueryKey("connection", session.id), {
      pages: [page([rawMessage("assistant", 2, "cached")], null)],
      pageParams: [null],
    });
    const store = createStore();
    store.set(runtimeAtom, {
      connectionID: "connection",
      profileID: "profile",
      contractVersion: "0.0.0-beta-19425",
      phase: "connected",
      connected: true,
      binaryPath: null,
      version: "0.0.0-beta-19425",
      pid: 1,
      managed: false,
      lastConnectedAt: 1,
      error: null,
      versionMismatch: null,
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>
        <Provider store={store}>{children}</Provider>
      </QueryClientProvider>
    );

    const result = renderHook(() => useSessionTranscript(session), { wrapper });

    await waitFor(() =>
      expect(result.result.current.messages.map(projectedText)).toEqual(["cached"]),
    );
    expect(
      openCodeReconciler(queryClient).messages("connection", session.id).map(projectedText),
    ).toEqual(["cached"]);
  });

  it("loads rooted messages once and uses the next cursor for pagination", async () => {
    const loadTranscript = vi
      .spyOn(palot, "loadTranscript")
      .mockResolvedValue(page([rawMessage("assistant", 2, "new")], "older"));
    const loadOlder = vi
      .spyOn(palot, "loadOlder")
      .mockResolvedValue(page([rawMessage("user", 1, "old")], "older"));
    const queryClient = createRendererQueryClient();
    const store = createStore();
    store.set(runtimeAtom, {
      connectionID: "connection",
      profileID: "profile",
      contractVersion: "0.0.0-beta-19425",
      phase: "connected",
      connected: true,
      binaryPath: null,
      version: "0.0.0-beta-19425",
      pid: 1,
      managed: false,
      lastConnectedAt: 1,
      error: null,
      versionMismatch: null,
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>
        <Provider store={store}>{children}</Provider>
      </QueryClientProvider>
    );
    const result = renderHook(() => useSessionTranscript(session), { wrapper });

    await waitFor(() => expect(result.result.current.isPending).toBe(false));
    expect(result.result.current.messages.map(projectedText)).toEqual(["new"]);
    expect(loadTranscript).toHaveBeenCalledOnce();
    expect(loadTranscript).toHaveBeenCalledWith(
      session,
      "rooted",
      expect.any(AbortSignal),
      "connection",
    );

    act(() => {
      openCodeReconciler(queryClient).applyBatch({
        connectionID: "connection",
        contractVersion: "test",
        streamEpoch: 1,
        batchSequence: 1,
        receivedAt: 3,
        sentAt: 3,
        events: [
          {
            id: "live",
            type: "session.synthetic",
            created: 3,
            createdAt: 3,
            receiveSequence: 1,
            data: { sessionID: session.id, text: "live" },
          },
        ] as never,
      });
    });
    await waitFor(() =>
      expect(result.result.current.messages.map(projectedText)).toEqual(["new", "live"]),
    );

    await act(async () => {
      await result.result.current.fetchNextPage();
    });

    expect(loadOlder).toHaveBeenCalledWith(
      session.id,
      "older",
      expect.any(AbortSignal),
      "connection",
    );
    await waitFor(() =>
      expect(result.result.current.messages.map(projectedText)).toEqual(["old", "new", "live"]),
    );
    expect(result.result.current.hasNextPage).toBe(false);
  });
});
