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
  mocks.disconnected.add("a");
  resolve({ title: "Disabled task" });
  await vi.waitFor(() => expect(mocks.statusReads).toContain("a"));
  expect(mocks.shown).toHaveLength(0);
});
