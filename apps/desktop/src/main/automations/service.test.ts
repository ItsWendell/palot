// @vitest-environment node

import type { OpenCodeEvent } from "@opencode/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AutomationService } from "./service";

const mocks = vi.hoisted(() => ({
  listeners: new Set<(event: OpenCodeEvent) => void>(),
  onEvent: vi.fn(),
  runIDForSession: vi.fn<(sessionID: string) => string | null>(() => "run-1"),
  run: vi.fn(() => null),
}));

vi.mock("electron", () => ({
  app: { getPath: () => "/unused-automation-test-state" },
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
    runtimeStatus: () => ({ capabilities: { scheduledAutomations: false } }),
    onEvent(listener: (event: OpenCodeEvent) => void) {
      mocks.listeners.add(listener);
      return () => mocks.listeners.delete(listener);
    },
    onReconnect: () => () => {},
    onBeforeSwitch: () => () => {},
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
  },
}));
vi.mock("./runner", () => ({
  AutomationRunner: class {
    onEvent = mocks.onEvent;
    runIDForSession = mocks.runIDForSession;
    async shutdown() {}
  },
}));

function emit(event: OpenCodeEvent): void {
  for (const listener of mocks.listeners) listener(event);
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
    service = new AutomationService();
    await service.start();
  });

  afterEach(async () => {
    await service.shutdown();
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
