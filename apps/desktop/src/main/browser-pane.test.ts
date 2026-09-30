// @vitest-environment node
import { EventEmitter } from "node:events";
import { Effect, Queue, Stream } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  runtime: {
    scopedConnection: vi.fn(),
    requestConnection: vi.fn(),
    onRuntimeStatus: vi.fn(),
  },
  network: vi.fn(),
  client: vi.fn(),
  partition: vi.fn(),
  page: vi.fn(),
  host: vi.fn(),
  popupSurface: vi.fn(),
  popupPreferences: vi.fn(),
  inertWindows: [] as Array<{
    webContents: {
      setWindowOpenHandler: ReturnType<typeof vi.fn>;
      close: ReturnType<typeof vi.fn>;
      isDestroyed: ReturnType<typeof vi.fn>;
    };
  }>,
  stored: { sessions: {} as Record<string, unknown> },
}));
vi.mock("electron-store", () => ({
  default: class {
    get(key: "sessions") {
      return mocks.stored[key];
    }
    set(key: "sessions", value: Record<string, unknown>) {
      mocks.stored[key] = value;
    }
  },
}));
vi.mock("electron", () => ({
  BrowserWindow: class {
    webContents = {
      setWindowOpenHandler: vi.fn(),
      close: vi.fn(),
      isDestroyed: vi.fn(() => false),
    };
    constructor() {
      mocks.inertWindows.push(this);
    }
  },
  session: { fromPartition: mocks.partition },
}));
vi.mock("./opencode-runtime", () => ({ openCodeRuntime: mocks.runtime }));
vi.mock("./browser/network", () => ({ createBrowserNetwork: mocks.network }));
vi.mock("./browser/webview-host", () => ({
  requestBrowserWebviewHost: mocks.host,
}));
vi.mock("./browser-chromium", () => ({ createBrowserPage: mocks.page }));
vi.mock("./browser/popup-surface", () => ({
  createBrowserPopupSurface: mocks.popupSurface,
  popupWebPreferences: mocks.popupPreferences,
}));
vi.mock("@opencode/client/effect", () => ({ OpenCode: { make: mocks.client } }));

import { createBrowserPane, parseBrowserUserCommand } from "./browser-pane";
import { browserRestoreKey, createBrowserRestoreStore } from "./browser/restore";

const firstID = "tab_00000000-0000-0000-0000-000000000001";

describe("browser restore storage", () => {
  beforeEach(() => {
    mocks.stored.sessions = {};
  });

  it("validates persisted snapshots and bounds tabs and session history", () => {
    const restore = createBrowserRestoreStore();
    const key = browserRestoreKey("profile", "ses_test");
    const tab = (id: string, url = "https://example.test") => ({ id, url });
    const empty = { tabs: [], focusedTabID: null };
    expect(browserRestoreKey("profile", "ses_test")).not.toEqual(
      browserRestoreKey("other", "ses_test"),
    );
    restore.save(key, { tabs: [tab(firstID)] as never, focusedTabID: firstID as never });
    expect(restore.load(key)).toEqual({ tabs: [tab(firstID)], focusedTabID: firstID });
    mocks.stored.sessions[key] = { tabs: [tab("invalid")], focusedTabID: null };
    expect(restore.load(key)).toEqual(empty);
    mocks.stored.sessions[key] = { tabs: [tab(firstID), tab(firstID)], focusedTabID: firstID };
    expect(restore.load(key)).toEqual(empty);
    mocks.stored.sessions[key] = { tabs: [tab(firstID, "x".repeat(16_385))], focusedTabID: null };
    expect(restore.load(key)).toEqual(empty);
    const many = Array.from({ length: 40 }, (_, i) =>
      tab(`tab_${String(i).padStart(8, "0")}-0000-0000-0000-000000000000`),
    );
    restore.save(key, { tabs: many as never, focusedTabID: many[39]!.id as never });
    expect(createBrowserRestoreStore().load(key).tabs).toHaveLength(32);
    expect(restore.load(key).focusedTabID).toBeNull();
    restore.save(key, {
      tabs: many.slice(0, 12).map(({ id }) => tab(id, "é".repeat(16_000))) as never,
      focusedTabID: many[0]!.id as never,
    });
    expect(restore.load(key).tabs.length).toBeGreaterThan(0);
    expect(restore.load(key).tabs.length).toBeLessThan(12);
    for (let i = 0; i < 70; i++)
      restore.save(browserRestoreKey("profile", `ses_${i}`), {
        tabs: [tab(firstID)] as never,
        focusedTabID: firstID as never,
      });
    expect(Object.keys(mocks.stored.sessions)).toHaveLength(64);
    expect(restore.load(browserRestoreKey("profile", "ses_0"))).toEqual(empty);
    restore.remove(browserRestoreKey("profile", "ses_69"));
    expect(restore.load(browserRestoreKey("profile", "ses_69"))).toEqual(empty);
  });
});

function window() {
  const win = new EventEmitter() as EventEmitter & {
    isDestroyed: () => boolean;
    webContents: EventEmitter & { isDestroyed: () => boolean; send: ReturnType<typeof vi.fn> };
  };
  win.isDestroyed = () => false;
  win.webContents = Object.assign(new EventEmitter(), {
    isDestroyed: () => false,
    send: vi.fn(),
  });
  return win;
}

async function attachedPane() {
  const events = Effect.runSync(Queue.unbounded<unknown>());
  let requested: unknown;
  const results = vi.fn();
  mocks.client.mockReturnValue(
    Effect.succeed({
      event: {
        subscribe: () => {
          Queue.offerUnsafe(events, { type: "server.connected" });
          return Stream.fromQueue(events);
        },
      },
      session: { get: () => Effect.succeed({ location: { directory: "/workspace" } }) },
      rpc: () => ({
        attach: () =>
          Effect.sync(() => {
            Queue.offerUnsafe(events, {
              type: "rpc.experimental.browser.control",
              data: {
                type: "attached",
                connectionID: (
                  mocks.network.mock.lastCall![0] as { attachment: { connectionID: string } }
                ).attachment.connectionID,
                version: 4,
              },
            });
          }).pipe(Effect.andThen(Effect.never)),
        state: () => Effect.void,
        command: () => Effect.sync(() => requested),
        result: (value: unknown) => Effect.sync(() => results(value)),
      }),
    }),
  );
  const pane = createBrowserPane();
  const win = window();
  const binding = await pane.register(
    win as never,
    { sessionID: "ses_test", profileID: "profile", connectionID: "connection" },
    () => true,
  );
  const event = () =>
    win.webContents.send.mock.calls
      .map(
        ([, event]) =>
          event as {
            bindingID: string;
            type: string;
            state: {
              tabs: Array<{
                id: string;
                url: string;
                title: string;
                generation: number;
                loadError?: string;
                loading: boolean;
              }>;
              focusedTabID: string | null;
            };
            popupTabIDs: string[];
          },
      )
      .findLast((event) => event.bindingID === binding && event.type === "state")!;
  const state = () => event().state;
  const request = (command: unknown) => {
    requested = command;
    Queue.offerUnsafe(events, {
      type: "rpc.experimental.browser.control",
      data: {
        type: "command",
        connectionID: (mocks.network.mock.lastCall![0] as { attachment: { connectionID: string } })
          .attachment.connectionID,
        requestID: "request_1",
      },
    });
    return results;
  };
  const cancel = () =>
    Queue.offerUnsafe(events, {
      type: "rpc.experimental.browser.control",
      data: {
        type: "cancel",
        connectionID: (mocks.network.mock.lastCall![0] as { attachment: { connectionID: string } })
          .attachment.connectionID,
        requestID: "request_1",
      },
    });
  return { pane, win, binding, state, event, request, cancel };
}

describe("browser attachment", () => {
  it("allows only validated local navigation and tab actions", () => {
    expect(parseBrowserUserCommand({ type: "tabs.open" })).toEqual({
      type: "tabs.open",
      url: "about:blank",
      focus: true,
    });
    expect(
      parseBrowserUserCommand({ type: "tabs.open", url: "https://example.test", focus: false }),
    ).toEqual({ type: "tabs.open", url: "https://example.test", focus: false });
    expect(() =>
      parseBrowserUserCommand({
        type: "evaluate",
        tabID: "tab_00000000-0000-0000-0000-000000000000",
        script: "1+1",
      }),
    ).toThrow("not allowed");
    expect(() =>
      parseBrowserUserCommand({ type: "navigate", url: "https://example.test", tabID: "invalid" }),
    ).toThrow();
  });
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.stored.sessions = {};
    mocks.inertWindows.length = 0;
    mocks.partition.mockReturnValue({
      webRequest: { onBeforeRequest: vi.fn() },
      clearStorageData: vi.fn(async () => {}),
      clearCache: vi.fn(async () => {}),
    });
    mocks.popupPreferences.mockImplementation((session) => ({ session, sandbox: true }));
    mocks.popupSurface.mockImplementation((_owner, options) => ({
      contents: options.webContents,
      window: new EventEmitter(),
      focus: vi.fn(),
      dispose: vi.fn(),
      layout: vi.fn(),
      setVisible: vi.fn(),
      getVisible: vi.fn(() => false),
      getBounds: vi.fn(() => ({ x: 0, y: 0, width: 800, height: 600 })),
    }));
    mocks.runtime.onRuntimeStatus.mockReturnValue(() => {});
    mocks.runtime.scopedConnection.mockReturnValue({
      runtimeStatus: () => ({
        connected: true,
        profileID: "profile",
        connectionID: "connection",
        source: "network-server",
      }),
      withClient: async (operation: (client: unknown) => Promise<unknown>) =>
        operation({ session: { get: async () => ({ location: { directory: "/workspace" } }) } }),
      onDispose: () => () => {},
    });
    mocks.runtime.requestConnection.mockResolvedValue({
      endpoint: { url: "https://example.test" },
      headers: { authorization: "Bearer token" },
      validate: vi.fn(),
    });
    mocks.network.mockImplementation(() => Effect.succeed({ attach: () => () => {} }));
    mocks.host.mockImplementation(async () => ({ contents: {}, dispose: () => {} }));
    mocks.page.mockImplementation(
      (_win, options: { id: string; surface: { dispose: () => void } }) => {
        const state = () => ({
          id: options.id,
          url: "about:blank",
          title: "",
          loading: false,
          canGoBack: false,
          canGoForward: false,
          generation: 0,
        });
        return {
          state,
          ready: Promise.resolve(),
          contents: {},
          layout: vi.fn(),
          setVisible: vi.fn(),
          focus: vi.fn(),
          execute: vi.fn(async () => ({ value: state(), files: [] })),
          dispose: vi.fn(async () => {
            options.surface.dispose();
          }),
        };
      },
    );
  });

  it("refuses a background or changed window owner before attaching", async () => {
    const pane = createBrowserPane();
    const win = window();
    const input = { sessionID: "ses_test", profileID: "profile", connectionID: "connection" };
    await expect(pane.register(win as never, input, () => false)).rejects.toThrow(
      "window connection changed",
    );
    expect(mocks.client).not.toHaveBeenCalled();
    await pane.dispose();
  });

  it("clears only the selected task's guest data, temporary files, and saved URLs", async () => {
    const { pane, win, binding, state } = await attachedPane();
    const key = browserRestoreKey("profile", "ses_test");
    const other = browserRestoreKey("profile", "ses_other");
    const saved = createBrowserRestoreStore();
    saved.save(other, {
      tabs: [{ id: firstID, url: "https://other.test" }] as never,
      focusedTabID: null,
    });
    await pane.command(win as never, binding, { type: "tabs.open" });
    await pane.command(win as never, binding, { type: "tabs.open" });
    expect(saved.load(key).tabs).toHaveLength(2);
    const pages = mocks.page.mock.results.map(
      (result) => result.value as { dispose: ReturnType<typeof vi.fn> },
    );
    const input = { sessionID: "ses_test", profileID: "profile", connectionID: "connection" };
    await pane.clearData(win as never, input);
    await vi.waitFor(() => expect(state().tabs).toHaveLength(0));
    expect(saved.load(key).tabs).toHaveLength(0);
    expect(mocks.stored.sessions[key]).toBeUndefined();
    expect(saved.load(other).tabs).toHaveLength(1);
    expect(pages.every((page) => page.dispose.mock.calls.length === 1)).toBe(true);
    const partition = mocks.partition.mock.results[0]!.value;
    expect(partition.clearStorageData).toHaveBeenCalledOnce();
    expect(partition.clearCache).toHaveBeenCalledOnce();
    await pane.dispose();
  });

  it("clears a detached task's private partition after its guests finish disposal", async () => {
    const { pane, win, binding } = await attachedPane();
    const input = { sessionID: "ses_test", profileID: "profile", connectionID: "connection" };
    await pane.command(win as never, binding, { type: "tabs.open" });
    const page = mocks.page.mock.results[0]!.value;
    const partition = mocks.partition.mock.results[0]!.value;
    pane.close(win as never, binding);
    expect(page.dispose).toHaveBeenCalledOnce();
    expect(partition.clearStorageData).not.toHaveBeenCalled();
    await pane.clearData(win as never, input);
    expect(partition.clearStorageData).toHaveBeenCalledOnce();
    expect(partition.clearCache).toHaveBeenCalledOnce();
    expect(mocks.stored.sessions[browserRestoreKey("profile", "ses_test")]).toBeUndefined();
    await pane.dispose();
  });

  it("blocks reattachment while detached browser data is being cleared", async () => {
    const { pane, win, binding } = await attachedPane();
    const input = { sessionID: "ses_test", profileID: "profile", connectionID: "connection" };
    await pane.command(win as never, binding, { type: "tabs.open" });
    const page = mocks.page.mock.results[0]!.value;
    const disposed = Promise.withResolvers<void>();
    const originalDispose = page.dispose;
    page.dispose = vi.fn(async () => {
      await disposed.promise;
      await originalDispose();
    });
    pane.close(win as never, binding);
    const clearing = pane.clearData(win as never, input);
    await expect(pane.register(win as never, input, () => true)).rejects.toThrow(
      "Browser data is being cleared",
    );
    disposed.resolve();
    await clearing;
    expect(mocks.stored.sessions[browserRestoreKey("profile", "ses_test")]).toBeUndefined();
    await pane.dispose();
  });

  it("keeps find and zoom controls within the owning browser window and page", async () => {
    const { pane, win, binding, state } = await attachedPane();
    const openedID = await pane.command(win as never, binding, { type: "tabs.open" });
    await vi.waitFor(() => expect(state().tabs).toHaveLength(1));
    expect(openedID).toBe(state().tabs[0]!.id);
    const tabID = state().tabs[0]!.id as never;
    const page = mocks.page.mock.results[0]!.value;
    page.contents.isDestroyed = () => false;
    page.contents.findInPage = vi.fn();
    page.contents.stopFindInPage = vi.fn();
    page.contents.getZoomLevel = vi.fn(() => 0);
    page.contents.setZoomLevel = vi.fn();
    page.contents.getZoomFactor = vi.fn(() => 1.25);
    expect(
      pane.pageControl(win as never, binding, tabID, { type: "find", query: "fixture" }),
    ).toBeUndefined();
    expect(page.contents.findInPage).toHaveBeenCalledWith("fixture", {
      forward: true,
      findNext: false,
    });
    pane.pageControl(win as never, binding, tabID, { type: "find", query: "fixture", next: true });
    expect(page.contents.findInPage).toHaveBeenLastCalledWith("fixture", {
      forward: true,
      findNext: true,
    });
    expect(pane.pageControl(win as never, binding, tabID, { type: "zoom", direction: 1 })).toBe(
      125,
    );
    expect(page.contents.setZoomLevel).toHaveBeenCalledWith(0.5);
    expect(() =>
      pane.pageControl(window() as never, binding, tabID, { type: "find.stop" }),
    ).toThrow("binding is unavailable");
    expect(() =>
      pane.pageControl(win as never, binding, "tab_ffffffff-ffff-ffff-ffff-ffffffffffff" as never, {
        type: "find.stop",
      }),
    ).toThrow("page is unavailable");
    expect(page.contents.stopFindInPage).not.toHaveBeenCalled();
    await pane.dispose();
  });

  it("publishes the fallback page focus when a selected page closes", async () => {
    const { pane, win, binding, state } = await attachedPane();
    await pane.command(win as never, binding, { type: "tabs.open" });
    await pane.command(win as never, binding, { type: "tabs.open" });
    await vi.waitFor(() => expect(state().tabs).toHaveLength(2));
    const [first, selected] = state().tabs;
    await pane.command(win as never, binding, { type: "tabs.close", tabID: selected!.id as never });
    await vi.waitFor(() =>
      expect(win.webContents.send).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ bindingID: binding, type: "focus", tabID: first!.id }),
      ),
    );
    await vi.waitFor(() => {
      expect(state().tabs).toHaveLength(1);
      expect(state().focusedTabID).toBe(first!.id);
    });
    await pane.dispose();
  });

  it("subscribes to control before attach and returns only after the matching attached event", async () => {
    const events = Effect.runSync(Queue.unbounded<unknown>());
    const order: string[] = [];
    let attach: (() => void) | undefined;
    const rpc = {
      event: {
        subscribe: () => {
          order.push("subscribe");
          Queue.offerUnsafe(events, { type: "server.connected" });
          return Stream.fromQueue(events);
        },
      },
      session: { get: () => Effect.succeed({ location: { directory: "/workspace" } }) },
      rpc: () => ({
        attach: () =>
          Effect.sync(() => {
            order.push("attach");
            attach = () =>
              Queue.offerUnsafe(events, {
                type: "rpc.experimental.browser.control",
                data: { type: "attached", connectionID: "other-connection", version: 4 },
              });
          }).pipe(Effect.andThen(Effect.never)),
        state: () => Effect.void,
      }),
    };
    mocks.client.mockReturnValue(Effect.succeed(rpc));
    const pane = createBrowserPane();
    const win = window();
    const input = { sessionID: "ses_test", profileID: "profile", connectionID: "connection" };
    // The callback emits a foreign attachment first, then the matching one.
    let ownsConnection = true;
    const pending = pane.register(win as never, input, () => ownsConnection);
    await vi.waitFor(() => expect(attach).toBeDefined());
    expect(order).toEqual(["subscribe", "attach"]);
    attach!();
    let settled = false;
    void pending.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    Queue.offerUnsafe(events, {
      type: "rpc.experimental.browser.control",
      data: {
        type: "attached",
        connectionID: (mocks.network.mock.calls[0]![0] as { attachment: { connectionID: string } })
          .attachment.connectionID,
        version: 4,
      },
    });
    const attachmentID = await pending;
    await vi.waitFor(() =>
      expect(win.webContents.send).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ bindingID: attachmentID, type: "state" }),
      ),
    );
    await pane.command(win as never, attachmentID, { type: "tabs.open" });
    await pane.command(win as never, attachmentID, { type: "tabs.open" });
    const first = mocks.page.mock.results[0]!.value;
    const second = mocks.page.mock.results[1]!.value;
    await pane.layout(win as never, {
      bindingID: attachmentID,
      tabID: second.state().id,
      visible: true,
      bounds: { x: 10, y: 20, width: 100, height: 100 },
    });
    await pane.layout(win as never, {
      bindingID: attachmentID,
      tabID: first.state().id,
      visible: false,
    });
    expect(second.setVisible).toHaveBeenLastCalledWith(true);
    ownsConnection = false;
    await expect(
      pane.layout(win as never, {
        bindingID: attachmentID,
        tabID: "tab_00000000-0000-0000-0000-000000000000" as never,
        visible: false,
      }),
    ).rejects.toThrow("window connection changed");
    await expect(
      pane.layout(win as never, {
        bindingID: attachmentID,
        tabID: first.state().id,
        visible: false,
      }),
    ).resolves.toBeUndefined();
    expect(() => pane.close(win as never, attachmentID)).not.toThrow();
    await pane.dispose();
  });

  it("restores inventory across renderer close and reconnect, then lazily loads pages", async () => {
    const events = Effect.runSync(Queue.unbounded<unknown>());
    mocks.client.mockReturnValue(
      Effect.succeed({
        event: {
          subscribe: () => {
            Queue.offerUnsafe(events, { type: "server.connected" });
            return Stream.fromQueue(events);
          },
        },
        session: { get: () => Effect.succeed({ location: { directory: "/workspace" } }) },
        rpc: () => ({
          attach: () =>
            Effect.sync(() => {
              Queue.offerUnsafe(events, {
                type: "rpc.experimental.browser.control",
                data: {
                  type: "attached",
                  connectionID: (
                    mocks.network.mock.lastCall![0] as {
                      attachment: { connectionID: string };
                    }
                  ).attachment.connectionID,
                  version: 4,
                },
              });
            }).pipe(Effect.andThen(Effect.never)),
          state: () => Effect.void,
        }),
      }),
    );
    mocks.page.mockImplementation((_win, options: { id: string; restore?: { url: string } }) => {
      let url = options.restore?.url ?? "about:blank";
      const state = () => ({
        id: options.id,
        url,
        title: "",
        loading: false,
        canGoBack: false,
        canGoForward: false,
        generation: options.restore ? 1 : 0,
      });
      return {
        state,
        ready: Promise.resolve(),
        contents: {},
        layout: vi.fn(),
        setVisible: vi.fn(),
        execute: async ({ action }: { action: { type: string; url?: string } }) => {
          if (action.type === "navigate") url = action.url ?? url;
          return { value: state(), files: [] };
        },
        dispose: async () => {},
      };
    });
    const win = window();
    const pane = createBrowserPane();
    const input = { sessionID: "ses_test", profileID: "profile", connectionID: "connection" };
    const binding = await pane.register(win as never, input, () => true);
    await pane.command(win as never, binding, {
      type: "tabs.open",
      url: "https://example.test/first",
    });
    await pane.command(win as never, binding, {
      type: "tabs.open",
      url: "https://example.test/second",
    });
    const first = mocks.page.mock.results[0]!.value.state().id;
    const second = mocks.page.mock.results[1]!.value.state().id;
    pane.close(win as never, binding); // Renderer cleanup on route unmount.
    const next = await pane.register(
      win as never,
      { ...input, connectionID: "reconnected" },
      () => true,
    );
    let state: { state?: { tabs: unknown[]; focusedTabID: string } } | undefined;
    await vi.waitFor(() => {
      state = win.webContents.send.mock.calls
        .map(
          ([, event]) =>
            event as {
              bindingID: string;
              type: string;
              state?: { tabs: unknown[]; focusedTabID: string };
            },
        )
        .findLast((event) => event.bindingID === next && event.type === "state");
      expect(state).toBeDefined();
    });
    expect(state?.state).toEqual({
      tabs: [
        expect.objectContaining({ id: first, url: "https://example.test/first", generation: 1 }),
        expect.objectContaining({ id: second, url: "https://example.test/second", generation: 1 }),
      ],
      focusedTabID: second,
    });
    expect(mocks.page).toHaveBeenCalledTimes(2);
    pane.layout(win as never, { bindingID: next, tabID: second, visible: false });
    await pane.command(win as never, next, { type: "tabs.focus", tabID: first });
    expect(mocks.page).toHaveBeenCalledTimes(2);
    pane.layout(win as never, {
      bindingID: next,
      tabID: second,
      visible: true,
      bounds: { x: 0, y: 0, width: 100, height: 100 },
    });
    expect(mocks.page.mock.lastCall![1]).toEqual(
      expect.objectContaining({
        id: second,
        restore: expect.objectContaining({ id: second, generation: 1 }),
      }),
    );
    await pane.command(win as never, next, { type: "navigate", tabID: first, url: "about:blank" });
    expect(mocks.page.mock.lastCall![1]).toEqual(
      expect.objectContaining({ id: first, restore: expect.objectContaining({ id: first }) }),
    );
    await pane.command(win as never, next, { type: "tabs.close", tabID: first });
    await pane.command(win as never, next, { type: "tabs.close", tabID: second });
    pane.close(win as never, next);
    const empty = await pane.register(win as never, input, () => true);
    await vi.waitFor(() =>
      expect(
        win.webContents.send.mock.calls.findLast(
          ([, event]) => (event as { bindingID: string }).bindingID === empty,
        )![1],
      ).toEqual(expect.objectContaining({ state: { tabs: [], focusedTabID: null } })),
    );
    await pane.dispose();
  });

  it("keeps a healthy guest and binding alive after a crash, and only explicit reload replaces the failed guest", async () => {
    const pages: Array<{
      id: string;
      fail: () => void;
      dispose: ReturnType<typeof vi.fn>;
      execute: ReturnType<typeof vi.fn>;
      state: () => {
        id: string;
        url: string;
        title: string;
        loading: boolean;
        canGoBack: boolean;
        canGoForward: boolean;
        generation: number;
      };
    }> = [];
    mocks.page.mockImplementation(
      (
        _win,
        options: { id: string; restore?: { url: string; generation: number }; fail: () => void },
      ) => {
        let url = options.restore?.url ?? "about:blank";
        let generation = options.restore?.generation ?? 1;
        const state = () => ({
          id: options.id,
          url,
          title: "Example",
          loading: false,
          canGoBack: false,
          canGoForward: false,
          generation,
        });
        const page = {
          id: options.id,
          fail: options.fail,
          state,
          ready: Promise.resolve(),
          dispose: vi.fn(async () => {}),
          setVisible: vi.fn(),
          layout: vi.fn(),
          execute: vi.fn(async ({ action }: { action: { type: string; url?: string } }) => {
            if (action.type === "navigate") {
              url = action.url ?? url;
              generation++;
            }
            return { value: state(), files: [] };
          }),
        };
        pages.push(page);
        return page;
      },
    );
    const { pane, win, binding, state, request } = await attachedPane();
    await pane.command(win as never, binding, {
      type: "tabs.open",
      url: "https://example.test/first",
    });
    await pane.command(win as never, binding, {
      type: "tabs.open",
      url: "https://example.test/second",
    });
    const first = pages[0]!;
    const second = pages[1]!;
    first.fail();
    first.fail();
    await vi.waitFor(() => expect(state().tabs[0]?.loadError).toBeDefined());
    expect(state().tabs).toEqual([
      expect.objectContaining({
        id: first.id,
        url: "https://example.test/first",
        title: "Example",
        loading: false,
        loadError: expect.any(String),
        generation: 3,
      }),
      expect.objectContaining({ id: second.id, url: "https://example.test/second" }),
    ]);
    expect(first.dispose).toHaveBeenCalledTimes(1);
    expect(second.dispose).not.toHaveBeenCalled();
    await pane.layout(win as never, {
      bindingID: binding,
      tabID: first.id as never,
      visible: true,
      bounds: { x: 0, y: 0, width: 100, height: 100 },
    });
    await pane.command(win as never, binding, { type: "tabs.focus", tabID: first.id as never });
    expect(pages).toHaveLength(2);
    await expect(
      pane.command(win as never, binding, { type: "back", tabID: first.id as never }),
    ).rejects.toThrow("Reload or navigate");
    for (const action of [
      { type: "reload", tabID: first.id },
      { type: "navigate", tabID: first.id, url: "https://example.test/recover" },
    ]) {
      const results = request({ action, inspect: true, files: [] });
      await vi.waitFor(() => expect(results).toHaveBeenCalled());
      expect(results.mock.lastCall![0].outcome).toMatchObject({
        type: "success",
        result: {
          value: {
            resources: [action.type === "navigate" ? action.url : "https://example.test/first"],
            key: expect.any(String),
          },
        },
      });
      expect(pages).toHaveLength(2);
      results.mockClear();
      request({ action, target: { resources: ["https://wrong.test/"], key: "stale" }, files: [] });
      await vi.waitFor(() => expect(results).toHaveBeenCalled());
      expect(results.mock.lastCall![0].outcome).toMatchObject({
        type: "failure",
        message: expect.stringContaining("permission"),
      });
      expect(pages).toHaveLength(2);
      results.mockClear();
    }
    await pane.command(win as never, binding, { type: "reload", tabID: first.id as never });
    await vi.waitFor(() => expect(state().tabs[0]?.loadError).toBeUndefined());
    expect(pages).toHaveLength(3);
    expect(pages[2]!.id).toBe(first.id);
    expect(state().tabs[0]).toEqual(
      expect.objectContaining({ id: first.id, generation: 4, url: "https://example.test/first" }),
    );
    expect(state().tabs[0]).not.toHaveProperty("loadError");
    first.fail(); // Old debugger detach or late crash cannot damage the replacement.
    expect(state().tabs[0]).not.toHaveProperty("loadError");
    await pane.command(win as never, binding, { type: "tabs.close", tabID: first.id as never });
    expect(pages[2]!.dispose).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(state().tabs).toHaveLength(1));
    await pane.dispose();
  });

  it("retries normal load errors on the existing guest instead of treating them as a crash", async () => {
    let loadError: string | undefined = "ERR_CONNECTION_REFUSED";
    const execute = vi.fn(async () => {
      loadError = undefined;
      return { value: {}, files: [] };
    });
    mocks.page.mockImplementation((_win, options: { id: string }) => ({
      state: () => ({
        id: options.id,
        url: "https://example.test/",
        title: "",
        generation: 1,
        loading: false,
        canGoBack: false,
        canGoForward: false,
        ...(loadError ? { loadError } : {}),
      }),
      ready: Promise.resolve(),
      dispose: vi.fn(async () => {}),
      setVisible: vi.fn(),
      layout: vi.fn(),
      execute,
    }));
    const { pane, win, binding, state } = await attachedPane();
    // Keep the initial navigation error in the page's state.
    execute.mockImplementationOnce(async () => ({ value: {}, files: [] }));
    await pane.command(win as never, binding, { type: "tabs.open" });
    await vi.waitFor(() => expect(state().tabs[0]?.loadError).toBeDefined());
    await pane.command(win as never, binding, {
      type: "reload",
      tabID: state().tabs[0]!.id as never,
    });
    expect(execute).toHaveBeenCalledTimes(2);
    expect(mocks.page).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(state().tabs[0]?.loadError).toBeUndefined());
    await pane.dispose();
  });

  it("cancels an in-flight local operation and rejects stale generation after replacement", async () => {
    const pages: Array<{ id: string; fail: () => void; signal?: AbortSignal }> = [];
    mocks.page.mockImplementation(
      (_win, options: { id: string; restore?: { generation: number }; fail: () => void }) => {
        const page: { id: string; fail: () => void; signal?: AbortSignal } = {
          id: options.id,
          fail: options.fail,
        };
        pages.push(page);
        return {
          state: () => ({
            id: options.id,
            url: "https://example.test",
            title: "",
            loading: false,
            canGoBack: false,
            canGoForward: false,
            generation: options.restore?.generation ?? 1,
          }),
          ready: Promise.resolve(),
          dispose: vi.fn(async () => {}),
          setVisible: vi.fn(),
          layout: vi.fn(),
          execute: vi.fn(async (_command, signal: AbortSignal) => {
            page.signal = signal;
            return { value: {}, files: [] };
          }),
        };
      },
    );
    const { pane, win, binding, state, request } = await attachedPane();
    await pane.command(win as never, binding, { type: "tabs.open" });
    const first = pages[0]!;
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    mocks.page.mock.results[0]!.value.execute = vi.fn(
      async (_command: unknown, signal: AbortSignal) => {
        first.signal = signal;
        await waiting;
        return { value: {}, files: [] };
      },
    );
    first.signal = undefined;
    const command = pane.command(win as never, binding, {
      type: "reload",
      tabID: first.id as never,
    });
    const rejection = expect(command).rejects.toThrow();
    await vi.waitFor(() => expect(first.signal).toBeDefined());
    first.fail();
    expect(first.signal!.aborted).toBe(true);
    release();
    await rejection;
    await vi.waitFor(() => expect(state().tabs[0]?.loadError).toBeDefined());
    const crashed = state().tabs[0]!;
    await pane.command(win as never, binding, { type: "reload", tabID: first.id as never });
    await vi.waitFor(() => expect(state().tabs[0]!.generation).toBeGreaterThan(crashed.generation));
    const oldPage = mocks.page.mock.results[1]!.value;
    const previousCalls = oldPage.execute.mock.calls.length;
    const results = request({
      action: { type: "navigate", tabID: first.id, url: "https://example.test/old" },
      generation: crashed.generation - 1,
      files: [],
    });
    await vi.waitFor(() => expect(results).toHaveBeenCalled());
    expect(results.mock.lastCall![0].outcome).toEqual(
      expect.objectContaining({ type: "failure", message: expect.stringContaining("replaced") }),
    );
    expect(oldPage.execute).toHaveBeenCalledTimes(previousCalls);
    first.fail();
    await pane.dispose();
  });

  it("retains a tab when its first host cannot attach and recovers by explicit navigation", async () => {
    mocks.host.mockRejectedValueOnce(new Error("attachment failed"));
    const { pane, win, binding, state } = await attachedPane();
    await expect(pane.command(win as never, binding, { type: "tabs.open" })).rejects.toThrow(
      "attachment failed",
    );
    await vi.waitFor(() =>
      expect(state().tabs[0]?.loadError).toBe("Browser webview could not attach"),
    );
    const tab = state().tabs[0]!;
    expect(tab.loading).toBe(false);
    expect(tab.generation).toBe(2);
    await pane.layout(win as never, {
      bindingID: binding,
      tabID: tab.id as never,
      visible: true,
      bounds: { x: 0, y: 0, width: 100, height: 100 },
    });
    expect(mocks.host).toHaveBeenCalledTimes(1);
    await pane.command(win as never, binding, {
      type: "navigate",
      tabID: tab.id as never,
      url: "https://example.test",
    });
    expect(mocks.host).toHaveBeenCalledTimes(2);
    await vi.waitFor(() => expect(state().tabs[0]?.loadError).toBeUndefined());
    expect(state().tabs[0]!.id).toBe(tab.id);
    expect(mocks.page.mock.lastCall![1]).toEqual(
      expect.objectContaining({ id: tab.id, restore: expect.objectContaining({ generation: 3 }) }),
    );
    await pane.dispose();
  });

  it("cancels deferred recovery before its host can start navigation", async () => {
    const { pane, win, binding, state, request, cancel } = await attachedPane();
    await pane.command(win as never, binding, { type: "tabs.open" });
    (mocks.page.mock.lastCall![1] as { fail: () => void }).fail();
    await vi.waitFor(() => expect(state().tabs[0]?.loadError).toBeDefined());
    const failed = state().tabs[0]!;
    const attachment = Promise.withResolvers<unknown>();
    let signal: AbortSignal | undefined;
    mocks.host.mockImplementationOnce((_win, options: { signal: AbortSignal }) => {
      signal = options.signal;
      return attachment.promise;
    });
    const results = request({ action: { type: "reload", tabID: failed.id }, files: [] });
    await vi.waitFor(() => expect(signal).toBeDefined());
    cancel();
    await vi.waitFor(() => expect(signal!.aborted).toBe(true));
    const dispose = vi.fn();
    attachment.resolve({ dispose, contents: { isDestroyed: () => false, close: vi.fn() } });
    await vi.waitFor(() => expect(results).toHaveBeenCalled());
    expect(results.mock.lastCall![0].outcome.type).toBe("failure");
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(mocks.page).toHaveBeenCalledTimes(1);
    expect(state().tabs[0]).toMatchObject({
      id: failed.id,
      generation: failed.generation,
      loadError: failed.loadError,
    });
    await pane.command(win as never, binding, { type: "reload", tabID: failed.id as never });
    expect(mocks.page).toHaveBeenCalledTimes(2);
    await pane.dispose();
  });

  it("keeps a first guest readiness failure as a retryable tab without closing its binding", async () => {
    mocks.page.mockImplementationOnce((_win, options: { id: string }) => ({
      state: () => ({
        id: options.id,
        url: "https://example.test",
        title: "Before crash",
        loading: true,
        canGoBack: false,
        canGoForward: false,
        generation: 1,
      }),
      ready: Promise.reject(new Error("renderer failed while loading")),
      dispose: vi.fn(async () => {}),
      setVisible: vi.fn(),
      layout: vi.fn(),
      execute: vi.fn(),
    }));
    const { pane, win, binding, state } = await attachedPane();
    await expect(pane.command(win as never, binding, { type: "tabs.open" })).rejects.toThrow();
    await vi.waitFor(() => expect(state().tabs[0]?.loadError).toBeDefined());
    const tab = state().tabs[0]!;
    expect(tab).toEqual(
      expect.objectContaining({ title: "Before crash", loading: false, generation: 2 }),
    );
    await pane.command(win as never, binding, { type: "reload", tabID: tab.id as never });
    expect(mocks.page).toHaveBeenCalledTimes(2);
    await vi.waitFor(() => expect(state().tabs[0]?.loadError).toBeUndefined());
    await pane.dispose();
  });

  it("adopts the same Chromium child synchronously and inventories a focused popup", async () => {
    const { pane, win, binding, state, event } = await attachedPane();
    await pane.command(win as never, binding, { type: "tabs.open" });
    await vi.waitFor(() => expect(state().tabs).toHaveLength(1));
    const opener = state().tabs[0]!.id;
    const options = mocks.page.mock.calls[0]![1] as {
      openPopup: (details: object) => {
        action: string;
        overrideBrowserWindowOptions: object;
        createWindow: (options: object) => unknown;
      };
    };
    const details = {
      url: "https://example.test/posted",
      disposition: "new-window",
      postBody: { data: [{ bytes: Buffer.from("payload") }] },
    };
    const response = options.openPopup(details);
    expect(response.action).toBe("allow");
    const partition = mocks.partition.mock.results[0]!.value;
    expect(response.overrideBrowserWindowOptions).toMatchObject({
      show: false,
      webPreferences: { session: partition, sandbox: true },
    });
    const child = {
      isDestroyed: vi.fn(() => false),
      close: vi.fn(),
      setWindowOpenHandler: vi.fn(),
    };
    expect(response.createWindow({ webContents: child })).toBe(child);
    expect(mocks.popupSurface).toHaveBeenCalledWith(win, { webContents: child }, partition);
    const popupOptions = mocks.page.mock.calls[1]![1] as {
      id: string;
      restore: { url: string };
      preserveNavigation: boolean;
      closed: () => void;
      fail: () => void;
      surface: { window: EventEmitter; focus: ReturnType<typeof vi.fn> };
    };
    const popup = popupOptions.id;
    expect(popup).not.toBe(opener);
    expect(popupOptions).toMatchObject({
      network: expect.any(Object),
      restore: { id: popup, url: details.url },
      preserveNavigation: true,
      surface: { contents: child },
    });
    expect(popupOptions.surface.window.listenerCount("close")).toBe(1);
    expect(popupOptions.surface.window.listenerCount("closed")).toBe(1);
    expect(popupOptions.surface.focus).not.toHaveBeenCalled(); // Window-open is not a desktop focus request.
    await vi.waitFor(() => expect(state().tabs.map((tab) => tab.id)).toEqual([opener, popup]));
    expect(event().popupTabIDs).toEqual([popup]);
    expect(state().focusedTabID).toBe(popup);
    expect(mocks.page.mock.results[0]!.value.execute).toHaveBeenCalledTimes(1);
    expect(mocks.page.mock.results[1]!.value.execute).not.toHaveBeenCalled();
    await pane.command(win as never, binding, { type: "tabs.focus", tabID: popup as never });
    const popupPage = mocks.page.mock.results[1]!.value;
    expect(popupPage.focus).not.toHaveBeenCalled();
    await pane.layout(win as never, {
      bindingID: binding,
      tabID: popup as never,
      visible: true,
      bounds: { x: 0, y: 0, width: 800, height: 600 },
    });
    expect(popupPage.focus).toHaveBeenCalledOnce();
    await pane.layout(win as never, {
      bindingID: binding,
      tabID: popup as never,
      visible: true,
      bounds: { x: 0, y: 0, width: 801, height: 600 },
    });
    expect(popupPage.focus).toHaveBeenCalledOnce();
    await pane.dispose();
  });

  it("closes native popup or page callback without closing the opener", async () => {
    const { pane, win, binding, state, event } = await attachedPane();
    await pane.command(win as never, binding, { type: "tabs.open" });
    await vi.waitFor(() => expect(state().tabs).toHaveLength(1));
    const openerPage = mocks.page.mock.results[0]!.value;
    const openPopup = (
      mocks.page.mock.calls[0]![1] as {
        openPopup: (details: object) => { createWindow: (options: object) => unknown };
      }
    ).openPopup;
    openPopup({ url: "about:blank", disposition: "background-tab" }).createWindow({
      webContents: {},
    });
    const popupOptions = mocks.page.mock.calls[1]![1] as {
      id: string;
      closed: () => void;
      surface: { window: EventEmitter; dispose: ReturnType<typeof vi.fn> };
    };
    expect(state().focusedTabID).toBe(openerPage.state().id);
    const eventClose = { preventDefault: vi.fn() };
    popupOptions.surface.window.emit("close", eventClose);
    expect(eventClose.preventDefault).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(state().tabs).toHaveLength(1));
    expect(popupOptions.surface.dispose).toHaveBeenCalledOnce();
    expect(event().popupTabIDs).toEqual([]);
    popupOptions.closed();
    popupOptions.surface.window.emit("closed");
    expect(state().tabs[0]!.id).toBe(openerPage.state().id);
    expect(openerPage.dispose).not.toHaveBeenCalled();
    await pane.dispose();
  });

  it("publishes removal even when native page cleanup rejects", async () => {
    const { pane, win, binding, state } = await attachedPane();
    await pane.command(win as never, binding, { type: "tabs.open" });
    const page = mocks.page.mock.results[0]!.value;
    page.dispose.mockRejectedValueOnce(new Error("Native resource already destroyed"));
    await expect(
      pane.command(win as never, binding, { type: "tabs.close", tabID: page.state().id }),
    ).rejects.toThrow("Native resource already destroyed");
    await vi.waitFor(() => expect(state().tabs).toEqual([]));
    await pane.dispose();
  });

  it("cascades opener closure to its popups without replaying their navigation", async () => {
    const { pane, win, binding, state, event } = await attachedPane();
    await pane.command(win as never, binding, { type: "tabs.open" });
    await vi.waitFor(() => expect(state().tabs).toHaveLength(1));
    const opener = mocks.page.mock.results[0]!.value;
    const openPopup = (
      mocks.page.mock.calls[0]![1] as {
        openPopup: (details: object) => { createWindow: (options: object) => unknown };
      }
    ).openPopup;
    openPopup({ url: "https://example.test/a" }).createWindow({ webContents: {} });
    openPopup({ url: "https://example.test/b" }).createWindow({ webContents: {} });
    await vi.waitFor(() => expect(event().popupTabIDs).toHaveLength(2));
    await pane.command(win as never, binding, { type: "tabs.close", tabID: opener.state().id });
    await vi.waitFor(() => expect(state().tabs).toHaveLength(0));
    expect(event().popupTabIDs).toEqual([]);
    for (const page of mocks.page.mock.results.slice(1).map((result) => result.value))
      expect(page.execute).not.toHaveBeenCalled();
    const surfaces = mocks.popupSurface.mock.results.map((result) => result.value);
    surfaces.forEach((surface) => expect(surface.dispose).toHaveBeenCalledOnce());
    await pane.dispose();
  });

  it("cascades opener failure and pane disposal to native popup surfaces", async () => {
    const { pane, win, binding, state, event } = await attachedPane();
    await pane.command(win as never, binding, { type: "tabs.open" });
    await vi.waitFor(() => expect(state().tabs).toHaveLength(1));
    const openPopup = (
      mocks.page.mock.calls[0]![1] as {
        openPopup: (details: object) => { createWindow: (options: object) => unknown };
      }
    ).openPopup;
    openPopup({ url: "https://example.test/crash" }).createWindow({ webContents: {} });
    await vi.waitFor(() => expect(event().popupTabIDs).toHaveLength(1));
    const first = mocks.popupSurface.mock.results[0]!.value;
    (mocks.page.mock.calls[0]![1] as { fail: () => void }).fail();
    await vi.waitFor(() => expect(event().popupTabIDs).toEqual([]));
    expect(first.dispose).toHaveBeenCalledOnce();
    expect(state().tabs).toHaveLength(1);
    expect(state().tabs[0]!.loadError).toBeDefined();

    await pane.command(win as never, binding, { type: "tabs.open" });
    const next = mocks.page.mock.calls.at(-1)![1] as { openPopup: typeof openPopup };
    next.openPopup({ url: "https://example.test/dispose" }).createWindow({ webContents: {} });
    const second = mocks.popupSurface.mock.results[1]!.value;
    await vi.waitFor(() => expect(event().popupTabIDs).toHaveLength(1));
    await pane.dispose();
    expect(second.dispose).toHaveBeenCalledOnce();
  });

  it("denies nested popups, unsupported schemes, the fifth popup, and stale connections", async () => {
    const { pane, win, binding, state, event } = await attachedPane();
    await pane.command(win as never, binding, { type: "tabs.open" });
    await vi.waitFor(() => expect(state().tabs).toHaveLength(1));
    const openPopup = (
      mocks.page.mock.calls[0]![1] as {
        openPopup: (details: object) => {
          action: string;
          createWindow: (options: object) => unknown;
        };
      }
    ).openPopup;
    expect(openPopup({ url: "javascript:alert(1)" }).action).toBe("deny");
    expect(openPopup({ url: "file:///etc/passwd" }).action).toBe("deny");
    for (let i = 0; i < 4; i++)
      expect(
        openPopup({ url: `https://example.test/${i}` }).createWindow({ webContents: {} }),
      ).toBeDefined();
    const nested = (mocks.page.mock.calls[1]![1] as { openPopup: typeof openPopup }).openPopup;
    expect(nested({ url: "about:blank" }).action).toBe("deny");
    expect(openPopup({ url: "https://example.test/fifth" }).action).toBe("deny");
    await vi.waitFor(() => expect(event().popupTabIDs).toHaveLength(4));
    expect(state().tabs).toHaveLength(5);
    mocks.runtime.scopedConnection.mockReturnValue({ runtimeStatus: () => ({ connected: false }) });
    expect(openPopup({ url: "https://example.test/stale" }).action).toBe("deny");
    expect(mocks.page).toHaveBeenCalledTimes(5);
    await pane.dispose();
  });

  it("does not synthesize a tab or replay a POST when Chromium provides no child", async () => {
    const { pane, win, binding, state, event } = await attachedPane();
    await pane.command(win as never, binding, { type: "tabs.open" });
    await vi.waitFor(() => expect(state().tabs).toHaveLength(1));
    const openPopup = (
      mocks.page.mock.calls[0]![1] as {
        openPopup: (details: object) => { createWindow: (options: object) => unknown };
      }
    ).openPopup;
    const response = openPopup({ url: "https://example.test/post", postBody: { data: [] } });
    const returned = response.createWindow({});
    expect(returned).toBe(mocks.inertWindows[0]!.webContents);
    expect(mocks.inertWindows[0]!.webContents.setWindowOpenHandler).toHaveBeenCalledOnce();
    expect(mocks.popupSurface).not.toHaveBeenCalled();
    expect(mocks.page).toHaveBeenCalledTimes(1);
    expect(state().tabs).toHaveLength(1);
    expect(event().popupTabIDs).toEqual([]);
    expect(mocks.inertWindows[0]!.webContents.close).toHaveBeenCalledWith({
      waitForBeforeUnload: false,
    });
    await pane.dispose();
  });

  it("rejects an unadoptable child without adding a tab or navigating a replacement", async () => {
    const { pane, win, binding, state, event } = await attachedPane();
    await pane.command(win as never, binding, { type: "tabs.open" });
    await vi.waitFor(() => expect(state().tabs).toHaveLength(1));
    mocks.popupSurface.mockImplementationOnce(() => {
      throw new Error("Popup child session mismatch");
    });
    const openPopup = (
      mocks.page.mock.calls[0]![1] as {
        openPopup: (details: object) => { createWindow: (options: object) => unknown };
      }
    ).openPopup;
    const child = {
      setWindowOpenHandler: vi.fn(),
      isDestroyed: vi.fn(() => false),
      close: vi.fn(),
      loadURL: vi.fn(),
    };
    expect(
      openPopup({ url: "https://example.test/post", postBody: { data: [] } }).createWindow({
        webContents: child,
      }),
    ).toBe(child);
    expect(child.setWindowOpenHandler).toHaveBeenCalledOnce();
    expect(mocks.inertWindows).toHaveLength(0);
    expect(mocks.page).toHaveBeenCalledTimes(1);
    expect(state().tabs).toHaveLength(1);
    expect(event().popupTabIDs).toEqual([]);
    expect(child.close).toHaveBeenCalledWith({ waitForBeforeUnload: false });
    expect(child.loadURL).not.toHaveBeenCalled();
    await pane.dispose();
  });
});
