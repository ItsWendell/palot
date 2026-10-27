// @vitest-environment node

import type { OpenCodeEvent } from "@opencode/client";
import type { ClientMcpOptions } from "@opencode/client/mcp";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OpenCodeRuntimeStatus } from "../../shared";

vi.mock("electron-log/main", () => ({
  default: { scope: () => ({ warn: vi.fn(), info: vi.fn() }) },
}));

const { PalotToolHost } = await import("./host");

function status(patch: Partial<OpenCodeRuntimeStatus> = {}): OpenCodeRuntimeStatus {
  return {
    connectionID: "c1",
    profileID: "p1",
    contractVersion: "2.1.4",
    phase: "ready",
    connected: true,
    binaryPath: null,
    version: "2.1.4",
    pid: null,
    managed: false,
    lastConnectedAt: 1,
    error: null,
    versionMismatch: null,
    ...patch,
  } as OpenCodeRuntimeStatus;
}

function setup(
  initial = [status()],
  enabled = { value: true },
  ask = { value: true },
  permissions: Record<string, unknown[]> = {},
) {
  let runtimes = initial;
  let endpoint = "http://127.0.0.1:4096";
  const statusObservers = new Set<(runtime: OpenCodeRuntimeStatus) => void>();
  const eventObservers = new Set<(event: OpenCodeEvent, runtime: OpenCodeRuntimeStatus) => void>();
  const active: Record<string, { type: "running" }> = {};
  const client = {
    session: {
      active: vi.fn(async () => active),
      get: vi.fn(async ({ sessionID }: { sessionID: string }) => ({
        id: sessionID,
        location: { directory: `/work/${sessionID}` },
        permissions: permissions[sessionID] ?? [],
      })),
    },
    permission: { reply: vi.fn(async () => undefined) },
  };
  const open = new Map<string, ClientMcpOptions>();
  const connect = vi.fn((options: ClientMcpOptions) => {
    const key = `${options.url} ${options.directory}`;
    open.set(key, options);
    return { close: vi.fn(async () => void open.delete(key)) };
  });
  let now = 0;
  const host = new PalotToolHost({
    runtime: {
      listRuntimes: () => runtimes,
      onScopedEvent: (observer) => {
        eventObservers.add(observer);
        return () => eventObservers.delete(observer);
      },
      onRuntimeStatus: (observer) => {
        statusObservers.add(observer);
        return () => statusObservers.delete(observer);
      },
      onConnectionDisposed: () => () => undefined,
      requestConnection: async () => ({
        endpoint: { url: endpoint },
        headers: { authorization: "Basic x" },
      }),
      scopedConnection: () => ({
        withClient: (operation) => operation(client as never),
        onEvent: () => () => undefined,
      }),
    },
    connect,
    automations: { load: vi.fn(), dispatch: vi.fn() },
    triage: { load: vi.fn(), dispatch: vi.fn() },
    onTriageChanged: vi.fn(),
    enabled: () => enabled.value,
    askBeforeScheduling: () => ask.value,
    now: () => now,
  });
  return {
    host,
    client,
    connect,
    open,
    active,
    setRuntimes(next: OpenCodeRuntimeStatus[]) {
      runtimes = next;
      for (const observer of statusObservers) observer(next[0] ?? status());
    },
    moveEndpoint(url: string) {
      endpoint = url;
      for (const observer of statusObservers) observer(status());
    },
    emit(event: Partial<OpenCodeEvent>, runtime = status()) {
      for (const observer of eventObservers) observer(event as OpenCodeEvent, runtime);
    },
    advance(ms: number) {
      now += ms;
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("Palot tool host", () => {
  it("attaches shown and running directories with the connection's credentials", async () => {
    const harness = setup();
    harness.active.ses_busy = { type: "running" };
    harness.host.start();
    harness.host.setFocus(1, { connectionID: "c1", directories: ["/repo", "/repo"] });
    await harness.host.settled();
    expect(harness.host.attachments()).toEqual({ c1: ["/repo", "/work/ses_busy"] });
    expect(harness.connect).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "http://127.0.0.1:4096",
        name: "palot",
        directory: "/repo",
        headers: { authorization: "Basic x" },
      }),
    );
    // Every attachment serves the same tool set.
    expect(harness.connect.mock.calls[0]?.[0].tools.map((tool) => tool.name)).toContain(
      "schedule_task",
    );
    await harness.host.shutdown();
    expect(harness.open.size).toBe(0);
  });

  it("keeps a finished task's directory attached for a while, then detaches it", async () => {
    vi.useFakeTimers();
    const harness = setup();
    harness.host.start();
    await harness.host.settled();
    harness.emit({
      type: "session.execution.started",
      data: { sessionID: "ses_1" },
      location: { directory: "/wt/one" },
    } as never);
    await harness.host.settled();
    expect(harness.host.attachments()).toEqual({ c1: ["/wt/one"] });

    harness.emit({ type: "session.execution.succeeded", data: { sessionID: "ses_1" } } as never);
    harness.advance(14 * 60_000);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(harness.host.attachments()).toEqual({ c1: ["/wt/one"] });
    harness.advance(2 * 60_000);
    await vi.advanceTimersByTimeAsync(60_000);
    await harness.host.settled();
    expect(harness.host.attachments()).toEqual({ c1: [] });
    await harness.host.shutdown();
  });

  it("attaches a new task's directory before its first turn", async () => {
    const harness = setup();
    harness.host.start();
    await harness.host.settled();
    harness.emit({
      type: "session.created",
      data: { sessionID: "ses_sub", parentID: "ses_x", location: { directory: "/wt/sub" } },
    } as never);
    harness.emit({
      type: "session.created",
      data: { sessionID: "ses_new", location: { directory: "/wt/new" } },
    } as never);
    await harness.host.settled();
    expect(harness.host.attachments()).toEqual({ c1: ["/wt/new"] });
    await harness.host.shutdown();
  });

  it("only attaches to OpenCode 2.1.4 or later, and detaches when focus or the server goes", async () => {
    const harness = setup([status({ version: "2.1.3" })]);
    harness.host.start();
    harness.host.setFocus(1, { connectionID: "c1", directories: ["/repo"] });
    await harness.host.settled();
    expect(harness.connect).not.toHaveBeenCalled();

    harness.setRuntimes([status({ version: "2.2.0" })]);
    await harness.host.settled();
    expect(harness.host.attachments()).toEqual({ c1: ["/repo"] });

    harness.host.setFocus(1, null);
    await harness.host.settled();
    expect(harness.open.size).toBe(0);

    harness.host.setFocus(1, { connectionID: "c1", directories: ["/repo"] });
    harness.setRuntimes([status({ connected: false })]);
    await harness.host.settled();
    expect(harness.host.attachments()).toEqual({});
    expect(harness.open.size).toBe(0);
    await harness.host.shutdown();
  });

  it("approves scheduling prompts the user no longer wants to see", async () => {
    const ask = { value: true };
    const harness = setup([status()], { value: true }, ask, {
      full: [
        { action: "*", resource: "*", effect: "allow" },
        { action: "palot_schedule_task", resource: "*", effect: "ask" },
      ],
      normal: [{ action: "palot_schedule_task", resource: "*", effect: "ask" }],
    });
    harness.host.start();
    await harness.host.settled();
    const asked = (id: string, sessionID: string, action = "palot_schedule_task") =>
      harness.emit({ type: "permission.asked", data: { id, sessionID, action } } as never);

    asked("p1", "full");
    asked("p2", "normal");
    asked("p3", "full", "shell");
    await vi.waitFor(() => expect(harness.client.permission.reply).toHaveBeenCalledTimes(1));
    expect(harness.client.permission.reply).toHaveBeenCalledWith({
      sessionID: "full",
      requestID: "p1",
      decision: "once",
    });

    ask.value = false;
    asked("p4", "normal");
    await vi.waitFor(() => expect(harness.client.permission.reply).toHaveBeenCalledTimes(2));
    await harness.host.shutdown();
  });

  it("detaches everything when the user turns the tools off", async () => {
    const enabled = { value: true };
    const harness = setup([status()], enabled);
    harness.host.start();
    harness.host.setFocus(1, { connectionID: "c1", directories: ["/repo"] });
    await harness.host.settled();
    expect(harness.open.size).toBe(1);
    enabled.value = false;
    harness.host.refresh();
    await harness.host.settled();
    expect(harness.open.size).toBe(0);
    await harness.host.shutdown();
  });

  it("reattaches after the service moves to a new endpoint", async () => {
    const harness = setup();
    harness.host.start();
    harness.host.setFocus(1, { connectionID: "c1", directories: ["/repo"] });
    await harness.host.settled();
    harness.moveEndpoint("http://127.0.0.1:5000");
    await harness.host.settled();
    expect([...harness.open.keys()]).toEqual(["http://127.0.0.1:5000 /repo"]);
    await harness.host.shutdown();
  });
});
