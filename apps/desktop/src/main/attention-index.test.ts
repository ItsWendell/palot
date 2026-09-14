import type {
  OpenCodeClient,
  OpenCodeEvent,
  PermissionRequest,
  SessionInfo,
} from "@opencode/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AttentionSnapshotInput, PalotSession } from "../shared";
import { OpenCodeAttentionIndex } from "./attention-index";

let now = 0;
beforeEach(() => {
  now = 1_000;
  vi.spyOn(Date, "now").mockImplementation(() => now);
});
afterEach(() => vi.restoreAllMocks());

function session(): PalotSession {
  return {
    id: "session-1",
    parentID: null,
    projectID: "project-1",
    title: "Task",
    agent: null,
    model: null,
    location: { directory: "/repo" },
    createdAt: 1,
    updatedAt: 1,
    archivedAt: null,
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  };
}

function input(): AttentionSnapshotInput {
  return {
    connectionID: "connection",
    sessions: [session()],
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function runtime(client: OpenCodeClient, connectionID = "connection", autoReady = true) {
  let reconnect: (client: OpenCodeClient) => void | Promise<void> = () => undefined;
  const listeners = new Set<(event?: OpenCodeEvent) => void>();
  let streamVersion = 0;
  const streamErrors = new Map<number, Error>();
  const streams = {
    subscribe: ({ signal }: { signal: AbortSignal }) => ({
      async *[Symbol.asyncIterator]() {
        const version = streamVersion;
        const queued: OpenCodeEvent[] = autoReady
          ? [{ type: "server.connected" } as OpenCodeEvent]
          : [];
        let wake: () => void = () => undefined;
        const listener = (event?: OpenCodeEvent) => {
          if (event) queued.push(event);
          wake();
        };
        listeners.add(listener);
        const abort = () => listener();
        signal.addEventListener("abort", abort, { once: true });
        try {
          while (!signal.aborted && version === streamVersion) {
            const event = queued.shift();
            if (event) yield event;
            else
              await new Promise<void>((resolve) => {
                wake = resolve;
              });
          }
          const failure = streamErrors.get(version);
          if (failure) throw failure;
        } finally {
          listeners.delete(listener);
          signal.removeEventListener("abort", abort);
        }
      },
    }),
  };
  Object.assign(client, {
    event: streams,
    debug: { location: { list: vi.fn().mockResolvedValue([{ directory: "/repo" }]) } },
  });
  return {
    client,
    value: {
      runtimeStatus: () => ({ connectionID }),
      withClient: <T>(operation: (value: OpenCodeClient) => Promise<T>) => operation(client),
      onReconnect: (listener: (client: OpenCodeClient) => void | Promise<void>) => {
        reconnect = listener;
        return () => undefined;
      },
    },
    emit: async (event: OpenCodeEvent) => {
      for (const listener of listeners) listener(event);
      await Promise.resolve();
      await Promise.resolve();
    },
    reconnect: () => reconnect(client),
    end: async (error?: Error) => {
      if (error) streamErrors.set(streamVersion, error);
      streamVersion += 1;
      for (const listener of listeners) listener();
      await Promise.resolve();
      await Promise.resolve();
    },
  };
}

function permission(id = "permission-1", sessionID = "session-1"): PermissionRequest {
  return { id, sessionID, action: "read", resources: ["README.md"] };
}

function metadata(id: string, parentID?: string): SessionInfo {
  return {
    ...session(),
    id,
    parentID,
    time: { created: 1, updated: 1 },
  } as unknown as SessionInfo;
}

function clientWithRequests(requests: PermissionRequest[] = []) {
  return {
    permission: { request: { list: vi.fn().mockResolvedValue({ data: requests }) } },
    form: { request: { list: vi.fn().mockResolvedValue({ data: [] }) } },
    session: { get: vi.fn(async ({ sessionID }: { sessionID: string }) => metadata(sessionID)) },
  };
}

describe("OpenCodeAttentionIndex", () => {
  it("lets a new permission event retry missing lineage without bypassing discovery cooldown", async () => {
    const client = clientWithRequests([permission("initial", "child")]);
    client.session.get.mockRejectedValueOnce(new Error("temporarily unavailable"));
    const source = runtime(client as unknown as OpenCodeClient);
    const index = new OpenCodeAttentionIndex(source.value);
    await expect(index.snapshot(input())).resolves.toMatchObject({ complete: false });
    await index.snapshot(input());
    expect(client.session.get).toHaveBeenCalledOnce();
    await source.emit({
      type: "permission.asked",
      data: permission("new", "child"),
    } as OpenCodeEvent);
    await expect(index.snapshot(input())).resolves.toMatchObject({ sessions: [{ id: "child" }] });
    expect(client.session.get).toHaveBeenCalledTimes(2);
    expect(source.client.debug.location.list).toHaveBeenCalledOnce();
    index.dispose();
  });

  it("coalesces discovery refreshes and delivers authoritative requests during failure cooldown", async () => {
    const client = clientWithRequests();
    const source = runtime(client as unknown as OpenCodeClient);
    const index = new OpenCodeAttentionIndex(source.value);
    await index.snapshot(input());
    await index.snapshot(input());
    expect(source.client.debug.location.list).toHaveBeenCalledOnce();
    now += 1_000;
    vi.mocked(source.client.debug.location.list).mockRejectedValueOnce(
      new Error("offline discovery"),
    );
    await expect(index.snapshot(input())).resolves.toMatchObject({ complete: false });
    await source.emit({
      type: "permission.asked",
      location: { directory: "/repo" },
      data: permission("urgent", "child"),
    } as OpenCodeEvent);
    await expect(index.snapshot(input())).resolves.toMatchObject({
      complete: false,
      sessions: [{ id: "child" }],
      requests: [{ sessionID: "child", value: { permissions: [{ id: "urgent" }] } }],
    });
    expect(client.session.get).toHaveBeenCalledOnce();
    expect(source.client.debug.location.list).toHaveBeenCalledTimes(2);
    await source.emit({
      type: "permission.replied",
      data: { sessionID: "child", requestID: "urgent", reply: "once" },
    } as OpenCodeEvent);
    await expect(index.snapshot(input())).resolves.toMatchObject({ requests: [] });
    now += 5_000;
    await expect(index.snapshot(input())).resolves.toMatchObject({ complete: true });
    expect(source.client.debug.location.list).toHaveBeenCalledTimes(3);
    index.dispose();
  });

  it("does not self-notify into a retry loop when subscription startup fails", async () => {
    const source = runtime(clientWithRequests() as unknown as OpenCodeClient);
    source.client.event.subscribe = () => ({
      [Symbol.asyncIterator]: () => ({
        next: async () => {
          throw new Error("stream offline");
        },
      }),
    });
    const index = new OpenCodeAttentionIndex(source.value);
    const listener = vi.fn();
    index.subscribe(listener);
    await expect(index.snapshot(input())).rejects.toThrow("connection changed");
    expect(listener).not.toHaveBeenCalled();
    expect(source.client.debug.location.list).not.toHaveBeenCalled();
    index.dispose();
  });
  it("bounds loaded scans and lineage fetches independently", async () => {
    const client = clientWithRequests(
      Array.from({ length: 24 }, (_, i) => permission(`request-${i}`, `session-${i}`)),
    );
    const source = runtime(client as unknown as OpenCodeClient);
    vi.mocked(source.client.debug.location.list).mockResolvedValue(
      Array.from({ length: 24 }, (_, i) => ({ directory: `/loaded/${i}` })),
    );
    let activeLists = 0;
    let peakLists = 0;
    let activeMetadata = 0;
    let peakMetadata = 0;
    client.form.request.list.mockImplementation(async () => {
      peakLists = Math.max(peakLists, ++activeLists);
      await Promise.resolve();
      activeLists -= 1;
      return { data: [] };
    });
    client.session.get.mockImplementation(async ({ sessionID }) => {
      peakMetadata = Math.max(peakMetadata, ++activeMetadata);
      await Promise.resolve();
      activeMetadata -= 1;
      return metadata(sessionID);
    });
    const index = new OpenCodeAttentionIndex(source.value);
    await expect(index.snapshot({ ...input(), sessions: [] })).resolves.toMatchObject({
      complete: true,
    });
    expect(peakLists).toBe(4);
    expect(peakMetadata).toBe(4);
    expect(client.session.get).toHaveBeenCalledTimes(24);
    index.dispose();
  });

  it("does not revive deleted sessions from pending metadata and terminates cyclic lineage", async () => {
    const client = clientWithRequests([permission("request", "child")]);
    const source = runtime(client as unknown as OpenCodeClient);
    const pending = deferred<SessionInfo>();
    client.session.get.mockReturnValueOnce(pending.promise);
    const index = new OpenCodeAttentionIndex(source.value);
    const snapshot = index.snapshot(input());
    await vi.waitFor(() => expect(client.session.get).toHaveBeenCalledOnce());
    await source.emit({ type: "session.deleted", data: { sessionID: "child" } } as OpenCodeEvent);
    pending.resolve(metadata("child"));
    await expect(snapshot).resolves.toMatchObject({ requests: [], sessions: [] });
    client.session.get.mockImplementation(async ({ sessionID }) =>
      metadata(sessionID, sessionID === "a" ? "b" : "a"),
    );
    await source.emit({
      type: "permission.asked",
      location: { directory: "/repo" },
      data: permission("cycle", "a"),
    } as OpenCodeEvent);
    await expect(index.snapshot(input())).resolves.toMatchObject({
      complete: false,
      sessions: [{ id: "a" }, { id: "b" }],
    });
    expect(client.session.get).toHaveBeenCalledTimes(3);
    index.dispose();
  });

  it("retains forms when only their list fails while applying authoritative permission results", async () => {
    const client = clientWithRequests([permission()]);
    client.form.request.list.mockResolvedValue({
      data: [{ id: "form", sessionID: "session-1" }],
    } as never);
    const source = runtime(client as unknown as OpenCodeClient);
    const index = new OpenCodeAttentionIndex(source.value);
    await index.snapshot(input());
    source.reconnect();
    client.permission.request.list.mockResolvedValue({ data: [] });
    client.form.request.list.mockRejectedValueOnce(new Error("forms down"));
    await expect(index.snapshot(input())).resolves.toMatchObject({
      complete: false,
      requests: [{ value: { permissions: [], forms: [{ id: "form" }] } }],
    });
    client.form.request.list.mockResolvedValue({ data: [] });
    now += 5_000;
    await expect(index.snapshot(input())).resolves.toMatchObject({ complete: true, requests: [] });
    index.dispose();
  });
  it("discovers only loaded refs, never hundreds of historical or missing directories", async () => {
    const client = clientWithRequests([permission("external", "child")]);
    client.session.get.mockImplementation(async ({ sessionID }) =>
      metadata(sessionID, sessionID === "child" ? "root" : undefined),
    );
    const source = runtime(client as unknown as OpenCodeClient);
    const index = new OpenCodeAttentionIndex(source.value);
    const snapshot = await index.snapshot({
      ...input(),
      sessions: Array.from({ length: 400 }, (_, i) => ({
        ...session(),
        id: `old-${i}`,
        location: { directory: `/missing/${i}` },
      })),
    });
    expect(snapshot.complete).toBe(true);
    expect(snapshot.sessions.map((item) => item.id)).toEqual(["child", "root"]);
    expect(client.permission.request.list.mock.calls).toMatchObject([
      [{ location: { directory: "/repo" } }, { signal: expect.anything() }],
    ]);
    expect(client.session.get.mock.calls.map(([arg]) => arg.sessionID)).toEqual(["child", "root"]);
    index.dispose();
  });

  it("waits for server.connected before discovering loaded refs", async () => {
    const source = runtime(clientWithRequests() as unknown as OpenCodeClient, "connection", false);
    const index = new OpenCodeAttentionIndex(source.value);
    const snapshot = index.snapshot(input());
    await Promise.resolve();
    expect(source.client.debug.location.list).not.toHaveBeenCalled();
    await source.emit({ type: "server.connected" } as OpenCodeEvent);
    await expect(snapshot).resolves.toMatchObject({ complete: true });
    index.dispose();
  });

  it("protects replies during enumeration and creates during a list", async () => {
    const client = clientWithRequests();
    const source = runtime(client as unknown as OpenCodeClient);
    const locations = deferred<[{ directory: string }]>();
    vi.mocked(source.client.debug.location.list).mockReturnValueOnce(locations.promise);
    const requests = deferred<{ data: PermissionRequest[] }>();
    client.permission.request.list.mockReturnValueOnce(requests.promise);
    const index = new OpenCodeAttentionIndex(source.value);
    const snapshot = index.snapshot(input());
    await vi.waitFor(() => expect(source.client.debug.location.list).toHaveBeenCalledOnce());
    await source.emit({
      type: "permission.replied",
      data: { sessionID: "session-1", requestID: "old", reply: "once" },
    } as OpenCodeEvent);
    locations.resolve([{ directory: "/repo" }]);
    await vi.waitFor(() => expect(client.permission.request.list).toHaveBeenCalledOnce());
    await source.emit({
      type: "permission.asked",
      location: { directory: "/repo" },
      data: permission("new"),
    } as OpenCodeEvent);
    requests.resolve({ data: [permission("old")] });
    expect((await snapshot).requests[0]?.value.permissions.map((item) => item.id)).toEqual(["new"]);
    index.dispose();
  });

  it("retains pending on discovery/list failures, retries and prunes evicted refs", async () => {
    const client = clientWithRequests([permission()]);
    const source = runtime(client as unknown as OpenCodeClient);
    const index = new OpenCodeAttentionIndex(source.value);
    await expect(index.snapshot(input())).resolves.toMatchObject({ complete: true });
    vi.mocked(source.client.debug.location.list).mockRejectedValueOnce(new Error("debug missing"));
    now += 1_000;
    await expect(index.snapshot(input())).resolves.toMatchObject({
      complete: false,
      requests: [{ sessionID: "session-1" }],
    });
    source.reconnect();
    client.permission.request.list.mockRejectedValueOnce(new Error("permissions unavailable"));
    await expect(index.snapshot(input())).resolves.toMatchObject({
      complete: false,
      requests: [{ sessionID: "session-1" }],
    });
    now += 5_000;
    await expect(index.snapshot(input())).resolves.toMatchObject({
      complete: true,
      requests: [{ sessionID: "session-1" }],
    });
    vi.mocked(source.client.debug.location.list).mockResolvedValueOnce([]);
    now += 1_000;
    await expect(index.snapshot(input())).resolves.toMatchObject({ complete: true, requests: [] });
    index.dispose();
  });

  it("fences a pending old fetch after reconnect to the same connection ID", async () => {
    const client = clientWithRequests();
    const source = runtime(client as unknown as OpenCodeClient);
    const old = deferred<{ data: PermissionRequest[] }>();
    client.permission.request.list.mockReturnValueOnce(old.promise);
    const index = new OpenCodeAttentionIndex(source.value);
    const previous = index.snapshot(input());
    const rejected = expect(previous).rejects.toThrow("connection changed");
    await vi.waitFor(() => expect(client.permission.request.list).toHaveBeenCalledOnce());
    source.reconnect();
    await expect(index.snapshot(input())).resolves.toMatchObject({ complete: true, requests: [] });
    old.resolve({ data: [permission("stale")] });
    await rejected;
    await expect(index.snapshot(input())).resolves.toMatchObject({ complete: true, requests: [] });
    index.dispose();
  });

  it.each([undefined, new Error("Event subscriber exceeded its 4096-event capacity")])(
    "invalidates cached scans after stream termination (%s) without clearing known pending",
    async (error) => {
      const client = clientWithRequests([permission()]);
      const source = runtime(client as unknown as OpenCodeClient);
      const index = new OpenCodeAttentionIndex(source.value);
      await index.snapshot(input());
      await source.end(error);
      client.permission.request.list.mockRejectedValueOnce(new Error("offline"));
      await expect(index.snapshot(input())).resolves.toMatchObject({
        complete: false,
        requests: [{ sessionID: "session-1" }],
      });
      client.permission.request.list.mockResolvedValue({ data: [] });
      now += 5_000;
      await expect(index.snapshot(input())).resolves.toMatchObject({
        complete: true,
        requests: [],
      });
      index.dispose();
    },
  );

  it("does not hydrate unowned global forms and retries missing lineage", async () => {
    const client = clientWithRequests([permission("child", "child")]);
    client.form.request.list.mockResolvedValue({
      data: [{ id: "global-form", sessionID: "global" }],
    } as never);
    client.session.get.mockRejectedValueOnce(new Error("metadata unavailable"));
    const source = runtime(client as unknown as OpenCodeClient);
    const index = new OpenCodeAttentionIndex(source.value);
    await expect(index.snapshot(input())).resolves.toMatchObject({ complete: false });
    await expect(index.snapshot(input())).resolves.toMatchObject({ complete: false });
    expect(client.session.get).toHaveBeenCalledOnce();
    now += 30_000;
    await expect(index.snapshot(input())).resolves.toMatchObject({
      complete: true,
      sessions: [{ id: "child" }],
    });
    expect(client.session.get.mock.calls.map(([arg]) => arg.sessionID)).toEqual(["child", "child"]);
    index.dispose();
  });

  it("keeps workspace refs distinct and preserves a new location event during enumeration", async () => {
    const client = clientWithRequests();
    const source = runtime(client as unknown as OpenCodeClient);
    vi.mocked(source.client.debug.location.list).mockResolvedValue([
      { directory: "/repo", workspaceID: "a" },
      { directory: "/repo", workspaceID: "b" },
    ]);
    const index = new OpenCodeAttentionIndex(source.value);
    await index.snapshot(input());
    expect(client.permission.request.list).toHaveBeenCalledTimes(2);
    expect(client.permission.request.list).toHaveBeenCalledWith(
      { location: { directory: "/repo", workspace: "a" } },
      expect.anything(),
    );
    expect(client.permission.request.list).toHaveBeenCalledWith(
      { location: { directory: "/repo", workspace: "b" } },
      expect.anything(),
    );
    const locations = deferred<[]>();
    vi.mocked(source.client.debug.location.list).mockReturnValueOnce(locations.promise);
    const snapshot = index.snapshot(input());
    await source.emit({
      type: "permission.asked",
      location: { directory: "/other" },
      data: permission("new"),
    } as OpenCodeEvent);
    locations.resolve([]);
    await expect(snapshot).resolves.toMatchObject({
      requests: [{ value: { permissions: [{ id: "new" }] } }],
    });
    expect(client.permission.request.list).toHaveBeenCalledTimes(2);
    index.dispose();
  });
  it("keeps equal request/session IDs isolated across connection-scoped indexes", async () => {
    const create = (connectionID: string, resource: string) => {
      const source = runtime(
        {
          permission: {
            request: {
              list: vi.fn().mockResolvedValue({
                data: [
                  {
                    id: "same-request",
                    sessionID: "session-1",
                    action: "read",
                    resources: [resource],
                  },
                ],
              }),
            },
          },
          form: { request: { list: vi.fn().mockResolvedValue({ data: [] }) } },
        } as unknown as OpenCodeClient,
        connectionID,
      );
      return new OpenCodeAttentionIndex(source.value);
    };
    const first = create("first", "first.txt");
    const second = create("second", "second.txt");
    const [a, b] = await Promise.all([
      first.snapshot({ ...input(), connectionID: "first" }),
      second.snapshot({ ...input(), connectionID: "second" }),
    ]);
    expect(a.requests[0]?.value.permissions[0]?.resources).toEqual(["first.txt"]);
    expect(b.requests[0]?.value.permissions[0]?.resources).toEqual(["second.txt"]);
    await expect(first.snapshot({ ...input(), connectionID: "second" })).rejects.toThrow(
      "does not match",
    );
    first.dispose();
    second.dispose();
  });
  it("shares one in-flight location scan between callers", async () => {
    const permissions = deferred<{ data: PermissionRequest[] }>();
    const listPermissions = vi.fn(() => permissions.promise);
    const listForms = vi.fn().mockResolvedValue({ data: [] });
    const source = runtime({
      permission: { request: { list: listPermissions } },
      form: { request: { list: listForms } },
    } as unknown as OpenCodeClient);
    const index = new OpenCodeAttentionIndex(source.value as never);

    const first = index.snapshot(input());
    const second = index.snapshot(input());
    permissions.resolve({
      data: [
        {
          id: "permission-1",
          sessionID: "session-1",
          action: "read",
          resources: ["README.md"],
        } as PermissionRequest,
      ],
    });

    const [firstSnapshot, secondSnapshot] = await Promise.all([first, second]);
    expect(listPermissions).toHaveBeenCalledOnce();
    expect(listForms).toHaveBeenCalledOnce();
    expect(firstSnapshot.requests).toMatchObject([
      { sessionID: "session-1", value: { permissions: [{ id: "permission-1" }] } },
    ]);
    expect(secondSnapshot).toEqual(firstSnapshot);
    index.dispose();
  });

  it("does not let an older scan resurrect a request removed by a newer event", async () => {
    const permissions = deferred<{ data: PermissionRequest[] }>();
    const source = runtime({
      permission: { request: { list: vi.fn(() => permissions.promise) } },
      form: { request: { list: vi.fn().mockResolvedValue({ data: [] }) } },
    } as unknown as OpenCodeClient);
    const index = new OpenCodeAttentionIndex(source.value as never);

    const snapshot = index.snapshot(input());
    await source.emit({
      id: "permission-replied",
      type: "permission.replied",
      created: 2,
      data: { sessionID: "session-1", requestID: "permission-1", reply: "once" },
    } as OpenCodeEvent);
    permissions.resolve({
      data: [
        {
          id: "permission-1",
          sessionID: "session-1",
          action: "read",
          resources: ["README.md"],
        } as PermissionRequest,
      ],
    });

    await expect(snapshot).resolves.toMatchObject({ requests: [] });
    index.dispose();
  });

  it("retries a location after a partial scan failure", async () => {
    const listForms = vi
      .fn()
      .mockRejectedValueOnce(new Error("forms unavailable"))
      .mockResolvedValue({ data: [] });
    const source = runtime({
      permission: { request: { list: vi.fn().mockResolvedValue({ data: [] }) } },
      form: { request: { list: listForms } },
    } as unknown as OpenCodeClient);
    const index = new OpenCodeAttentionIndex(source.value as never);

    await index.snapshot(input());
    await index.snapshot(input());

    expect(listForms).toHaveBeenCalledTimes(1);
    now += 5_000;
    await index.snapshot(input());

    expect(listForms).toHaveBeenCalledTimes(2);
    index.dispose();
  });
});
