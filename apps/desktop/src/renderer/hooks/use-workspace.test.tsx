import type { OpenCodeClient, SessionMessageInfo } from "@opencode/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { Provider, createStore } from "jotai";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OpenCodeRuntimeStatus, PalotMessage, PalotSession } from "../../shared";
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
import * as openCodeCatalog from "../services/opencode-catalog";
import { resetOpenCodeClientForTest, setOpenCodeClientForTest } from "../services/opencode-client";
import { attentionSyncStateAtom, sessionCatalogReadyAtom } from "../atoms/inbox";
import { sidebarModeAtom } from "../atoms/ui";
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
      store.set(sidebarModeAtom, "inbox");
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
      let pending!: Promise<void>;
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

  it("ignores background metadata and activity after focus changes", async () => {
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
    const getSession = vi.spyOn(openCodeCatalog, "getSessionInfo");
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
    expect(getSession).not.toHaveBeenCalled();
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
