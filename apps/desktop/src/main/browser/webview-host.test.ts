// @vitest-environment node
import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";

const electron = vi.hoisted(() => {
  const partitions = new Map<string, object>();
  return {
    partitions,
    fromPartition: vi.fn((name: string) => {
      if (!partitions.has(name)) partitions.set(name, { name });
      return partitions.get(name)!;
    }),
  };
});
vi.mock("electron", () => ({
  session: { fromPartition: electron.fromPartition },
}));

import { installBrowserWebviewHost, requestBrowserWebviewHost } from "./webview-host";

function owner() {
  const webContents = Object.assign(new EventEmitter(), { focus: vi.fn() });
  const win = { webContents, isDestroyed: () => false };
  installBrowserWebviewHost(win as never);
  return win;
}

function request(win: ReturnType<typeof owner>, overrides: Record<string, unknown> = {}) {
  const controller = new AbortController();
  const publish = vi.fn();
  const promise = requestBrowserWebviewHost(win as never, {
    tabID: "tab_test" as never,
    partition: "persist:browser-test",
    signal: controller.signal,
    current: () => true,
    publish,
    ...overrides,
  });
  const host = publish.mock.calls[0]?.[0];
  expect(host).toMatchObject({ tabID: "tab_test", partition: expect.any(String) });
  return { promise, host, controller, publish };
}

function attach(win: ReturnType<typeof owner>, params: Record<string, unknown>) {
  const event = { preventDefault: vi.fn() };
  const preferences: Record<string, unknown> = {
    preload: "/untrusted/preload.js",
    partition: "persist:untrusted",
    nodeIntegration: true,
    sandbox: false,
    additionalArguments: ["--untrusted"],
  };
  const attributes = {
    src: "about:blank",
    ...params,
  };
  win.webContents.emit("will-attach-webview", event, preferences, attributes);
  return { event, preferences, params: attributes };
}

function guest(win: ReturnType<typeof owner>, url: string, options: Record<string, unknown> = {}) {
  const contents = Object.assign(new EventEmitter(), {
    getURL: () => url,
    hostWebContents: win.webContents,
    session: electron.fromPartition("persist:browser-test"),
    close: vi.fn(),
    isDestroyed: () => false,
    isFocused: () => false,
    setWindowOpenHandler: vi.fn((_handler: () => unknown) => undefined),
    ...options,
  });
  win.webContents.emit("did-attach-webview", {}, contents);
  contents.emit("did-finish-load");
  return contents;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("webview host admission", () => {
  it("rejects unknown and cross-window leases, forbidden attributes, and replay", async () => {
    const win = owner();
    const other = owner();
    const { host, promise, controller } = request(win);
    expect(attach(win, { partition: "unknown" }).event.preventDefault).toHaveBeenCalledOnce();
    expect(
      attach(other, { partition: host.partition }).event.preventDefault,
    ).toHaveBeenCalledOnce();
    for (const attrs of [
      { src: "https://foreign.test/" },
      { preload: "/preload.js" },
      { webpreferences: "nodeIntegration=yes" },
    ]) {
      expect(
        attach(win, { partition: host.partition, ...attrs }).event.preventDefault,
      ).toHaveBeenCalledOnce();
    }
    const admission = attach(win, { partition: host.partition });
    expect(admission.event.preventDefault).not.toHaveBeenCalled();
    expect(attach(win, { partition: host.partition }).event.preventDefault).toHaveBeenCalledOnce();
    const contents = guest(win, admission.params.src as string);
    await expect(promise).resolves.toMatchObject({ contents });
    controller.abort();
  });

  it("rewrites bootstrap URL and forces the registered owner's secure session", async () => {
    const win = owner();
    const { host, promise } = request(win);
    const admission = attach(win, { partition: host.partition });
    expect(admission.params.src).toBe(`about:blank#palot-browser-host=${host.leaseID}`);
    expect(admission.preferences).toMatchObject({
      session: electron.fromPartition("persist:browser-test"),
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      nodeIntegrationInWorker: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      plugins: false,
      experimentalFeatures: false,
      devTools: false,
      backgroundThrottling: false,
      navigateOnDragDrop: false,
      focusOnNavigation: false,
      additionalArguments: [],
    });
    expect(admission.preferences).not.toHaveProperty("preload");
    expect(admission.preferences).not.toHaveProperty("partition");
    const contents = guest(win, admission.params.src as string);
    expect(contents.setWindowOpenHandler).toHaveBeenCalledOnce();
    expect(contents.setWindowOpenHandler.mock.calls[0]?.[0]()).toEqual({ action: "deny" });
    const surface = await promise;
    expect(surface.contents).toBe(contents);
    expect(surface.getVisible()).toBe(false);
    const bounds = { x: 20, y: 30, width: 100, height: 80 };
    surface.layout(bounds);
    surface.setVisible(true);
    expect(surface.getBounds()).toEqual(bounds);
    expect(surface.getVisible()).toBe(true);
    const released = surface.dispose();
    contents.emit("destroyed");
    await released;
  });

  it("releases keyboard focus and waits for the DOM owner to destroy the guest", async () => {
    const win = owner();
    const { host, promise, publish } = request(win);
    const admission = attach(win, { partition: host.partition });
    const contents = guest(win, admission.params.src as string, { isFocused: () => true });
    const surface = await promise;
    surface.setVisible(false);
    expect(win.webContents.focus).toHaveBeenCalledOnce();
    let settled = false;
    const released = Promise.resolve(surface.dispose()).then(() => {
      settled = true;
    });
    expect(publish).toHaveBeenLastCalledWith(null);
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(contents.close).not.toHaveBeenCalled();
    contents.emit("destroyed");
    await released;
    expect(settled).toBe(true);
  });

  it("rejects stale, wrong-session, and wrong-owner guests", async () => {
    for (const mismatch of [
      () => ({
        getURL: () => "about:blank#palot-browser-host=invalid",
      }),
      () => ({ session: electron.fromPartition("persist:wrong") }),
      () => ({ hostWebContents: owner().webContents }),
    ]) {
      const win = owner();
      const { host, promise, controller } = request(win);
      const rejected = promise.catch((error: Error) => error);
      const admission = attach(win, { partition: host.partition });
      const contents = guest(win, admission.params.src as string, mismatch());
      expect(contents.close).toHaveBeenCalledOnce();
      controller.abort();
      await expect(rejected).resolves.toMatchObject({
        message: "Browser host attachment cancelled",
      });
    }
  });

  it("rejects a lease that becomes stale before admission or guest load", async () => {
    const win = owner();
    let current = true;
    const { host, promise, controller } = request(win, { current: () => current });
    const rejected = promise.catch((error: Error) => error);
    current = false;
    expect(attach(win, { partition: host.partition }).event.preventDefault).toHaveBeenCalledOnce();
    current = true;
    const admission = attach(win, { partition: host.partition });
    current = false;
    expect(guest(win, admission.params.src as string).close).toHaveBeenCalledOnce();
    controller.abort();
    await expect(rejected).resolves.toMatchObject({
      message: "Browser host attachment cancelled",
    });
  });

  it("denies late bootstrap after cancellation or timeout", async () => {
    vi.useFakeTimers();
    for (const expire of ["abort", "timeout"] as const) {
      const win = owner();
      const { host, promise, controller, publish } = request(win);
      const rejected = promise.catch((error: Error) => error);
      const admission = attach(win, { partition: host.partition });
      if (expire === "abort") controller.abort();
      else await vi.advanceTimersByTimeAsync(10_000);
      await expect(rejected).resolves.toMatchObject({
        message:
          expire === "abort"
            ? "Browser host attachment cancelled"
            : "Browser webview did not attach in time",
      });
      expect(publish).toHaveBeenLastCalledWith(null);
      expect(guest(win, admission.params.src as string).close).toHaveBeenCalledOnce();
      expect(
        attach(win, { partition: host.partition }).event.preventDefault,
      ).toHaveBeenCalledOnce();
    }
  });

  it("revokes on owner navigation and closes attached guests", async () => {
    const win = owner();
    const { host, promise } = request(win);
    const admission = attach(win, { partition: host.partition });
    const contents = guest(win, admission.params.src as string);
    await promise;
    win.webContents.emit("did-start-navigation", {}, "https://elsewhere.test", false, true);
    expect(contents.close).toHaveBeenCalledOnce();
    expect(attach(win, { partition: host.partition }).event.preventDefault).toHaveBeenCalledOnce();
    expect(guest(win, admission.params.src as string).close).toHaveBeenCalledOnce();
  });

  it("is unavailable without an installed window owner", () => {
    const win = { webContents: new EventEmitter() };
    expect(() =>
      requestBrowserWebviewHost(win as never, {
        tabID: "tab_test" as never,
        partition: "persist:browser-test",
        signal: new AbortController().signal,
        current: () => true,
        publish: vi.fn(),
      }),
    ).toThrow("Browser webview host is unavailable");
  });
});
