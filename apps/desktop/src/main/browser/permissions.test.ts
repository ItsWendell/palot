// @vitest-environment node
import type { Session, WebContents } from "electron";
import { afterEach, describe, expect, it, vi } from "vitest";
import { installBrowserPermissions } from "./permissions";

const guest = { id: 7 } as WebContents;
const stranger = { id: 99 } as WebContents;
const SITE = "http://localhost:3000";

function setup(systemAccess = vi.fn(async () => true)) {
  const target = {
    setPermissionRequestHandler: vi.fn(),
    setPermissionCheckHandler: vi.fn(),
    setDevicePermissionHandler: vi.fn(),
    setDisplayMediaRequestHandler: vi.fn(),
  };
  const notify = vi.fn();
  const reloadOrigin = vi.fn();
  const permissions = installBrowserPermissions(target as unknown as Session, {
    tabFor: (contents) => (contents === guest ? ("tab_1" as never) : null),
    notify,
    systemAccess,
    reloadOrigin,
    timeoutMs: 1_000,
  });
  const requestHandler = target.setPermissionRequestHandler.mock.calls[0]![0];
  const checkHandler = target.setPermissionCheckHandler.mock.calls[0]![0];
  const request = (
    mediaTypes: string[],
    options: {
      contents?: WebContents;
      url?: string;
      mainFrame?: boolean;
      permission?: string;
    } = {},
  ) => {
    const callback = vi.fn();
    requestHandler(options.contents ?? guest, options.permission ?? "media", callback, {
      mediaTypes,
      requestingUrl: options.url ?? `${SITE}/call`,
      isMainFrame: options.mainFrame ?? true,
    });
    return callback;
  };
  const check = (mediaType: string) =>
    checkHandler(guest, "media", SITE, {
      mediaType,
      requestingUrl: `${SITE}/call`,
      isMainFrame: true,
    });
  const prompt = () => notify.mock.lastCall?.[0].requests[0];
  return { target, permissions, notify, reloadOrigin, request, check, prompt, systemAccess };
}

afterEach(() => vi.useRealTimers());

describe("browser permissions", () => {
  it("asks once per site, then remembers allow until revoked", async () => {
    const harness = setup();
    const first = harness.request(["audio"]);
    expect(first).not.toHaveBeenCalled();
    expect(harness.prompt()).toMatchObject({ tabID: "tab_1", origin: SITE, kinds: ["microphone"] });
    expect(harness.check("audio")).toBe(false);

    await harness.permissions.decide(harness.prompt().id, "allow");
    expect(first).toHaveBeenCalledWith(true);
    expect(harness.check("audio")).toBe(true);
    expect(harness.check("video")).toBe(false);
    const again = harness.request(["audio"]);
    await vi.waitFor(() => expect(again).toHaveBeenCalledWith(true));
    expect(harness.notify.mock.lastCall?.[0].grants).toEqual([
      { origin: SITE, microphone: "allow" },
    ]);

    harness.permissions.revoke(SITE);
    expect(harness.reloadOrigin).toHaveBeenCalledWith(SITE);
    expect(harness.check("audio")).toBe(false);
    harness.request(["audio"]);
    expect(harness.prompt()).toBeDefined();
  });

  it("remembers block, and refuses an unanswered prompt after the timeout", async () => {
    vi.useFakeTimers();
    const harness = setup();
    const ignored = harness.request(["audio", "video"]);
    expect(harness.prompt().kinds).toEqual(["microphone", "camera"]);
    vi.advanceTimersByTime(1_000);
    expect(ignored).toHaveBeenCalledWith(false);
    expect(harness.notify.mock.lastCall?.[0].requests).toEqual([]);

    const blocked = harness.request(["video"]);
    await harness.permissions.decide(harness.prompt().id, "block");
    expect(blocked).toHaveBeenCalledWith(false);
    const later = harness.request(["video"]);
    expect(later).toHaveBeenCalledWith(false);
    expect(harness.notify.mock.lastCall?.[0].requests).toEqual([]);
  });

  it("refuses when the operating system denies the device", async () => {
    const harness = setup(vi.fn(async () => false));
    const callback = harness.request(["audio"]);
    await harness.permissions.decide(harness.prompt().id, "allow");
    expect(callback).toHaveBeenCalledWith(false);
  });

  it.each([
    ["another permission", { permission: "notifications" }, ["audio"]],
    ["screen capture", {}, ["audio", "desktop_video_capture"]],
    ["a subframe", { mainFrame: false }, ["audio"]],
    ["a page outside this task", { contents: stranger }, ["audio"]],
    ["a file page", { url: "file:///tmp/call.html" }, ["audio"]],
  ])("refuses %s without asking", (_, options, mediaTypes) => {
    const harness = setup();
    const callback = harness.request(mediaTypes, options);
    expect(callback).toHaveBeenCalledWith(false);
    expect(harness.notify).not.toHaveBeenCalled();
  });

  it("refuses pending prompts and forgets answers when the browser closes", () => {
    const harness = setup();
    const callback = harness.request(["audio"]);
    harness.permissions.dispose();
    expect(callback).toHaveBeenCalledWith(false);
    expect(harness.request(["audio"])).toHaveBeenCalledWith(false);
  });
});
