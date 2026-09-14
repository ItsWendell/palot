import type { OpenCodeClient, SessionInfo } from "@opencode/client";
import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  OpenCodeProfile,
  OpenCodeProfileSnapshot,
  OpenCodeRuntimeStatus,
  PalotEvent,
  PalotEventBatch,
  SessionTriageSnapshot,
  PalotAttentionSnapshot,
} from "../../shared";
import { ConnectionOverviewController } from "./connection-overview";
import { openCodeReconciler } from "./open-code-reconciler";
import { seedSessionDetails } from "./session-catalog-query";
import { mapSession } from "../services/opencode-mappers";

const mocks = vi.hoisted(() => ({
  clients: new Map<string, OpenCodeClient>(),
  profiles: vi.fn(),
  triage: vi.fn(),
  dispatch: vi.fn(),
  attention: vi.fn(),
  connect: vi.fn(),
  disconnect: vi.fn(),
  runtimes: vi.fn(),
}));
vi.mock("../services/opencode-client", () => ({
  registerOpenCodeRuntime: vi.fn(),
  openCodeClient: (id: string) => {
    const client = mocks.clients.get(id);
    if (!client) throw new Error(`Unknown connection ${id}`);
    return client;
  },
}));
vi.mock("../services/palot", () => ({
  palot: {
    isPreview: () => false,
    listOpenCodeProfiles: mocks.profiles,
    loadSessionTriage: mocks.triage,
    dispatchSessionTriage: mocks.dispatch,
    loadAttentionSnapshot: mocks.attention,
  },
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function runtime(profileID: string, connectionID = `${profileID}-1`): OpenCodeRuntimeStatus {
  return {
    profileID,
    connectionID,
    connected: true,
    phase: "connected",
    contractVersion: "test",
    binaryPath: null,
    version: null,
    pid: null,
    managed: false,
    lastConnectedAt: 1,
    error: null,
    versionMismatch: null,
  };
}
function session(id = "same", title = "Task"): SessionInfo {
  return {
    id,
    title,
    projectID: "project",
    location: { directory: "/repo" },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 1, updated: 1 },
  };
}
function triage(profileID: string, pinned = false): SessionTriageSnapshot {
  return {
    profileID,
    bootstrapThrough: null,
    sessions: pinned
      ? [
          {
            sessionID: "same",
            pinnedAt: 1,
            snoozedUntil: null,
            snoozedThrough: null,
            disposition: null,
            settledThrough: null,
            updatedAt: 1,
          },
        ]
      : [],
  };
}
function client(profileID: string, connectionID = `${profileID}-1`) {
  const value = {
    project: {
      list: vi.fn().mockResolvedValue([
        {
          id: "project",
          name: profileID,
          canonical: "/repo",
          sandboxes: [],
          time: { created: 1, updated: 1 },
        },
      ]),
    },
    session: {
      list: vi.fn().mockResolvedValue({ data: [session("same", profileID)], cursor: {} }),
      active: vi.fn().mockResolvedValue({}),
      get: vi.fn(
        async ({ sessionID }: { sessionID: string }, _options?: { signal?: AbortSignal }) =>
          session(sessionID, profileID),
      ),
      log: vi.fn(async function* () {
        yield { type: "log.synced", created: 1, cursor: 0 };
      }),
      rename: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
    },
    message: { list: vi.fn() },
  };
  mocks.clients.set(connectionID, value as unknown as OpenCodeClient);
  return value;
}
let queryClient: QueryClient;
let controller: ConnectionOverviewController;
let stop: (() => void) | undefined;
let profiles: OpenCodeProfile[];
let runtimes: OpenCodeRuntimeStatus[];
let sequence: number;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.clients.clear();
  profiles = ["a", "b"].map((id) => ({ id, kind: "local", name: id }));
  runtimes = [runtime("a"), runtime("b")];
  mocks.profiles.mockImplementation(async () => ({ profiles, activeProfileID: "none" }));
  mocks.runtimes.mockImplementation(async () => runtimes);
  mocks.connect.mockImplementation(async (id: string) =>
    runtimes.find((item) => item.profileID === id)!,
  );
  mocks.disconnect.mockResolvedValue(undefined);
  mocks.triage.mockImplementation(async (id: string) => triage(id));
  mocks.dispatch.mockImplementation(async ({ profileID }: { profileID: string }) =>
    triage(profileID, true),
  );
  mocks.attention.mockResolvedValue({ complete: true, sessions: [], requests: [] });
  Object.defineProperty(window, "palot", {
    configurable: true,
    value: {
      listOpenCodeRuntimes: mocks.runtimes,
      connectOpenCodeProfile: mocks.connect,
      disconnectOpenCodeProfile: mocks.disconnect,
    },
  });
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  controller = new ConnectionOverviewController(queryClient);
  sequence = 0;
});
afterEach(() => {
  stop?.();
  stop = undefined;
  queryClient.clear();
  vi.useRealTimers();
  Reflect.deleteProperty(window, "palot");
});
async function start(ids = ["a", "b"]) {
  controller.setIncluded(ids);
  stop = controller.start();
  await controller.refreshRegistry();
  await Promise.allSettled(ids.map((id) => controller.connect(id)));
}
function emit(type: PalotEvent["type"], data: unknown, gap = false) {
  sequence += gap ? 2 : 1;
  const event = {
    id: `${sequence}`,
    type,
    created: sequence,
    createdAt: sequence,
    receiveSequence: sequence,
    data,
  } as PalotEvent;
  openCodeReconciler(queryClient).applyBatch({
    connectionID: "a-1",
    contractVersion: "test",
    streamEpoch: 1,
    batchSequence: sequence,
    receivedAt: sequence,
    sentAt: sequence,
    events: [event],
  } as PalotEventBatch);
}

describe("connection overview", () => {
  it("honors failed attention cooldown while projecting permission events immediately", async () => {
    vi.useFakeTimers();
    client("a");
    mocks.attention.mockResolvedValue({ complete: false, sessions: [], requests: [] });
    await start(["a"]);
    mocks.attention.mockClear();
    for (let index = 0; index < 3; index++) {
      emit("permission.asked", {
        id: `request-${index}`,
        sessionID: "same",
        action: "read",
        resources: [],
      });
      await vi.advanceTimersByTimeAsync(50);
    }
    expect(controller.getSnapshot()[0]?.inbox.inbox[0]?.attentionCount).toBe(3);
    expect(mocks.attention).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(4_850);
    expect(mocks.attention).toHaveBeenCalledOnce();
    controller.setIncluded([]);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(mocks.attention).toHaveBeenCalledOnce();
  });

  it("bounds retained lookups and retries negative results only after their TTL", async () => {
    vi.useFakeTimers();
    const a = client("a");
    const gate = deferred<void>();
    let active = 0;
    let peak = 0;
    a.session.get.mockImplementation(async () => {
      active++;
      peak = Math.max(peak, active);
      await gate.promise;
      active--;
      throw new Error("missing");
    });
    mocks.triage.mockResolvedValue({
      ...triage("a"),
      sessions: Array.from({ length: 9 }, (_, index) => ({
        ...triage("a", true).sessions[0]!,
        sessionID: `missing-${index}`,
      })),
    });
    const starting = start(["a"]);
    await vi.waitFor(() => expect(a.session.get).toHaveBeenCalledTimes(4));
    gate.resolve();
    await starting;
    expect(peak).toBe(4);
    expect(a.session.get).toHaveBeenCalledTimes(9);
    await controller.refresh("a");
    expect(a.session.get).toHaveBeenCalledTimes(9);
    await vi.advanceTimersByTimeAsync(30_000);
    await controller.refresh("a");
    expect(a.session.get).toHaveBeenCalledTimes(18);
  });

  it("cancels retained lookup workers and does not start queued lookups after disable", async () => {
    const a = client("a");
    const gate = deferred<void>();
    const signals: AbortSignal[] = [];
    a.session.get.mockImplementation(async (_input, options) => {
      signals.push(options!.signal!);
      await gate.promise;
      throw new Error("cancelled");
    });
    mocks.triage.mockResolvedValue({
      ...triage("a"),
      sessions: Array.from({ length: 9 }, (_, index) => ({
        ...triage("a", true).sessions[0]!,
        sessionID: `missing-${index}`,
      })),
    });
    const starting = start(["a"]);
    await vi.waitFor(() => expect(signals).toHaveLength(4));
    controller.setIncluded([]);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
    gate.resolve();
    await starting;
    expect(a.session.get).toHaveBeenCalledTimes(4);
  });

  it("reconciles rename and deletion without rehydrating the connection", async () => {
    const a = client("a");
    await start(["a"]);
    mocks.connect.mockClear();
    mocks.attention.mockClear();
    a.session.list.mockClear();
    a.project.list.mockClear();
    a.session.get.mockResolvedValue({
      ...session("same", "Renamed"),
      time: { created: 1, updated: 10 },
    });
    await controller.rename("a", "same", "Renamed");
    expect(controller.getSnapshot()[0]?.sessions[0]?.title).toBe("Renamed");
    await controller.archive("a", "same");
    expect(controller.getSnapshot()[0]?.sessions).toEqual([]);
    expect(mocks.connect).not.toHaveBeenCalled();
    expect(mocks.attention).not.toHaveBeenCalled();
    expect(a.session.list).not.toHaveBeenCalled();
    expect(a.project.list).not.toHaveBeenCalled();
    expect(a.session.get).toHaveBeenCalledOnce();
  });

  it("projects a live rename without refreshing the connection", async () => {
    vi.useFakeTimers();
    client("a");
    await start(["a"]);
    mocks.connect.mockClear();
    emit("session.renamed", { sessionID: "same", title: "Renamed task" });
    await vi.advanceTimersByTimeAsync(50);
    expect(controller.getSnapshot()[0]?.sessions[0]?.title).toBe("Renamed task");
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it("does not overwrite a live rename with an older pending attention snapshot", async () => {
    vi.useFakeTimers();
    client("a");
    const attention = deferred<PalotAttentionSnapshot>();
    mocks.attention.mockReturnValue(attention.promise);
    const starting = start(["a"]);
    await vi.waitFor(() => expect(controller.getSnapshot()[0]?.phase).toBe("ready"));
    sequence = 2;
    emit("session.renamed", { sessionID: "same", title: "Renamed task" });
    await vi.advanceTimersByTimeAsync(50);
    expect(controller.getSnapshot()[0]?.sessions[0]?.title).toBe("Renamed task");
    attention.resolve({
      complete: true,
      sessions: [mapSession(session("same", "a"))],
      requests: [],
    });
    await starting;
    expect(controller.getSnapshot()[0]?.sessions[0]?.title).toBe("Renamed task");
  });

  it("disconnects an excluded focused server and does not reconnect it on registry refresh", async () => {
    client("a");
    client("b");
    mocks.profiles.mockImplementation(async () => ({ profiles, activeProfileID: "a" }));
    await start();
    mocks.connect.mockClear();
    controller.setIncluded(["b"]);
    expect(mocks.disconnect).toHaveBeenCalledWith("a");
    expect(controller.getSnapshot()[0]).toMatchObject({
      phase: "idle",
      runtime: { connected: false, phase: "stopped" },
      sessions: [expect.objectContaining({ id: "same" })],
    });
    runtimes = [runtime("b")];
    await controller.refreshRegistry();
    expect(mocks.connect).not.toHaveBeenCalled();
    expect(controller.getSnapshot()[0]?.runtime?.connected).toBe(false);
    runtimes = [runtime("a", "a-2"), runtime("b")];
    client("a", "a-2");
    controller.setIncluded(["a", "b"]);
    await controller.connect("a");
    expect(controller.getSnapshot()[0]).toMatchObject({
      phase: "ready",
      runtime: { connectionID: "a-2", connected: true },
    });
  });

  it("marks external attention incomplete until queued lineage snapshots finish", async () => {
    vi.useFakeTimers();
    client("a");
    await start(["a"]);
    await vi.advanceTimersByTimeAsync(1_000);
    const snapshot = deferred<PalotAttentionSnapshot>();
    const response = (ids: string[]): PalotAttentionSnapshot => ({
      complete: true,
      sessions: ids.map((id) => mapSession(session(id))),
      requests: ids.map((id) => ({
        sessionID: id,
        value: {
          permissions: [{ id: `request-${id}`, sessionID: id, action: "read", resources: [] }],
          forms: [],
          inbox: [],
          errors: [],
        },
      })),
    });
    mocks.attention
      .mockReturnValueOnce(snapshot.promise)
      .mockResolvedValue(response(["external", "another"]));
    emit("permission.asked", {
      id: "request-external",
      sessionID: "external",
      action: "read",
      resources: [],
    });
    expect(controller.getSnapshot()[0]?.attentionState).toBe("syncing");
    await vi.advanceTimersByTimeAsync(50);
    emit("permission.asked", {
      id: "request-another",
      sessionID: "another",
      action: "read",
      resources: [],
    });
    await vi.advanceTimersByTimeAsync(50);
    snapshot.resolve(response(["external"]));
    await vi.advanceTimersByTimeAsync(0);
    expect(controller.getSnapshot()[0]?.attentionState).toBe("syncing");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(controller.getSnapshot()[0]?.attentionState).toBe("ready");
    expect(
      controller
        .getSnapshot()[0]
        ?.inbox.inbox.filter((item) => item.attention)
        .map((item) => item.session.id)
        .sort(),
    ).toEqual(["another", "external"]);
  });

  it("publishes recent tasks and attention before project labels finish loading", async () => {
    const a = client("a");
    const labels = deferred<never[]>();
    a.project.list.mockReturnValue(labels.promise);
    const loading = start(["a"]);
    await vi.waitFor(() => {
      expect(controller.getSnapshot()[0]).toMatchObject({
        phase: "ready",
        attentionState: "ready",
        projects: [],
        sessions: [expect.objectContaining({ id: "same" })],
      });
    });
    labels.resolve([]);
    await loading;
  });

  it("keeps pending items on partial attention and retries without refetching project metadata", async () => {
    vi.useFakeTimers();
    const a = client("a");
    mocks.attention.mockResolvedValue({
      complete: true,
      sessions: [],
      requests: [
        {
          sessionID: "same",
          value: {
            permissions: [{ id: "waiting", sessionID: "same", action: "read", resources: [] }],
            forms: [],
            inbox: [],
            errors: [],
          },
        },
      ],
    });
    await start(["a"]);
    mocks.attention.mockResolvedValueOnce({ complete: false, sessions: [], requests: [] });
    await controller.refresh("a");
    expect(controller.getSnapshot()[0]?.attentionState).toBe("error");
    expect(controller.getSnapshot()[0]?.inbox.inbox[0]?.attention).toBe(true);
    a.project.list.mockClear();
    mocks.attention.mockResolvedValue({ complete: true, sessions: [], requests: [] });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(controller.getSnapshot()[0]?.attentionState).toBe("ready");
    expect(a.project.list).not.toHaveBeenCalled();
  });

  it("loads a project filter on its owner and reuses its summary query", async () => {
    const a = client("a");
    const b = client("b");
    await start();
    a.session.list.mockClear();
    b.session.list.mockClear();
    b.session.list.mockResolvedValueOnce({
      data: [session("older", "Remote older task")],
      cursor: {},
    });

    await Promise.all([
      controller.loadProject("b", "project"),
      controller.loadProject("b", "project"),
    ]);

    expect(a.session.list).not.toHaveBeenCalled();
    expect(b.session.list).toHaveBeenCalledExactlyOnceWith(
      { parentID: null, project: "project", limit: 100 },
      { signal: expect.any(AbortSignal) },
    );
    expect(controller.getSnapshot().find((entry) => entry.profile.id === "b")?.sessions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "older", title: "Remote older task" }),
      ]),
    );
    expect(
      controller
        .getSnapshot()
        .find((entry) => entry.profile.id === "a")
        ?.sessions.map((entry) => entry.id),
    ).toEqual(["same"]);
    expect(b.message.list).not.toHaveBeenCalled();
    await controller.loadProject("b", "project");
    expect(b.session.list).toHaveBeenCalledOnce();
  });

  it("starts a fresh registry load after setup-cleanup-setup without stale finalizers clearing it", async () => {
    client("a");
    client("b");
    const obsolete = deferred<OpenCodeProfileSnapshot>();
    const current = deferred<OpenCodeProfileSnapshot>();
    mocks.profiles.mockReturnValueOnce(obsolete.promise).mockReturnValueOnce(current.promise);
    controller.setIncluded(["a"]);
    const cleanup = controller.start();
    const oldRegistry = controller.refreshRegistry();
    expect(mocks.profiles).toHaveBeenCalledTimes(1);

    cleanup();
    stop = controller.start();
    expect(mocks.profiles).toHaveBeenCalledTimes(2);
    expect(mocks.runtimes).toHaveBeenCalledTimes(2);

    obsolete.resolve({
      activeProfileID: "none",
      profiles: [{ id: "obsolete", kind: "local", name: "Obsolete" }],
    });
    await oldRegistry;
    expect(controller.getSnapshot()).toEqual([]);
    expect(mocks.connect).not.toHaveBeenCalled();

    // The old finalizer must leave the second generation's in-flight request deduplicated.
    const freshRegistry = controller.refreshRegistry();
    expect(mocks.profiles).toHaveBeenCalledTimes(2);
    current.resolve({ activeProfileID: "none", profiles });
    await freshRegistry;
    await vi.waitFor(() => expect(controller.getSnapshot()[0]?.phase).toBe("ready"));
    expect(controller.getSnapshot().map((entry) => entry.profile.id)).toEqual(["a", "b"]);
    expect(mocks.connect).toHaveBeenCalledExactlyOnceWith("a");
  });

  it("starts profiles independently and isolates duplicate session/project IDs without fetching messages", async () => {
    const a = client("a");
    const b = client("b");
    await start();
    expect(
      controller
        .getSnapshot()
        .map((entry) => [entry.phase, entry.sessions[0]?.title, entry.projects[0]?.name]),
    ).toEqual([
      ["ready", "a", "a"],
      ["ready", "b", "b"],
    ]);
    expect(a.message.list).not.toHaveBeenCalled();
    expect(b.message.list).not.toHaveBeenCalled();
    expect(mocks.attention.mock.calls.map((args) => args[1]).sort()).toEqual(["a-1", "b-1"]);
    await controller.refreshRegistry();
    expect(a.project.list).toHaveBeenCalledTimes(1);
    expect(a.session.active).toHaveBeenCalledTimes(1);
    expect(mocks.connect).toHaveBeenCalledTimes(2);
  });

  it("isolates connection failures", async () => {
    client("a");
    client("b");
    mocks.connect.mockImplementation(async (id: string) => {
      if (id === "a") throw new Error("offline");
      return runtime(id);
    });
    await start();
    expect(controller.getSnapshot().map((entry) => entry.phase)).toEqual(["error", "ready"]);
  });

  it("does not resurrect removed profiles when a connection resolves late", async () => {
    client("a");
    client("b");
    const pending = deferred<OpenCodeRuntimeStatus>();
    mocks.connect.mockReturnValue(pending.promise);
    await controller.refreshRegistry();
    controller.setIncluded(["a"]);
    profiles = profiles.filter((profile) => profile.id !== "a");
    await controller.refreshRegistry();
    pending.resolve(runtime("a"));
    await pending.promise;
    await Promise.resolve();
    expect(controller.getSnapshot().map((entry) => entry.profile.id)).toEqual(["b"]);
    expect(mocks.triage).not.toHaveBeenCalled();
  });

  it("invalidates triage loads and stops monitoring while preserving cached rows", async () => {
    client("a");
    client("b");
    await start(["a"]);
    const pending = deferred<SessionTriageSnapshot>();
    mocks.triage.mockReturnValue(pending.promise);
    const refresh = controller.refresh("a");
    await vi.waitFor(() => expect(mocks.triage).toHaveBeenCalledTimes(2));
    const sessions = controller.getSnapshot()[0]!.sessions;
    controller.setIncluded([]);
    pending.resolve(triage("a", true));
    await refresh;
    expect(mocks.disconnect).toHaveBeenCalledWith("a");
    expect(controller.getSnapshot()[0]).toMatchObject({
      phase: "idle",
      runtime: { connected: false, phase: "stopped" },
    });
    expect(controller.getSnapshot()[0]!.sessions).toBe(sessions);
    expect(controller.getSnapshot()[0]!.inbox.pinned).toHaveLength(0);
    await controller.refreshRegistry();
    expect(controller.getSnapshot()[0]!.sessions).toBe(sessions);
  });

  it("drops old lifecycle triage snapshots after replacement", async () => {
    client("a");
    client("b");
    await start(["a"]);
    const pending = deferred<SessionTriageSnapshot>();
    mocks.triage.mockReturnValueOnce(pending.promise);
    const refresh = controller.refresh("a");
    await vi.waitFor(() => expect(mocks.triage).toHaveBeenCalledTimes(2));
    client("a", "a-2");
    runtimes = [runtime("a", "a-2"), runtime("b")];
    await controller.refreshRegistry();
    await controller.connect("a");
    pending.resolve(triage("a", true));
    await refresh;
    expect(controller.getSnapshot()[0]!.runtime?.connectionID).toBe("a-2");
    expect(controller.getSnapshot()[0]!.inbox.pinned).toHaveLength(0);
  });

  it("serializes targeted triage mutations and does not overwrite them with an older load", async () => {
    client("a");
    client("b");
    await start();
    const load = deferred<SessionTriageSnapshot>();
    mocks.triage.mockReturnValueOnce(load.promise);
    const refresh = controller.refresh("a");
    await vi.waitFor(() => expect(mocks.triage).toHaveBeenCalledTimes(3));
    const first = deferred<SessionTriageSnapshot>();
    mocks.dispatch.mockReturnValueOnce(first.promise);
    const pin = controller.dispatch("a", { type: "pin", sessionID: "same", at: 2 });
    const markInbox = controller.dispatch("a", { type: "inbox", sessionID: "same", at: 3 });
    await vi.waitFor(() => expect(mocks.dispatch).toHaveBeenCalledTimes(1));
    expect(mocks.dispatch).toHaveBeenNthCalledWith(1, {
      profileID: "a",
      type: "pin",
      sessionID: "same",
      at: 2,
    });
    first.resolve(triage("a", true));
    await pin;
    await markInbox;
    load.resolve(triage("a"));
    await refresh;
    expect(mocks.dispatch).toHaveBeenNthCalledWith(2, {
      profileID: "a",
      type: "inbox",
      sessionID: "same",
      at: 3,
    });
    expect(controller.getSnapshot()[0]!.inbox.pinned).toHaveLength(1);
    expect(controller.getSnapshot()[1]!.inbox.pinned).toHaveLength(0);
  });

  it("hydrates retained active and pinned metadata beyond the root page without messages", async () => {
    const a = client("a");
    client("b");
    a.session.active.mockResolvedValue({ outside: true });
    mocks.triage.mockResolvedValue({
      ...triage("a", true),
      sessions: triage("a", true).sessions.map((row) => ({ ...row, sessionID: "pinned-outside" })),
    });
    await start(["a"]);
    expect(
      controller
        .getSnapshot()[0]!
        .sessions.map((row) => row.id)
        .sort(),
    ).toEqual(["outside", "pinned-outside", "same"]);
    expect(a.session.get.mock.calls.map(([input]) => input.sessionID).sort()).toEqual([
      "outside",
      "pinned-outside",
    ]);
    expect(a.message.list).not.toHaveBeenCalled();
  });

  it("stops pagination at repeated cursors", async () => {
    const a = client("a");
    client("b");
    a.session.list.mockResolvedValue({ data: [session()], cursor: { next: "repeat" } });
    await start(["a"]);
    expect(controller.getSnapshot()[0]!.hasMore).toBe(true);
    await controller.loadMore("a");
    await controller.loadMore("a");
    expect(a.session.list).toHaveBeenCalledTimes(2);
    expect(controller.getSnapshot()[0]!.hasMore).toBe(false);
  });

  it("retains attention session metadata absent from the first page across refresh", async () => {
    const a = client("a");
    client("b");
    mocks.attention.mockResolvedValue({
      complete: true,
      sessions: [mapSession(session("attention"))],
      requests: [
        {
          sessionID: "attention",
          value: {
            permissions: [
              { id: "permission", sessionID: "attention", action: "shell", resources: [] },
            ],
            forms: [],
            inbox: [],
            errors: [],
          },
        },
      ],
    });
    await start(["a"]);
    await controller.refresh("a");
    expect(
      controller
        .getSnapshot()[0]!
        .sessions.map((row) => row.id)
        .sort(),
    ).toEqual(["attention", "same"]);
    expect(
      controller.getSnapshot()[0]!.inbox.inbox.find((row) => row.session.id === "attention")
        ?.attention,
    ).toBe(true);
    expect(a.message.list).not.toHaveBeenCalled();
  });

  it("drops late searches and pagination when monitoring is disabled", async () => {
    const a = client("a");
    client("b");
    a.session.list.mockResolvedValueOnce({ data: [session()], cursor: { next: "next" } });
    await start(["a"]);
    const page = deferred<{ data: SessionInfo[]; cursor: Record<string, string> }>();
    a.session.list.mockReturnValue(page.promise);
    const search = controller.search("late");
    const more = controller.loadMore("a");
    controller.setIncluded([]);
    page.resolve({ data: [session("late")], cursor: {} });
    await Promise.all([search, more]);
    expect(controller.getSnapshot()[0]!.sessions.map((row) => row.id)).toEqual(["same"]);
    expect(controller.getSnapshot()[0]!.loadingMore).toBe(false);
    expect(
      openCodeReconciler(queryClient)
        .sessions("a-1")
        .map((row) => row.id),
    ).toEqual(["same"]);
  });

  it("ignores text/status noise, upgrades pending projection to repair, and repairs reconnects", async () => {
    const a = client("a");
    client("b");
    await start(["a"]);
    // Establish the stream before measuring subsequent ordinary batches.
    emit("palot.runtime.status", runtime("a"));
    await new Promise((resolve) => setTimeout(resolve, 100));
    await controller.connect("a");
    mocks.connect.mockClear();
    a.session.list.mockClear();
    a.session.active.mockClear();
    emit("session.text.delta", {
      sessionID: "same",
      assistantMessageID: "message",
      ordinal: 0,
      delta: "hello",
    });
    emit("palot.runtime.status", runtime("a"));
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(mocks.connect).not.toHaveBeenCalled();
    expect(a.session.active).not.toHaveBeenCalled();
    emit("session.renamed", { sessionID: "same", title: "Renamed" });
    emit("session.status", { sessionID: "same", status: { type: "idle" } }, true);
    await vi.waitFor(() => expect(a.session.active).toHaveBeenCalledTimes(1));
    expect(a.session.list).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(controller.getSnapshot()[0]!.phase).toBe("ready"));
    emit("palot.runtime.status", { ...runtime("a"), connected: false, phase: "reconnecting" });
    emit("palot.runtime.status", runtime("a"));
    await vi.waitFor(() => expect(a.session.active).toHaveBeenCalledTimes(2));
  });

  it("reuses project and task summaries across token-only changes", async () => {
    client("a");
    client("b");
    await start(["a"]);
    const before = controller.getSnapshot()[0]!;
    seedSessionDetails(queryClient, "a-1", [
      {
        ...session("same", "a"),
        time: { created: 1, updated: 2 },
        cost: 5,
        tokens: { input: 100, output: 200, reasoning: 10, cache: { read: 0, write: 0 } },
      },
    ]);
    controller.acceptTriage(triage("a"));
    const after = controller.getSnapshot()[0]!;
    expect(after.sessions).toBe(before.sessions);
    expect(after.projects).toBe(before.projects);
    expect(after.inbox).toBe(before.inbox);
  });
});
