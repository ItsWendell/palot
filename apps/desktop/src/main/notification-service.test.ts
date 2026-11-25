// @vitest-environment node
import type { OpenCodeEvent } from "@opencode/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import type { OpenCodeRuntimeStatus } from "../shared";
import { desktopNotificationService } from "./notification-service";

const mocks = vi.hoisted(() => ({
  listener: null as ((event: OpenCodeEvent, runtime: OpenCodeRuntimeStatus) => void) | null,
  clients: new Map<string, { session: { get: () => Promise<unknown> } }>(),
  shown: [] as Array<{ title: string; click?: () => void }>,
  navigate: vi.fn(),
  disconnected: new Set<string>(),
  statusReads: [] as string[],
}));
vi.mock("electron", () => ({
  BrowserWindow: { getAllWindows: () => [] },
  shell: {},
  Notification: class {
    static isSupported() {
      return true;
    }
    record: { title: string; click?: () => void };
    constructor(input: { title: string }) {
      this.record = { title: input.title };
    }
    on(_event: string, click: () => void) {
      this.record.click = click;
    }
    show() {
      mocks.shown.push(this.record);
    }
  },
}));
vi.mock("electron-store", () => ({
  default: class {
    get(key: string) {
      return key === "turnCompletion" ? "always" : true;
    }
  },
}));
vi.mock("./macos-notification-permission", () => ({}));
vi.mock("./desktop-navigation", () => ({ desktopNavigation: { request: mocks.navigate } }));
vi.mock("./opencode-runtime", () => ({
  openCodeRuntime: {
    onScopedEvent(listener: typeof mocks.listener) {
      mocks.listener = listener;
      return () => {
        mocks.listener = null;
      };
    },
    scopedConnection(connectionID: string) {
      return {
        runtimeStatus: () => {
          mocks.statusReads.push(connectionID);
          return { connected: !mocks.disconnected.has(connectionID) };
        },
        withClient: async (operation: (client: unknown) => unknown) =>
          operation(mocks.clients.get(connectionID)),
      };
    },
  },
}));

beforeEach(() => {
  mocks.shown.length = 0;
  mocks.clients.clear();
  mocks.disconnected.clear();
  mocks.statusReads.length = 0;
  mocks.navigate.mockClear();
  desktopNotificationService().start();
});
afterEach(() => desktopNotificationService().shutdown());

it("keeps equal request IDs on two servers separate and preserves click ownership", () => {
  const event = {
    type: "permission.asked",
    data: { sessionID: "same", id: "request" },
  } as OpenCodeEvent;
  mocks.listener?.(event, runtime("a"));
  mocks.listener?.(event, runtime("b"));
  mocks.listener?.(event, runtime("a"));
  mocks.listener?.(event, { ...runtime("disabled"), connected: false });
  expect(mocks.shown).toHaveLength(2);
  mocks.shown[0]!.click!();
  mocks.shown[1]!.click!();
  expect(mocks.navigate.mock.calls.map(([target]) => target.profileID)).toEqual(["a", "b"]);
});

it("uses the event owner for delayed completion metadata and subsequent navigation", async () => {
  let resolve!: (value: unknown) => void;
  const a = vi.fn(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const b = vi.fn(async () => ({ title: "Wrong server" }));
  mocks.clients.set("a", { session: { get: a } });
  mocks.clients.set("b", { session: { get: b } });
  const event = {
    id: "same-event",
    type: "session.execution.succeeded",
    data: { sessionID: "same" },
  } as OpenCodeEvent;
  mocks.listener?.(event, runtime("a"));
  mocks.listener?.(event, runtime("b"));
  await vi.waitFor(() => expect(a).toHaveBeenCalled());
  resolve({ title: "Original server", parentID: null });
  await vi.waitFor(() => expect(mocks.shown).toHaveLength(2));
  const notification = mocks.shown.find((item) => item.title === "Original server finished")!;
  notification.click!();
  expect(mocks.navigate).toHaveBeenCalledWith({
    type: "session",
    profileID: "a",
    sessionID: "same",
  });
  expect(a).toHaveBeenCalledOnce();
  expect(b).toHaveBeenCalledOnce();
});

function runtime(profileID: string): OpenCodeRuntimeStatus {
  return { profileID, connectionID: profileID, connected: true } as OpenCodeRuntimeStatus;
}

it("drops an in-flight completion when its owner is disabled before metadata returns", async () => {
  let resolve!: (value: unknown) => void;
  mocks.clients.set("a", {
    session: {
      get: () =>
        new Promise((done) => {
          resolve = done;
        }),
    },
  });
  mocks.listener?.(
    {
      id: "completion",
      type: "session.execution.succeeded",
      data: { sessionID: "session" },
    } as OpenCodeEvent,
    runtime("a"),
  );
  await vi.waitFor(() => expect(resolve).toBeTypeOf("function"));
  mocks.disconnected.add("a");
  resolve({ title: "Disabled task" });
  await vi.waitFor(() => expect(mocks.statusReads).toContain("a"));
  expect(mocks.shown).toHaveLength(0);
});

it("notifies once when a task and its background subagent have both finished", async () => {
  const get = vi.fn(async ({ sessionID }: { sessionID: string }) =>
    sessionID === "child"
      ? { title: "Explore", parentID: "root" }
      : { title: "Family task", parentID: null },
  );
  const active = vi.fn(async () => ({}));
  mocks.clients.set("a", { session: { get, active } } as never);
  const send = (id: string, type: string, data: Record<string, unknown>) =>
    mocks.listener?.({ id, type, data } as OpenCodeEvent, runtime("a"));
  send("1", "session.execution.started", { sessionID: "root" });
  send("2", "session.created", { sessionID: "child", parentID: "root" });
  send("3", "session.execution.started", { sessionID: "child" });
  // The parent ends its launching turn while the child runs on.
  send("4", "session.execution.succeeded", { sessionID: "root" });
  send("5", "session.execution.succeeded", { sessionID: "child" });
  send("6", "session.inbox.enqueued", {
    sessionID: "root",
    inboxID: "report",
    item: { type: "synthetic", payload: { metadata: { source: "subagent" } } },
  });
  send("7", "session.execution.started", { sessionID: "root" });
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(mocks.shown).toHaveLength(0);
  send("8", "session.execution.succeeded", { sessionID: "root" });
  await vi.waitFor(() => expect(mocks.shown).toHaveLength(1));
  expect(mocks.shown[0]!.title).toBe("Family task finished");
  expect(active).toHaveBeenCalledOnce();
});
