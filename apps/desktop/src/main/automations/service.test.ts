// @vitest-environment node

import type { OpenCodeEvent } from "@opencode/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AutomationService } from "./service";
import type { OpenCodeRuntimeStatus } from "../../shared";

const mocks = vi.hoisted(() => ({
  listeners: new Set<(event: OpenCodeEvent, runtime: OpenCodeRuntimeStatus) => void>(),
  statuses: new Set<(runtime: OpenCodeRuntimeStatus) => void>(),
  runtimes: [] as OpenCodeRuntimeStatus[],
  due: vi.fn<(profileID: string, now: number, capacity: number) => unknown[]>(() => []),
  activeRuns: vi.fn<(profileID?: string) => unknown[]>(() => []),
  clients: new Map<string, unknown>(),
  runnerOptions: [] as Array<{ client(): Promise<unknown> }>,
  runnerEvents: [] as Array<ReturnType<typeof vi.fn>>,
  onEvent: vi.fn(),
  runIDForSession: vi.fn<(sessionID: string) => string | null>(() => "run-1"),
  run: vi.fn(() => null),
}));

vi.mock("electron", () => ({
  app: { getPath: () => "/unused-automation-test-state" },
  BrowserWindow: { getAllWindows: () => [] },
  powerMonitor: { on: vi.fn(), off: vi.fn() },
}));
vi.mock("electron-store", () => ({
  default: class {
    get() {
      return false;
    }
  },
}));
vi.mock("../database/client", () => ({ palotDatabase: () => null }));
vi.mock("../opencode-runtime", () => ({
  openCodeRuntime: {
    listRuntimes: () => mocks.runtimes,
    scopedConnection(connectionID: string) {
      return {
        runtimeStatus: () =>
          mocks.runtimes.find((runtime) => runtime.connectionID === connectionID),
        withClient: async (operation: (client: unknown) => unknown) =>
          operation(await mocks.clients.get(connectionID)),
      };
    },
    onScopedEvent(listener: (event: OpenCodeEvent, runtime: OpenCodeRuntimeStatus) => void) {
      mocks.listeners.add(listener);
      return () => mocks.listeners.delete(listener);
    },
    onRuntimeStatus(listener: (runtime: OpenCodeRuntimeStatus) => void) {
      mocks.statuses.add(listener);
      return () => mocks.statuses.delete(listener);
    },
    onConnectionDisposed: () => () => {},
  },
}));
vi.mock("./definitions", () => ({
  AutomationDefinitionRegistry: class {
    async load() {
      return { definitions: [], errors: [] };
    }
  },
}));
vi.mock("./repository", () => ({
  AutomationRepository: class {
    reconcileDefinitionFiles() {}
    run = mocks.run;
    activeRuns = mocks.activeRuns;
    due = mocks.due;
  },
}));
vi.mock("./runner", () => ({
  AutomationRunner: class {
    constructor(options: { client(): Promise<unknown> }) {
      mocks.runnerOptions.push(options);
      mocks.runnerEvents.push(this.onEvent);
    }
    onEvent = vi.fn((event: OpenCodeEvent) => mocks.onEvent(event));
    runIDForSession = mocks.runIDForSession;
    async shutdown() {}
  },
}));
vi.mock("../opencode-version", () => ({ isSupportedOpenCodeVersion: () => true }));

function emit(event: OpenCodeEvent): void {
  for (const listener of mocks.listeners) listener(event, mocks.runtimes[0]!);
}

function rpc(data: Record<string, unknown>): OpenCodeEvent {
  return {
    id: "rpc-event",
    created: 1,
    type: "rpc.plugin.updated",
    location: { directory: "/project" },
    data,
  };
}

describe("automation event session routing", () => {
  let service: AutomationService;

  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.runnerOptions.length = 0;
    mocks.runnerEvents.length = 0;
    mocks.runtimes = [runtime("a"), runtime("b"), runtime("unsupported", false)];
    service = new AutomationService();
    await service.start();
  });

  afterEach(async () => {
    await service.shutdown();
  });

  it("scans every supported connected profile without selecting one", () => {
    expect(mocks.due.mock.calls.map((call) => call[0])).toEqual(["a", "b"]);
    expect(mocks.activeRuns).toHaveBeenCalledWith("a");
    expect(mocks.activeRuns).toHaveBeenCalledWith("b");
    expect(mocks.activeRuns).not.toHaveBeenCalledWith("unsupported");
  });

  it("keeps session event routing isolated and does not restart recovery on focus-only status", () => {
    const event = {
      id: "same",
      type: "session.idle",
      data: { sessionID: "same" },
    } as OpenCodeEvent;
    for (const listener of mocks.listeners) listener(event, mocks.runtimes[1]!);
    expect(mocks.runnerEvents[0]).not.toHaveBeenCalled();
    expect(mocks.runnerEvents[1]).toHaveBeenCalledWith(event);
    const reads = mocks.activeRuns.mock.calls.length;
    for (const listener of mocks.statuses) listener(mocks.runtimes[1]!);
    expect(mocks.activeRuns).toHaveBeenCalledTimes(reads);
    expect(mocks.runnerOptions).toHaveLength(2);
  });

  it("pins delayed client resolution to the runner's original connection", async () => {
    let resolve!: (value: unknown) => void;
    mocks.clients.set(
      "a",
      new Promise((done) => {
        resolve = done;
      }),
    );
    const pending = mocks.runnerOptions[0]!.client();
    mocks.runtimes.reverse();
    const client = { server: { info: vi.fn(async () => ({ version: "test" })) } };
    resolve(client);
    expect(await pending).toBe(client);
    expect(client.server.info).toHaveBeenCalledOnce();
  });

  it.each([
    { form: null },
    { form: "not-a-form" },
    { form: { sessionID: 42 } },
    { sessionID: 42 },
    { sessionID: { id: "session-one" } },
  ])("ignores custom RPC session fields that are not usable IDs: %j", (data) => {
    const event = rpc(data);
    expect(() => emit(event)).not.toThrow();
    expect(mocks.onEvent).toHaveBeenCalledWith(event);
    expect(mocks.runIDForSession).not.toHaveBeenCalled();
    expect(mocks.run).not.toHaveBeenCalled();
  });

  const direct: OpenCodeEvent = {
    id: "idle-event",
    created: 1,
    type: "session.idle",
    data: { sessionID: "session-one" },
  };
  const form: OpenCodeEvent = {
    id: "form-event",
    created: 1,
    type: "form.created",
    data: {
      form: {
        id: "form-one",
        sessionID: "session-one",
        title: "Approval",
        fields: [{ key: "answer", type: "string" }],
      },
    },
  };

  it.each([
    direct,
    form,
    rpc({ sessionID: "session-one", form: null }),
    rpc({ form: { sessionID: "session-one" } }),
    rpc({ sessionID: 42, form: { sessionID: "session-one" } }),
    rpc({ sessionID: "session-one", form: { sessionID: "other-session" } }),
  ])("looks up attention runs for valid direct or form IDs: %j", (event) => {
    emit(event);
    expect(mocks.runIDForSession).toHaveBeenCalledExactlyOnceWith("session-one");
    expect(mocks.run).toHaveBeenCalledExactlyOnceWith("run-1");
  });
});

function runtime(profileID: string, supported = true): OpenCodeRuntimeStatus {
  return {
    profileID,
    connectionID: profileID,
    connected: true,
    capabilities: { scheduledAutomations: supported },
  } as OpenCodeRuntimeStatus;
}
