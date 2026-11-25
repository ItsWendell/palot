// Audit against OpenCode PR #61785 (timelines drifting from the server on flaky connections).
// Gap 2, a one-shot catch-up: Palot had it. After the stream reconnected, the open task's
// transcript was read once and a failure only showed a toast, so a delivery the stream lost
// stayed lost. The catch-up now retries with a bounded backoff; see "reconnect catch-up".
// An inbox read overtaken by a live request change is not applied, so it counts as failed.
// A batch gap or a message the stream never introduced also lost events; the open task's
// recovery read retries the same way ("retries a failed recovery read after ...").
// Gap 1 on this path: the catch-up read keeps what the stream applied while it was in flight
// ("keeps a reply streamed while the catch-up read was in flight").
// Gap 4, rejoining a dead stream: Palot does not have it. The main process owns one
// subscription per connection and aborts it before reconnecting; see "recovers a half-open
// stream once at 45s plus the existing 1s backoff" in main/opencode-runtime-lifecycle.test.ts.
import type { OpenCodeClient, SessionMessageInfo } from "@opencode/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { Provider, createStore } from "jotai";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  OpenCodeRuntimeStatus,
  PalotEventBatch,
  PalotMessage,
  PalotSession,
} from "../../shared";
import {
  activeShellsAtom,
  errorAtom,
  messagesAtom,
  messagesForProfileAtom,
  phaseAtom,
  runtimeAtom,
  selectedSessionIDAtom,
  shellsForProfileAtom,
} from "../atoms/workspace";
import { palot } from "../services/palot";
import { toast } from "../components/ui/toast";
import * as openCodeCatalog from "../services/opencode-catalog";
import { resetOpenCodeClientForTest, setOpenCodeClientForTest } from "../services/opencode-client";
import { attentionSyncStateAtom, sessionCatalogReadyAtom } from "../atoms/inbox";
import { discoveredProfileIDsAtom, includedProfileIDsAtom } from "../atoms/connections";
import { createRendererQueryClient } from "../lib/query-client";
import { openCodeReconciler } from "../lib/open-code-reconciler";
import { openCodeKeys } from "../lib/opencode-query";
import {
  EMPTY_SESSION_REQUEST_SNAPSHOT,
  setSessionRequestSnapshot,
} from "../lib/session-request-query";
import { pendingRequestViews } from "../lib/view-models";
import {
  projectInfoFromPalot,
  sessionCatalogInfo,
  sessionInfoFromPalot,
} from "../lib/session-catalog-query";
import { useWorkspaceController } from "./use-workspace";
import { getTranscriptMessages, setTranscriptSnapshot } from "./use-session-transcript";

const project = {
  id: "project",
  canonical: "/project",
  name: "Project",
  sandboxes: [],
  vcs: null,
  updatedAt: 1,
};

function session(id: string): PalotSession {
  return {
    id,
    parentID: null,
    projectID: project.id,
    title: id,
    agent: null,
    model: null,
    location: { directory: project.canonical },
    createdAt: 1,
    updatedAt: 1,
    archivedAt: null,
    cost: null,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  };
}

function message(id: string, type: PalotMessage["type"], text: string): PalotMessage {
  return {
    id,
    type,
    createdAt: id === "user" ? 1 : 2,
    completedAt: 3,
    text,
    agent: type === "assistant" ? "build" : null,
    model: null,
    tokens: null,
    finish: type === "assistant" ? "stop" : null,
    content: [{ type: "text", text }],
    data: null,
  };
}

function rawMessage(id: string, type: "user" | "assistant", text: string): SessionMessageInfo {
  if (type === "user") return { id, type, time: { created: 1 }, text };
  return {
    id,
    type,
    time: { created: 2, completed: 3 },
    agent: "build",
    model: { id: "model", providerID: "provider" },
    finish: "stop",
    content: [{ type: "text", text }],
  };
}

function profileRuntime(profileID: string): OpenCodeRuntimeStatus {
  return {
    connectionID: `connection-${profileID}`,
    profileID,
    contractVersion: "0.0.0-beta-19425",
    phase: "connected",
    connected: true,
    binaryPath: null,
    version: "0.0.0-beta-19425",
    pid: null,
    managed: false,
    lastConnectedAt: 1,
    error: null,
    versionMismatch: null,
  };
}

async function profileWorkspace() {
  const root = session("duplicate-session");
  const runtime = profileRuntime("origin");
  const store = createStore();
  const queryClient = createRendererQueryClient();
  store.set(runtimeAtom, runtime);
  store.set(selectedSessionIDAtom, null);
  const messages = new Map([
    [root.id, [{ ...message("same-input", "user", "Origin optimistic"), optimistic: true }]],
  ]);
  const shells = new Map([[root.id, new Set(["same-shell"])]]);
  store.set(messagesAtom, messages);
  store.set(activeShellsAtom, shells);
  vi.spyOn(palot, "isPreview").mockReturnValue(true);
  vi.spyOn(palot, "hydratePreview").mockResolvedValue({
    runtime,
    projects: [project],
    sessions: { data: [root], cursor: { previous: null, next: null } },
    activeSessions: [],
  });
  vi.spyOn(palot, "loadAttentionSnapshot").mockResolvedValue({
    sessions: [],
    requests: [],
    complete: true,
  });
  const hook = renderHook(() => useWorkspaceController(null), {
    wrapper: ({ children }) => (
      <QueryClientProvider client={queryClient}>
        <Provider store={store}>{children}</Provider>
      </QueryClientProvider>
    ),
  });
  await waitFor(() => expect(store.get(sessionCatalogReadyAtom)).toBe(true));
  return { root, runtime, store, queryClient, messages, shells, hook };
}

describe("useWorkspaceController", () => {
  afterEach(() => {
    cleanup();
    resetOpenCodeClientForTest();
    vi.restoreAllMocks();
  });

  it("does not reconnect a disabled focused server after reload even without a cached catalog", async () => {
    const runtime = profileRuntime("disabled");
    const store = createStore();
    const queryClient = createRendererQueryClient();
    store.set(runtimeAtom, null);
    store.set(discoveredProfileIDsAtom, [runtime.profileID]);
    store.set(includedProfileIDsAtom, []);
    vi.spyOn(palot, "runtimeStatus").mockResolvedValue(runtime);
    vi.spyOn(palot, "isPreview").mockReturnValue(false);
    const connect = vi.spyOn(palot, "connectOpenCode");
    const hydrate = vi.spyOn(palot, "hydratePreview");
    renderHook(() => useWorkspaceController("selected-task"), {
      wrapper: ({ children }) => (
        <QueryClientProvider client={queryClient}>
          <Provider store={store}>{children}</Provider>
        </QueryClientProvider>
      ),
    });
    await waitFor(() => expect(store.get(phaseAtom)).toBe("ready"));
    expect(store.get(runtimeAtom)).toMatchObject({
      profileID: runtime.profileID,
      connected: false,
      phase: "stopped",
    });
    expect(connect).not.toHaveBeenCalled();
    expect(hydrate).not.toHaveBeenCalled();
    queryClient.clear();
  });

  it("invalidates attention readiness when the same connection disconnects", async () => {
    const { runtime, store, queryClient, root } = await profileWorkspace();
    await act(async () => {
      store.set(runtimeAtom, { ...runtime, connected: false, phase: "reconnecting" });
    });
    expect(store.get(attentionSyncStateAtom)).toBe("error");
    expect(store.get(sessionCatalogReadyAtom)).toBe(false);
    expect(
      sessionCatalogInfo(queryClient, runtime.connectionID).some((item) => item.id === root.id),
    ).toBe(true);
    await act(async () => {
      store.set(runtimeAtom, runtime);
    });
    expect(store.get(attentionSyncStateAtom)).toBe("syncing");
    expect(store.get(sessionCatalogReadyAtom)).toBe(false);
  });

  it("keeps both owners' in-flight transcript queries through focus and controller unmount", async () => {
    const { runtime, store, queryClient, hook } = await profileWorkspace();
    const remote = profileRuntime("remote");
    const requests = [runtime, remote].map((owner) => {
      const result = Promise.withResolvers<string>();
      let signal!: AbortSignal;
      const queryKey = openCodeKeys.transcript(owner.connectionID, "same-session");
      const pending = queryClient.fetchQuery({
        queryKey,
        queryFn: (context) => {
          signal = context.signal;
          return result.promise;
        },
      });
      return { result, pending, queryKey, signal };
    });
    act(() => store.set(runtimeAtom, remote));
    for (const request of requests) expect(request.signal.aborted).toBe(false);
    hook.unmount();
    for (const request of requests) {
      expect(request.signal.aborted).toBe(false);
      request.result.resolve("completed");
      await expect(request.pending).resolves.toBe("completed");
      expect(queryClient.getQueryData(request.queryKey)).toBe("completed");
    }
    queryClient.clear();
  });

  it("cancels an owner's in-flight queries when that same owner disconnects", async () => {
    const { runtime, store, queryClient } = await profileWorkspace();
    const result = Promise.withResolvers<string>();
    let signal!: AbortSignal;
    const queryKey = openCodeKeys.transcript(runtime.connectionID, "same-session");
    const pending = queryClient.fetchQuery({
      queryKey,
      queryFn: (context) => {
        signal = context.signal;
        return result.promise;
      },
    });
    const rejection = expect(pending).rejects.toThrow();
    act(() => store.set(runtimeAtom, { ...runtime, connected: false, phase: "stopped" }));
    expect(signal.aborted).toBe(true);
    await rejection;
    result.resolve("late response");
    expect(queryClient.getQueryData(queryKey)).toBeUndefined();
    queryClient.clear();
  });

  it.each(["focus", "unmount"])(
    "scopes ancestor hydration reads and drops late writes after %s",
    async (change) => {
      const { runtime, store, queryClient, hook } = await profileWorkspace();
      const child = { ...session("child"), parentID: "parent" };
      const parent = { ...session("parent"), parentID: "grandparent" };
      const result = Promise.withResolvers<PalotSession | null>();
      vi.mocked(palot.hydratePreview).mockResolvedValue({
        runtime,
        projects: [project],
        sessions: { data: [], cursor: { previous: null, next: null } },
        activeSessions: [child],
      });
      const getSession = vi
        .spyOn(palot, "getSession")
        .mockImplementation(async (id) =>
          id === parent.id ? result.promise : session("grandparent"),
        );
      let pending!: Promise<void>;
      act(() => {
        pending = hook.result.current.hydrate(true);
      });
      await waitFor(() => expect(getSession).toHaveBeenCalledWith(parent.id, runtime.connectionID));
      if (change === "unmount") hook.unmount();
      const other = profileRuntime("other");
      act(() => store.set(runtimeAtom, other));
      await act(async () => {
        result.resolve(parent);
        await pending;
      });
      expect(getSession).toHaveBeenCalledWith("grandparent", runtime.connectionID);
      expect(store.get(runtimeAtom)).toBe(other);
      expect(
        sessionCatalogInfo(queryClient, runtime.connectionID).map((item) => item.id),
      ).not.toContain(child.id);
      expect(sessionCatalogInfo(queryClient, other.connectionID)).toEqual([]);
    },
  );

  it.each(["focus", "unmount"])(
    "scopes inbox root reads and suppresses late triage after %s",
    async (change) => {
      const { runtime, store, queryClient, hook } = await profileWorkspace();
      const result = Promise.withResolvers<PalotSession | null>();
      const child = { ...session("child"), parentID: "parent" };
      const getSession = vi
        .spyOn(palot, "getSession")
        .mockImplementation(async (id) => (id === child.id ? result.promise : session("parent")));
      const dispatch = vi.spyOn(palot, "dispatchSessionTriage");
      act(() => {
        openCodeReconciler(queryClient).applyBatch({
          connectionID: runtime.connectionID,
          contractVersion: runtime.contractVersion,
          streamEpoch: 1,
          batchSequence: 1,
          receivedAt: 10,
          sentAt: 10,
          events: [
            {
              id: "inbox-child",
              type: "session.inbox.enqueued",
              created: 10,
              createdAt: 10,
              receiveSequence: 1,
              durable: { aggregateID: child.id, seq: 1, version: 1 },
              data: {
                sessionID: child.id,
                inboxID: "input",
                item: { type: "user", delivery: "queue", payload: { text: "Follow up" } },
              },
            },
          ],
        });
      });
      expect(getSession).toHaveBeenCalledWith(child.id, runtime.connectionID);
      if (change === "unmount") hook.unmount();
      act(() => store.set(runtimeAtom, profileRuntime("other")));
      await act(async () => result.resolve(child));
      expect(getSession).toHaveBeenCalledWith("parent", runtime.connectionID);
      expect(dispatch).not.toHaveBeenCalled();
      expect(
        sessionCatalogInfo(queryClient, runtime.connectionID).map((item) => item.id),
      ).not.toContain("parent");
    },
  );

  it("streams text without reading the session catalog", async () => {
    const { root, runtime, queryClient } = await profileWorkspace();
    const reconciler = openCodeReconciler(queryClient);
    const catalogReads = vi.spyOn(reconciler, "sessions");
    act(() => {
      reconciler.applyBatch({
        connectionID: runtime.connectionID,
        contractVersion: runtime.contractVersion,
        streamEpoch: 1,
        batchSequence: 1,
        receivedAt: 10,
        sentAt: 10,
        events: [10, 11].map((sequence) => ({
          id: `delta-${sequence}`,
          type: "session.text.delta",
          created: sequence,
          createdAt: sequence,
          receiveSequence: sequence,
          data: { sessionID: root.id, assistantMessageID: "reply", ordinal: 0, delta: "token" },
        })) as PalotEventBatch["events"],
      });
    });
    expect(catalogReads).not.toHaveBeenCalled();
  });

  it("never applies a background connection's runtime or duplicate-session deletion to focused state", async () => {
    const { root, runtime, store, queryClient, messages, shells } = await profileWorkspace();
    const background = profileRuntime("background");
    store.set(selectedSessionIDAtom, root.id);
    const loadSession = vi.spyOn(palot, "loadSession");
    const runtimeChanges = vi.fn();
    const messageChanges = vi.fn();
    const unsubscribeRuntime = store.sub(runtimeAtom, runtimeChanges);
    const unsubscribeMessages = store.sub(messagesAtom, messageChanges);

    await act(async () => {
      openCodeReconciler(queryClient).applyBatch({
        connectionID: background.connectionID,
        contractVersion: background.contractVersion,
        streamEpoch: 1,
        batchSequence: 1,
        receivedAt: 10,
        sentAt: 10,
        events: [
          {
            id: "background-delete",
            type: "session.deleted",
            created: 10,
            createdAt: 10,
            receiveSequence: 1,
            durable: { aggregateID: root.id, seq: 1, version: 2 },
            data: { sessionID: root.id },
          },
          {
            id: "background-runtime",
            type: "palot.runtime.status",
            location: null,
            createdAt: 11,
            receiveSequence: 2,
            data: background,
          },
        ],
      });
    });
    expect(store.get(runtimeAtom)).toBe(runtime);
    expect(store.get(messagesAtom)).toBe(messages);
    expect(store.get(activeShellsAtom)).toBe(shells);
    expect(store.get(selectedSessionIDAtom)).toBe(root.id);
    expect(runtimeChanges).not.toHaveBeenCalled();
    expect(messageChanges).not.toHaveBeenCalled();
    expect(loadSession).not.toHaveBeenCalled();
    unsubscribeRuntime();
    unsubscribeMessages();
  });

  it.each(["unmount", "focus"])(
    "ignores an old loadSession completion after %s with duplicate session and input IDs",
    async (change) => {
      const { root, runtime, store, queryClient, messages, shells, hook } =
        await profileWorkspace();
      const result = Promise.withResolvers<Awaited<ReturnType<typeof palot.loadSession>>>();
      const load = vi.spyOn(palot, "loadSession").mockReturnValue(result.promise);
      let pending!: Promise<boolean>;
      act(() => {
        pending = hook.result.current.loadSession(root);
      });
      expect(load).toHaveBeenCalledWith(
        root,
        { messages: true, requests: false, diffs: false },
        "rooted",
        runtime.connectionID,
      );
      if (change === "unmount") hook.unmount();
      const other = profileRuntime("other");
      const otherMessages = new Map([
        [root.id, [{ ...message("same-input", "user", "Other optimistic"), optimistic: true }]],
      ]);
      const otherShells = new Map([[root.id, new Set(["other-shell"])]]);
      act(() => {
        store.set(runtimeAtom, other);
        store.set(messagesAtom, otherMessages);
        store.set(activeShellsAtom, otherShells);
        setTranscriptSnapshot(
          queryClient,
          other.connectionID,
          root.id,
          {
            data: [rawMessage("other-answer", "assistant", "Other server answer")],
            cursor: { previous: null, next: null },
          },
          "rooted",
        );
      });
      await act(async () => {
        result.resolve({
          messages: {
            data: [rawMessage("same-input", "user", "Origin admitted prompt")],
            cursor: { previous: null, next: null },
          },
          requests: null,
          diffs: null,
        });
        await pending;
      });
      expect(store.get(runtimeAtom)).toEqual(other);
      expect(store.get(messagesAtom)).toBe(otherMessages);
      expect(store.get(activeShellsAtom)).toBe(otherShells);
      expect(store.get(messagesForProfileAtom(runtime.profileID))).toBe(messages);
      expect(store.get(shellsForProfileAtom(runtime.profileID))).toBe(shells);
      expect(
        getTranscriptMessages(queryClient, other.connectionID, root.id).map((entry) => entry.id),
      ).toEqual(["other-answer"]);
      expect(getTranscriptMessages(queryClient, runtime.connectionID, root.id)).toEqual([]);
    },
  );

  it("discards a restored session that OpenCode no longer accepts", async () => {
    const runtime = {
      phase: "connected" as const,
      connected: true,
      connectionID: "connection-stale-session",
      profileID: "test-profile",
      contractVersion: "0.0.0-beta-19425",
      binaryPath: "/usr/local/bin/opencode2",
      version: "0.0.0-beta-19425",
      pid: 1,
      managed: true,
      lastConnectedAt: 1,
      error: null,
      versionMismatch: null,
    };
    const getSession = vi.fn().mockRejectedValue({
      _tag: "InvalidRequestError",
      message: "Invalid session ID",
      field: "sessionID",
    });
    setOpenCodeClientForTest({ session: { get: getSession } } as unknown as OpenCodeClient);
    const store = createStore();
    store.set(selectedSessionIDAtom, "first-shell");
    const queryClient = createRendererQueryClient();
    vi.spyOn(palot, "runtimeStatus").mockResolvedValue(runtime);
    vi.spyOn(palot, "isPreview").mockReturnValue(false);
    vi.spyOn(palot, "loadAttentionSnapshot").mockResolvedValue({
      sessions: [],
      requests: [],
      complete: true,
    });
    vi.spyOn(openCodeCatalog, "listProjectInfo").mockResolvedValue([projectInfoFromPalot(project)]);
    vi.spyOn(openCodeCatalog, "listRootSessionInfo").mockResolvedValue({ data: [], cursor: {} });
    vi.spyOn(openCodeCatalog, "listActiveSessionIDs").mockResolvedValue([]);

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>
        <Provider store={store}>{children}</Provider>
      </QueryClientProvider>
    );
    renderHook(() => useWorkspaceController("first-shell"), { wrapper });

    await waitFor(() => expect(store.get(phaseAtom)).toBe("ready"));
    expect(store.get(errorAtom)).toBeNull();
    expect(store.get(selectedSessionIDAtom)).toBeNull();
    expect(getSession).toHaveBeenCalledOnce();
  });

  it("keeps connected boot within the core renderer request budget", async () => {
    const root = session("session-root");
    const runtime = {
      phase: "connected" as const,
      connected: true,
      connectionID: "connection-budget",
      profileID: "test-profile",
      contractVersion: "0.0.0-beta-19425",
      binaryPath: "/usr/local/bin/opencode2",
      version: "0.0.0-beta-19425",
      pid: 1,
      managed: true,
      lastConnectedAt: 1,
      error: null,
      versionMismatch: null,
    };
    const store = createStore();
    const queryClient = createRendererQueryClient();
    const runtimeStatus = vi.spyOn(palot, "runtimeStatus").mockResolvedValue(runtime);
    const connectOpenCode = vi.spyOn(palot, "connectOpenCode");
    const loadAttentionSnapshot = vi
      .spyOn(palot, "loadAttentionSnapshot")
      .mockResolvedValue({ sessions: [], requests: [], complete: true });
    const loadSession = vi.spyOn(palot, "loadSession");
    const getSession = vi.spyOn(palot, "getSession");
    vi.spyOn(palot, "isPreview").mockReturnValue(false);
    const listProjects = vi
      .spyOn(openCodeCatalog, "listProjectInfo")
      .mockResolvedValue([projectInfoFromPalot(project)]);
    const listRoots = vi
      .spyOn(openCodeCatalog, "listRootSessionInfo")
      .mockResolvedValue({ data: [sessionInfoFromPalot(root)], cursor: {} });
    const listActive = vi.spyOn(openCodeCatalog, "listActiveSessionIDs").mockResolvedValue([]);

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>
        <StrictMode>
          <Provider store={store}>{children}</Provider>
        </StrictMode>
      </QueryClientProvider>
    );
    renderHook(() => useWorkspaceController(null), { wrapper });

    await waitFor(() => expect(store.get(sessionCatalogReadyAtom)).toBe(true));
    expect(runtimeStatus).toHaveBeenCalledOnce();
    expect(connectOpenCode).not.toHaveBeenCalled();
    expect(listProjects).toHaveBeenCalledOnce();
    expect(listRoots).toHaveBeenCalledOnce();
    expect(listActive).toHaveBeenCalledOnce();
    expect(loadAttentionSnapshot).toHaveBeenCalledOnce();
    expect(loadSession).not.toHaveBeenCalled();
    expect(getSession).not.toHaveBeenCalled();
  });

  it("shows recent roots while labels and execution logs are pending, retaining active ancestors", async () => {
    const runtime = profileRuntime("progressive");
    const root = session("recent");
    const child = { ...session("active-child"), parentID: "older-root" };
    const parent = session("older-root");
    const restored = session("restored-outside-history");
    const store = createStore();
    store.set(selectedSessionIDAtom, restored.id);
    const queryClient = createRendererQueryClient();
    const projects =
      Promise.withResolvers<Awaited<ReturnType<typeof openCodeCatalog.listProjectInfo>>>();
    const logs =
      Promise.withResolvers<Awaited<ReturnType<typeof openCodeCatalog.loadSessionLog>>>();
    vi.spyOn(palot, "isPreview").mockReturnValue(false);
    vi.spyOn(palot, "runtimeStatus").mockResolvedValue(runtime);
    vi.spyOn(palot, "loadAttentionSnapshot").mockResolvedValue({
      sessions: [],
      requests: [],
      complete: true,
    });
    vi.spyOn(openCodeCatalog, "listProjectInfo").mockReturnValue(projects.promise);
    vi.spyOn(openCodeCatalog, "listRootSessionInfo").mockResolvedValue({
      data: [sessionInfoFromPalot(root)],
      cursor: {},
    });
    vi.spyOn(openCodeCatalog, "listActiveSessionIDs").mockResolvedValue([child.id]);
    vi.spyOn(openCodeCatalog, "getSessionInfo").mockImplementation(async (id) =>
      sessionInfoFromPalot(id === child.id ? child : id === parent.id ? parent : restored),
    );
    const loadLog = vi.spyOn(openCodeCatalog, "loadSessionLog").mockReturnValue(logs.promise);
    renderHook(() => useWorkspaceController(null), {
      wrapper: ({ children }) => (
        <QueryClientProvider client={queryClient}>
          <Provider store={store}>{children}</Provider>
        </QueryClientProvider>
      ),
    });
    await waitFor(() => expect(store.get(phaseAtom)).toBe("ready"));
    await waitFor(() => expect(loadLog).toHaveBeenCalled());
    expect(sessionCatalogInfo(queryClient, runtime.connectionID).map((item) => item.id)).toEqual(
      expect.arrayContaining([root.id, child.id, parent.id, restored.id]),
    );
    expect(store.get(selectedSessionIDAtom)).toBe(restored.id);
    expect(
      queryClient.getQueryState(openCodeKeys.projects(runtime.connectionID))?.fetchStatus,
    ).toBe("fetching");
    expect(
      queryClient.getQueryState(openCodeKeys.sessionActivity(runtime.connectionID))?.fetchStatus,
    ).toBe("fetching");
    await act(async () => {
      projects.reject(new Error("Labels unavailable"));
      logs.reject(new Error("Log unavailable"));
    });
    expect(store.get(phaseAtom)).toBe("ready");
    expect(store.get(errorAtom)).toBeNull();
  });

  it("keeps background activity owner-scoped and ignores stale controller metadata after focus changes", async () => {
    const runtime = profileRuntime("late");
    const store = createStore();
    store.set(runtimeAtom, runtime);
    store.set(selectedSessionIDAtom, null);
    const queryClient = createRendererQueryClient();
    const projects =
      Promise.withResolvers<Awaited<ReturnType<typeof openCodeCatalog.listProjectInfo>>>();
    const active = Promise.withResolvers<string[]>();
    vi.spyOn(palot, "isPreview").mockReturnValue(false);
    vi.spyOn(palot, "loadAttentionSnapshot").mockResolvedValue({
      sessions: [],
      requests: [],
      complete: true,
    });
    vi.spyOn(openCodeCatalog, "listProjectInfo").mockReturnValue(projects.promise);
    vi.spyOn(openCodeCatalog, "listRootSessionInfo").mockResolvedValue({
      data: [sessionInfoFromPalot(session("recent"))],
      cursor: {},
    });
    vi.spyOn(openCodeCatalog, "listActiveSessionIDs").mockReturnValue(active.promise);
    const getSession = vi.spyOn(openCodeCatalog, "getSessionInfo").mockResolvedValue(null);
    vi.spyOn(openCodeCatalog, "loadSessionLog").mockResolvedValue([]);
    renderHook(() => useWorkspaceController(null), {
      wrapper: ({ children }) => (
        <QueryClientProvider client={queryClient}>
          <Provider store={store}>{children}</Provider>
        </QueryClientProvider>
      ),
    });
    await waitFor(() => expect(store.get(phaseAtom)).toBe("ready"));
    const other = profileRuntime("other");
    act(() => store.set(runtimeAtom, other));
    await act(async () => {
      projects.resolve([projectInfoFromPalot(project)]);
      active.resolve(["late-child"]);
    });
    expect(getSession).toHaveBeenCalledExactlyOnceWith(
      "late-child",
      expect.any(AbortSignal),
      runtime.connectionID,
    );
    expect(openCodeReconciler(queryClient).projects(runtime.connectionID)).toEqual([]);
    expect(sessionCatalogInfo(queryClient, other.connectionID)).toEqual([]);
    expect(store.get(runtimeAtom)).toBe(other);
  });

  it.each(["absent", "partial entry"])(
    "retains known attention when %s in incomplete snapshots and retries only attention",
    async (kind) => {
      const { root, runtime, store, queryClient, hook } = await profileWorkspace();
      const requests = {
        ...EMPTY_SESSION_REQUEST_SNAPSHOT,
        permissions: [{ id: "permission", sessionID: root.id, action: "shell", resources: [] }],
      };
      setSessionRequestSnapshot(queryClient, runtime.connectionID, root.id, requests);
      vi.mocked(palot.loadAttentionSnapshot).mockResolvedValue({
        sessions: [],
        requests:
          kind === "absent" ? [] : [{ sessionID: root.id, value: EMPTY_SESSION_REQUEST_SNAPSHOT }],
        complete: false,
      });
      await act(async () => hook.result.current.hydrate(true));
      expect(store.get(phaseAtom)).toBe("ready");
      expect(store.get(sessionCatalogReadyAtom)).toBe(false);
      expect(store.get(attentionSyncStateAtom)).toBe("error");
      expect(
        openCodeReconciler(queryClient).requests(runtime.connectionID, root.id)?.permissions,
      ).toEqual(requests.permissions);
      vi.mocked(palot.loadAttentionSnapshot).mockResolvedValue({
        sessions: [],
        requests: [],
        complete: true,
      });
      await waitFor(() => expect(store.get(sessionCatalogReadyAtom)).toBe(true), { timeout: 2000 });
      expect(store.get(attentionSyncStateAtom)).toBe("ready");
      expect(palot.hydratePreview).toHaveBeenCalledTimes(2);
    },
  );

  it("does not apply late attention or mark another connection ready", async () => {
    const { runtime, store, queryClient, hook } = await profileWorkspace();
    const attention =
      Promise.withResolvers<Awaited<ReturnType<typeof palot.loadAttentionSnapshot>>>();
    vi.mocked(palot.loadAttentionSnapshot).mockReturnValue(attention.promise);
    await act(async () => hook.result.current.hydrate(true));
    act(() => store.set(runtimeAtom, profileRuntime("other")));
    await act(async () =>
      attention.resolve({ sessions: [session("late-attention")], requests: [], complete: true }),
    );
    expect(
      sessionCatalogInfo(queryClient, runtime.connectionID).map((item) => item.id),
    ).not.toContain("late-attention");
    expect(store.get(sessionCatalogReadyAtom)).toBe(false);
    expect(store.get(attentionSyncStateAtom)).toBe("syncing");
  });

  it("keeps live pending steers when hydration finishes with a stale inbox query", async () => {
    const root = session("session-pending-steers");
    const connectionID = "connection-pending-steers";
    const store = createStore();
    const queryClient = createRendererQueryClient();
    const reconciler = openCodeReconciler(queryClient);
    // The initial inbox query settles before admissions. Live events update the
    // graph, not that query cache, while workspace hydration is still in flight.
    setSessionRequestSnapshot(queryClient, connectionID, root.id, EMPTY_SESSION_REQUEST_SNAPSHOT);
    reconciler.applyBatch({
      connectionID,
      contractVersion: "0.0.0-beta-19425",
      streamEpoch: 1,
      batchSequence: 1,
      receivedAt: 10,
      sentAt: 10,
      events: ["STEER_ALPHA_19151", "STEER_BETA_19151", "compact"].map((text, index) => ({
        id: `admit-${index}`,
        type: "session.inbox.enqueued" as const,
        created: 10 + index,
        createdAt: 10 + index,
        receiveSequence: index + 1,
        durable: { aggregateID: root.id, seq: index + 1, version: 1 },
        data: {
          sessionID: root.id,
          inboxID: `input-${index}`,
          item:
            text === "compact"
              ? { type: "compaction" as const, payload: {}, delivery: "steer" as const }
              : { type: "user" as const, payload: { text }, delivery: "steer" as const },
        },
      })),
    });
    const admitted = reconciler.requests(connectionID, root.id)!;
    expect(admitted.inbox).toHaveLength(3);
    expect(
      queryClient.getQueryData(openCodeKeys.sessionRequests(connectionID, root.id)),
    ).toMatchObject({ inbox: [] });
    vi.spyOn(palot, "isPreview").mockReturnValue(false);
    vi.spyOn(palot, "runtimeStatus").mockResolvedValue({
      phase: "connected",
      connected: true,
      connectionID,
      profileID: "test-profile",
      contractVersion: "0.0.0-beta-19425",
      version: "0.0.0-beta-19425",
      binaryPath: "/usr/local/bin/opencode2",
      pid: 1,
      managed: true,
      lastConnectedAt: 1,
      error: null,
      versionMismatch: null,
    });
    vi.spyOn(openCodeCatalog, "listProjectInfo").mockResolvedValue([projectInfoFromPalot(project)]);
    vi.spyOn(openCodeCatalog, "listRootSessionInfo").mockResolvedValue({
      data: [sessionInfoFromPalot(root)],
      cursor: {},
    });
    vi.spyOn(openCodeCatalog, "listActiveSessionIDs").mockResolvedValue([]);
    vi.spyOn(palot, "loadAttentionSnapshot").mockResolvedValue({
      sessions: [],
      requests: [],
      complete: true,
    });
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>
        <Provider store={store}>{children}</Provider>
      </QueryClientProvider>
    );
    renderHook(() => useWorkspaceController(null), { wrapper });
    await waitFor(() => expect(store.get(sessionCatalogReadyAtom)).toBe(true));

    const settled = reconciler.requests(connectionID, root.id)!;
    expect(settled.inbox).toEqual(admitted.inbox);
    expect(pendingRequestViews(settled).map((request) => request.detail)).toEqual([
      "STEER_ALPHA_19151",
      "STEER_BETA_19151",
    ]);
  });

  it("reconciles retained messages when returning to a previously viewed session", async () => {
    const first = session("session-a");
    const second = session("session-b");
    const stale = [message("user", "user", "What's next?")];
    const authoritative = [
      rawMessage("user", "user", "What's next?"),
      rawMessage("assistant", "assistant", "Two agents remain active."),
    ];
    const store = createStore();
    store.set(selectedSessionIDAtom, first.id);
    store.set(
      messagesAtom,
      new Map([
        [first.id, stale],
        [second.id, []],
      ]),
    );
    const queryClient = createRendererQueryClient();
    setTranscriptSnapshot(
      queryClient,
      "connection",
      first.id,
      {
        data: [rawMessage("user", "user", "What's next?")],
        cursor: { previous: null, next: null },
      },
      "rooted",
    );

    vi.spyOn(palot, "hydratePreview").mockResolvedValue({
      runtime: {
        phase: "connected",
        connected: true,
        connectionID: "connection",
        profileID: "test-profile",
        contractVersion: "0.0.0-beta-19425",
        binaryPath: "/usr/local/bin/opencode2",
        version: "0.0.0-beta-19425",
        pid: 1,
        managed: true,
        lastConnectedAt: 1,
        error: null,
        versionMismatch: null,
      },
      projects: [project],
      sessions: { data: [first, second], cursor: { previous: null, next: null } },
      activeSessions: [],
    });
    vi.spyOn(palot, "loadAttentionSnapshot").mockResolvedValue({
      sessions: [],
      requests: [],
      complete: true,
    });
    vi.spyOn(palot, "subscribe").mockReturnValue(() => undefined);
    const loadSession = vi.spyOn(palot, "loadSession").mockResolvedValue({
      messages: { data: authoritative, cursor: { previous: null, next: null } },
      requests: null,
      diffs: null,
    });

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>
        <Provider store={store}>{children}</Provider>
      </QueryClientProvider>
    );
    const result = renderHook(({ selected }) => useWorkspaceController(selected), {
      wrapper,
      initialProps: { selected: first.id },
    });
    await waitFor(() => expect(sessionCatalogInfo(queryClient, "connection")).toHaveLength(2));
    await waitFor(() => expect(store.get(sessionCatalogReadyAtom)).toBe(true));
    loadSession.mockClear();

    store.set(selectedSessionIDAtom, second.id);
    result.rerender({ selected: second.id });
    store.set(selectedSessionIDAtom, first.id);
    result.rerender({ selected: first.id });

    await waitFor(() =>
      expect(loadSession).toHaveBeenCalledWith(
        { ...first, cost: 0 },
        {
          messages: true,
          requests: false,
          diffs: false,
        },
        "recent",
        "connection",
      ),
    );
    await waitFor(() =>
      expect(
        getTranscriptMessages(queryClient, "connection", first.id)
          .at(-1)
          ?.content.find((part) => part.type === "text")?.text,
      ).toBe("Two agents remain active."),
    );
  });

  it("refreshes an active transcript when its first observed event is a later text delta", async () => {
    const active = session("session-active");
    const store = createStore();
    store.set(selectedSessionIDAtom, active.id);
    const queryClient = createRendererQueryClient();
    setTranscriptSnapshot(
      queryClient,
      "connection",
      active.id,
      {
        data: [rawMessage("user", "user", "Keep going")],
        cursor: { previous: null, next: null },
      },
      "rooted",
    );

    vi.spyOn(palot, "hydratePreview").mockResolvedValue({
      runtime: {
        phase: "connected",
        connected: true,
        connectionID: "connection",
        profileID: "test-profile",
        contractVersion: "0.0.0-beta-18314",
        binaryPath: "/usr/local/bin/opencode2",
        version: "0.0.0-beta-18314",
        pid: 1,
        managed: true,
        lastConnectedAt: 1,
        error: null,
        versionMismatch: null,
      },
      projects: [project],
      sessions: { data: [active], cursor: { previous: null, next: null } },
      activeSessions: [active],
    });
    vi.spyOn(palot, "loadAttentionSnapshot").mockResolvedValue({
      sessions: [],
      requests: [],
      complete: true,
    });
    vi.spyOn(palot, "subscribe").mockReturnValue(() => undefined);
    const loadSession = vi.spyOn(palot, "loadSession").mockResolvedValue({
      messages: {
        data: [rawMessage("user", "user", "Keep going")],
        cursor: { previous: null, next: null },
      },
      requests: null,
      diffs: null,
    });

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>
        <Provider store={store}>{children}</Provider>
      </QueryClientProvider>
    );
    const result = renderHook(() => useWorkspaceController(active.id), { wrapper });
    await waitFor(() => expect(store.get(sessionCatalogReadyAtom)).toBe(true));
    result.rerender();
    await waitFor(() => expect(loadSession).toHaveBeenCalled());
    loadSession.mockClear();
    loadSession.mockResolvedValue({
      messages: {
        data: [
          rawMessage("user", "user", "Keep going"),
          rawMessage("assistant-live", "assistant", "Initial tokens then later"),
        ],
        cursor: { previous: null, next: null },
      },
      requests: null,
      diffs: null,
    });

    const ingestion = openCodeReconciler(queryClient).applyBatch({
      connectionID: "connection",
      contractVersion: "0.0.0-beta-18314",
      streamEpoch: 1,
      batchSequence: 1,
      receivedAt: 10,
      sentAt: 10,
      events: [
        {
          id: "later-delta",
          type: "session.text.delta",
          created: 10,
          createdAt: 10,
          receiveSequence: 1,
          data: {
            sessionID: active.id,
            assistantMessageID: "assistant-live",
            ordinal: 0,
            delta: "later",
          },
        },
      ],
    });
    expect(ingestion.missingMessageSessionIDs).toEqual([active.id]);

    await waitFor(() =>
      expect(loadSession).toHaveBeenCalledWith(
        expect.objectContaining({ id: active.id }),
        { messages: true, requests: false, diffs: false },
        "recent",
        "connection",
      ),
    );
  });
});

describe("reconnect catch-up", () => {
  afterEach(() => {
    vi.useRealTimers();
    cleanup();
    vi.restoreAllMocks();
  });

  const connectionID = "connection";
  const pendingPrompt = {
    id: "prompt",
    sessionID: "session-reconnect",
    time: { created: 5 },
    type: "user" as const,
    payload: { text: "Queued prompt" },
    delivery: "queue" as const,
  };
  const delivered = {
    messages: {
      data: [
        rawMessage("user", "user", "Start"),
        rawMessage("prompt", "user", "Queued prompt"),
        rawMessage("reply", "assistant", "Done"),
      ],
      cursor: { previous: null, next: null },
    },
    requests: null,
    diffs: null,
  };

  function streamBatch(
    streamEpoch: number,
    events: PalotEventBatch["events"],
    batchSequence = 1,
  ): PalotEventBatch {
    return {
      connectionID,
      contractVersion: "0.0.0-beta-19425",
      streamEpoch,
      batchSequence,
      receivedAt: 10,
      sentAt: 10,
      events,
    };
  }

  async function reconnectingWorkspace() {
    const task = session("session-reconnect");
    const runtime = { ...profileRuntime("test-profile"), connectionID };
    const store = createStore();
    store.set(selectedSessionIDAtom, task.id);
    const queryClient = createRendererQueryClient();
    const reconciler = openCodeReconciler(queryClient);
    setTranscriptSnapshot(
      queryClient,
      connectionID,
      task.id,
      { data: [rawMessage("user", "user", "Start")], cursor: { previous: null, next: null } },
      "rooted",
    );
    // The server accepted this prompt; its delivery is published while the stream is down.
    reconciler.applyBatch(
      streamBatch(1, [
        {
          id: "enqueued",
          type: "session.inbox.enqueued",
          created: 5,
          createdAt: 5,
          receiveSequence: 1,
          durable: { aggregateID: task.id, seq: 1, version: 1 },
          data: {
            sessionID: task.id,
            inboxID: pendingPrompt.id,
            item: { type: "user", payload: pendingPrompt.payload, delivery: "queue" },
          },
        },
      ]),
    );
    vi.spyOn(palot, "hydratePreview").mockResolvedValue({
      runtime,
      projects: [project],
      sessions: { data: [task], cursor: { previous: null, next: null } },
      activeSessions: [],
    });
    vi.spyOn(palot, "loadAttentionSnapshot").mockResolvedValue({
      sessions: [],
      requests: [],
      complete: true,
    });
    vi.spyOn(palot, "subscribe").mockReturnValue(() => undefined);
    const loadSession = vi.spyOn(palot, "loadSession").mockResolvedValue({
      messages: {
        data: [rawMessage("user", "user", "Start")],
        cursor: { previous: null, next: null },
      },
      requests: null,
      diffs: null,
    });
    const loadInbox = vi.spyOn(palot, "loadSessionInbox").mockResolvedValue([pendingPrompt]);
    const hook = renderHook(({ selected }) => useWorkspaceController(selected), {
      wrapper: ({ children }) => (
        <QueryClientProvider client={queryClient}>
          <Provider store={store}>{children}</Provider>
        </QueryClientProvider>
      ),
      initialProps: { selected: task.id as string | null },
    });
    await waitFor(() => expect(store.get(sessionCatalogReadyAtom)).toBe(true));
    hook.rerender({ selected: task.id });
    await waitFor(() => expect(loadSession).toHaveBeenCalled());
    loadSession.mockClear();
    loadInbox.mockClear();
    const pending = () =>
      pendingRequestViews(
        reconciler.requests(connectionID, task.id) ?? EMPTY_SESSION_REQUEST_SNAPSHOT,
      )
        .filter((request) => request.type === "input")
        .map((request) => request.id);
    const reconnect = () =>
      act(() => {
        reconciler.applyBatch(
          streamBatch(2, [
            {
              id: "connected",
              type: "server.connected",
              created: 20,
              createdAt: 20,
              receiveSequence: 1,
              data: {},
            } as PalotEventBatch["events"][number],
          ]),
        );
      });
    return {
      task,
      runtime,
      store,
      queryClient,
      reconciler,
      hook,
      loadSession,
      loadInbox,
      pending,
      reconnect,
    };
  }

  it("retries a failed catch-up until the transcript and pending input are read", async () => {
    const workspace = await reconnectingWorkspace();
    expect(workspace.pending()).toEqual([pendingPrompt.id]);
    workspace.loadSession
      .mockRejectedValueOnce(new Error("Network flake"))
      .mockResolvedValue(delivered);
    workspace.loadInbox.mockRejectedValueOnce(new Error("Network flake")).mockResolvedValue([]);

    workspace.reconnect();

    await waitFor(
      () => {
        expect(workspace.pending()).toEqual([]);
        expect(
          getTranscriptMessages(workspace.queryClient, connectionID, workspace.task.id)
            .map((message) => message.id)
            .toSorted(),
        ).toEqual(["prompt", "reply", "user"]);
      },
      { timeout: 3_000 },
    );
    expect(workspace.loadSession).toHaveBeenCalledTimes(2);
  });

  function enqueued(inboxID: string, sequence: number): PalotEventBatch["events"][number] {
    return {
      id: `enqueued-${inboxID}`,
      type: "session.inbox.enqueued",
      created: 20 + sequence,
      createdAt: 20 + sequence,
      receiveSequence: sequence,
      durable: { aggregateID: "session-reconnect", seq: sequence, version: 1 },
      data: {
        sessionID: "session-reconnect",
        inboxID,
        item: { type: "user", payload: { text: inboxID }, delivery: "queue" },
      },
    };
  }

  it("reads the inbox again when a live request change overtakes the catch-up read", async () => {
    const workspace = await reconnectingWorkspace();
    const second = { ...pendingPrompt, id: "second", payload: { text: "second" } };
    workspace.loadSession.mockResolvedValue(delivered);
    const firstRead = Promise.withResolvers<(typeof pendingPrompt)[]>();
    workspace.loadInbox.mockReturnValueOnce(firstRead.promise).mockResolvedValue([second]);

    workspace.reconnect();
    await waitFor(() => expect(workspace.loadInbox).toHaveBeenCalledOnce());
    // Another client queues a prompt while the read is on its way, so the read predates it.
    act(() => {
      workspace.reconciler.applyBatch(streamBatch(2, [enqueued("second", 2)], 2));
    });
    await act(async () => firstRead.resolve([]));

    await waitFor(() => expect(workspace.pending()).toEqual(["second"]), { timeout: 3_000 });
    expect(workspace.loadInbox).toHaveBeenCalledTimes(2);
  });

  it("stops reading the inbox after the bounded attempts when every read is overtaken", async () => {
    const workspace = await reconnectingWorkspace();
    workspace.loadSession.mockResolvedValue(delivered);
    let sequence = 1;
    workspace.loadInbox.mockImplementation(async () => {
      sequence += 1;
      workspace.reconciler.applyBatch(
        streamBatch(2, [enqueued(`live-${sequence}`, sequence)], sequence),
      );
      return [];
    });
    vi.useFakeTimers();

    workspace.reconnect();
    await act(() => vi.advanceTimersByTimeAsync(60_000));

    expect(workspace.loadInbox).toHaveBeenCalledTimes(5);
  });

  const lostEvents = {
    // Batch 2 of this stream never arrived.
    "a batch gap": streamBatch(
      1,
      [
        {
          id: "renamed",
          type: "session.renamed",
          created: 30,
          createdAt: 30,
          receiveSequence: 3,
          durable: { aggregateID: "session-reconnect", seq: 3, version: 1 },
          data: { sessionID: "session-reconnect", title: "Renamed" },
        },
      ],
      3,
    ),
    // The event that started this reply never arrived.
    "a message the stream never introduced": streamBatch(
      1,
      [
        {
          id: "orphan-delta",
          type: "session.text.delta",
          created: 30,
          createdAt: 30,
          receiveSequence: 2,
          data: {
            sessionID: "session-reconnect",
            assistantMessageID: "reply",
            ordinal: 0,
            delta: "Do",
          },
        },
      ],
      2,
    ),
  } satisfies Record<string, PalotEventBatch>;

  it.each(Object.keys(lostEvents) as (keyof typeof lostEvents)[])(
    "retries a failed recovery read after %s until it applies",
    async (loss) => {
      const workspace = await reconnectingWorkspace();
      workspace.loadSession
        .mockRejectedValueOnce(new Error("Network flake"))
        .mockResolvedValue(delivered);
      workspace.loadInbox.mockResolvedValue([]);

      act(() => {
        workspace.reconciler.applyBatch(lostEvents[loss]);
      });

      await waitFor(
        () => {
          expect(workspace.pending()).toEqual([]);
          expect(
            getTranscriptMessages(workspace.queryClient, connectionID, workspace.task.id).find(
              (message) => message.id === "reply",
            )?.content[0]?.text,
          ).toBe("Done");
        },
        { timeout: 3_000 },
      );
      expect(workspace.loadSession).toHaveBeenCalledTimes(2);
    },
  );

  it("stops retrying a recovery read once the task is closed", async () => {
    const workspace = await reconnectingWorkspace();
    workspace.loadSession.mockRejectedValue(new Error("Network flake"));
    workspace.loadInbox.mockRejectedValue(new Error("Network flake"));

    act(() => {
      workspace.reconciler.applyBatch(lostEvents["a batch gap"]);
    });
    await waitFor(() => expect(workspace.loadSession).toHaveBeenCalledOnce());
    act(() => {
      workspace.store.set(selectedSessionIDAtom, null);
      workspace.hook.rerender({ selected: null });
    });
    await act(() => new Promise((resolve) => setTimeout(resolve, 1_200)));

    expect(workspace.loadSession).toHaveBeenCalledOnce();
  });

  it("keeps a reply streamed while the catch-up read was in flight", async () => {
    const workspace = await reconnectingWorkspace();
    const response = Promise.withResolvers<typeof delivered>();
    workspace.loadSession.mockReturnValue(response.promise);
    workspace.loadInbox.mockResolvedValue([]);

    workspace.reconnect();
    await waitFor(() => expect(workspace.loadSession).toHaveBeenCalled());
    act(() => {
      workspace.reconciler.applyBatch(
        streamBatch(
          2,
          [
            {
              id: "step",
              type: "session.step.started",
              created: 30,
              createdAt: 30,
              receiveSequence: 2,
              data: { sessionID: workspace.task.id, assistantMessageID: "live", agent: "build" },
            },
            {
              id: "delta",
              type: "session.text.delta",
              created: 31,
              createdAt: 31,
              receiveSequence: 3,
              data: {
                sessionID: workspace.task.id,
                assistantMessageID: "live",
                ordinal: 0,
                delta: "Streaming on",
              },
            },
          ] as PalotEventBatch["events"],
          2,
        ),
      );
    });
    await act(async () => response.resolve(delivered));

    await waitFor(() =>
      expect(
        getTranscriptMessages(workspace.queryClient, connectionID, workspace.task.id)
          .map((message) => message.id)
          .toSorted(),
      ).toEqual(["live", "prompt", "reply", "user"]),
    );
    expect(
      getTranscriptMessages(workspace.queryClient, connectionID, workspace.task.id).find(
        (message) => message.id === "live",
      )?.content[0]?.text,
    ).toBe("Streaming on");
  });

  it.each([
    [
      "the task is closed",
      (workspace: Awaited<ReturnType<typeof reconnectingWorkspace>>) => {
        workspace.store.set(selectedSessionIDAtom, null);
        workspace.hook.rerender({ selected: null });
      },
    ],
    [
      "the connection drops",
      (workspace: Awaited<ReturnType<typeof reconnectingWorkspace>>) => {
        workspace.store.set(runtimeAtom, {
          ...workspace.runtime,
          connected: false,
          phase: "reconnecting",
        });
      },
    ],
  ])("stops retrying the catch-up once %s", async (_, leave) => {
    const workspace = await reconnectingWorkspace();
    workspace.loadSession.mockRejectedValue(new Error("Network flake"));
    workspace.loadInbox.mockRejectedValue(new Error("Network flake"));

    workspace.reconnect();
    await waitFor(() => expect(workspace.loadSession).toHaveBeenCalledOnce());
    act(() => leave(workspace));
    await act(() => new Promise((resolve) => setTimeout(resolve, 1_200)));

    expect(workspace.loadSession).toHaveBeenCalledOnce();
  });

  it("gives up on the catch-up after a bounded number of attempts", async () => {
    const workspace = await reconnectingWorkspace();
    workspace.loadSession.mockRejectedValue(new Error("Network flake"));
    workspace.loadInbox.mockRejectedValue(new Error("Network flake"));
    const reported = vi.spyOn(toast, "add");
    vi.useFakeTimers();

    workspace.reconnect();
    await act(() => vi.advanceTimersByTimeAsync(60_000));

    expect(workspace.loadSession).toHaveBeenCalledTimes(5);
    expect(workspace.loadInbox).toHaveBeenCalledTimes(5);
    // Only the last attempt reports the failure.
    expect(reported).toHaveBeenCalledOnce();
  });
});
