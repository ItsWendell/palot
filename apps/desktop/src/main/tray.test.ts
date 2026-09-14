// @vitest-environment node
import type { OpenCodeClient, OpenCodeEvent, SessionInfo } from "@opencode/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { OpenCodeRuntimeStatus } from "../shared";
import { destroyTray, installTray } from "./tray";

const mocks = vi.hoisted(() => ({
  runtimes: [] as OpenCodeRuntimeStatus[],
  clients: new Map<string, OpenCodeClient>(),
  event: null as ((event: OpenCodeEvent, runtime: OpenCodeRuntimeStatus) => void) | null,
  dispose: null as ((connectionID: string) => void) | null,
  publish: vi.fn(),
}));
vi.mock("electron", () => ({
  app: { isPackaged: false },
  nativeImage: { createFromPath: () => ({ setTemplateImage() {} }) },
  Menu: { buildFromTemplate: (template: unknown) => template },
  Tray: class {
    setToolTip() {}
    setContextMenu() {}
    destroy() {}
  },
}));
vi.mock("./desktop-status", () => ({
  DesktopStatus: class {
    publish = mocks.publish;
    async dispose() {}
  },
}));
vi.mock("./linux-desktop", () => ({ desktopProbe: async () => "org.kde.StatusNotifierWatcher" }));
vi.mock("./tray-appearance", () => ({ followLinuxTrayAppearance: () => () => {} }));
vi.mock("./session-triage-store", () => ({
  sessionTriageStore: () => ({ load: () => ({ sessions: [] }) }),
}));
vi.mock("./attention-index", () => ({
  openCodeAttentionIndex: () => ({
    subscribe: () => () => {},
    snapshot: async () => ({ requests: [], sessions: [], complete: true }),
  }),
}));
vi.mock("./opencode-runtime", () => ({
  openCodeRuntime: {
    listRuntimes: () => mocks.runtimes,
    profileSnapshot: () => ({ profiles: [] }),
    scopedConnection(connectionID: string) {
      return {
        withClient: async (operation: (client: OpenCodeClient) => unknown) =>
          operation(mocks.clients.get(connectionID)!),
      };
    },
    onScopedEvent(listener: typeof mocks.event) {
      mocks.event = listener;
      return () => {};
    },
    onRuntimeStatus: () => () => {},
    onConnectionDisposed(listener: typeof mocks.dispose) {
      mocks.dispose = listener;
      return () => {};
    },
  },
}));

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("process", { ...process, platform: "linux" });
  mocks.publish.mockClear();
  mocks.runtimes = [runtime("a"), runtime("b"), { ...runtime("disabled"), connected: false }];
  mocks.clients = new Map([
    ["a", client("task-a")],
    ["b", client("task-b")],
    ["disabled", client("hidden")],
  ]);
});
afterEach(async () => {
  await destroyTray();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("combines connected owners and refreshes only the server whose task changed", async () => {
  await installTray({
    currentDirectory: "/unused",
    displayName: "Test",
    appID: "test",
    iconVariant: "test",
  });
  await vi.advanceTimersByTimeAsync(500);
  const sections = mocks.publish.mock.calls.at(-1)![0];
  expect(
    sections.recent.map((item: { target: { profileID: string } }) => item.target.profileID),
  ).toEqual(["a", "b"]);
  expect(mocks.clients.get("disabled")!.session.list).not.toHaveBeenCalled();
  mocks.event?.({ type: "session.renamed" } as OpenCodeEvent, runtime("a"));
  await vi.advanceTimersByTimeAsync(500);
  expect(mocks.clients.get("a")!.session.list).toHaveBeenCalledTimes(2);
  expect(mocks.clients.get("b")!.session.list).toHaveBeenCalledTimes(1);
  mocks.dispose?.("a");
  expect(
    mocks.publish.mock.calls
      .at(-1)![0]
      .recent.map((item: { target: { profileID: string } }) => item.target.profileID),
  ).toEqual(["b"]);
});

function runtime(profileID: string): OpenCodeRuntimeStatus {
  return { profileID, connectionID: profileID, connected: true } as OpenCodeRuntimeStatus;
}
function client(id: string): OpenCodeClient {
  const session = sessionInfo(id);
  return {
    session: { list: vi.fn(async () => ({ data: [session] })), active: vi.fn(async () => ({})) },
    project: { list: vi.fn(async () => []) },
  } as unknown as OpenCodeClient;
}

function sessionInfo(id: string): SessionInfo {
  return {
    id,
    projectID: "project",
    title: id,
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 1, updated: 1 },
    location: { directory: "/repo" },
  };
}

it("bounds missing-session reads and shares concurrent ancestor lookups", async () => {
  const owner = mocks.clients.get("a")!;
  vi.mocked(owner.session.active).mockResolvedValue(
    Object.fromEntries(
      Array.from({ length: 12 }, (_, index) => [`child-${index}`, { type: "running" }]),
    ) as Awaited<ReturnType<typeof owner.session.active>>,
  );
  let pending = 0;
  let maximum = 0;
  const get = vi.fn(async ({ sessionID }: { sessionID: string }) => {
    pending++;
    maximum = Math.max(maximum, pending);
    await new Promise((resolve) => setTimeout(resolve, 20));
    pending--;
    return { ...sessionInfo(sessionID), ...(sessionID === "root" ? {} : { parentID: "root" }) };
  });
  owner.session.get = get;
  await installTray({
    currentDirectory: "/unused",
    displayName: "Test",
    appID: "test",
    iconVariant: "test",
  });
  await vi.advanceTimersByTimeAsync(500);
  expect(maximum).toBeLessThanOrEqual(4);
  expect(get).toHaveBeenCalledTimes(13);
  expect(get.mock.calls.filter(([input]) => input.sessionID === "root")).toHaveLength(1);
});
