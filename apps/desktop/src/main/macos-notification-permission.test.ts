import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Settings = {
  authorizationStatus(): number;
  alertSetting(): number;
  notificationCenterSetting(): number;
};
type NativeError = { localizedDescription(): { toString(): string } };

const native = vi.hoisted(() => ({
  settings: vi.fn<(callback: (settings: Settings) => void) => void>(),
  request:
    vi.fn<
      (options: number, callback: (granted: boolean, error: NativeError | null) => void) => void
    >(),
  run: vi.fn(),
  stop: vi.fn(),
}));

vi.mock("objc-js", () => ({
  NobjcLibrary: class {
    UNUserNotificationCenter = {
      currentNotificationCenter: () => ({
        getNotificationSettingsWithCompletionHandler$: native.settings,
        requestAuthorizationWithOptions$completionHandler$: native.request,
      }),
    };
  },
  RunLoop: { run: native.run },
  typedBlock: (_signature: unknown, callback: unknown) => callback,
}));

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  native.settings.mockReset();
  native.request.mockReset();
  native.run.mockReturnValue(native.stop);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("macOS notification callbacks", () => {
  it.each([true, false])(
    "waits beyond ten seconds for a human decision: granted=%s",
    async (granted) => {
      const { requestMacosNotificationPermission } =
        await import("./macos-notification-permission");
      native.request.mockImplementation((_options, callback) => {
        setTimeout(() => callback(granted, null), 30_000);
      });
      const settled = vi.fn();
      const request = requestMacosNotificationPermission();
      void request.then(settled, settled);

      await vi.dynamicImportSettled();
      await vi.advanceTimersByTimeAsync(10_001);
      expect(native.request).toHaveBeenCalledOnce();
      expect(settled).not.toHaveBeenCalled();
      expect(native.stop).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(20_000);
      await expect(request).resolves.toBeUndefined();
      expect(native.stop).toHaveBeenCalledOnce();
    },
  );

  it("bounds a stalled settings query without stopping a pending permission request", async () => {
    const { macosNotificationDeliveryStatus, requestMacosNotificationPermission } =
      await import("./macos-notification-permission");
    const request = requestMacosNotificationPermission();
    void request.catch(() => undefined);
    // Let the bridge mock load before starting another query: concurrent dynamic
    // mock imports can fall through to the macOS-only package on Linux. The
    // permission callback remains pending while the settings query times out.
    await vi.dynamicImportSettled();
    expect(native.request).toHaveBeenCalledOnce();
    const settings = macosNotificationDeliveryStatus();
    const result = expect(settings).rejects.toThrow("macOS did not return notification settings");

    await vi.dynamicImportSettled();
    await vi.advanceTimersByTimeAsync(10_001);
    await result;
    expect(native.run).toHaveBeenCalledOnce();
    expect(native.stop).not.toHaveBeenCalled();

    native.request.mock.calls[0]![1](true, null);
    await request;
    expect(native.stop).toHaveBeenCalledOnce();
    native.settings.mock.calls[0]![0]({
      authorizationStatus: () => 2,
      alertSetting: () => 2,
      notificationCenterSetting: () => 2,
    });
    expect(native.stop).toHaveBeenCalledOnce();
  });

  it("preserves a native authorization error and releases the run loop", async () => {
    const { requestMacosNotificationPermission } = await import("./macos-notification-permission");
    native.request.mockImplementation((_options, callback) => {
      setTimeout(
        () => callback(false, { localizedDescription: () => "Authorization unavailable" }),
        30_000,
      );
    });
    const request = requestMacosNotificationPermission();
    const result = expect(request).rejects.toThrow("Authorization unavailable");
    await vi.dynamicImportSettled();
    await vi.advanceTimersByTimeAsync(30_000);
    await result;
    expect(native.stop).toHaveBeenCalledOnce();
  });

  it.each(["settings", "permission"])(
    "rejects when starting the native %s call throws",
    async (kind) => {
      const { macosNotificationDeliveryStatus, requestMacosNotificationPermission } =
        await import("./macos-notification-permission");
      const error = new Error("Native bridge failed");
      const fail = () => {
        throw error;
      };
      native.settings.mockImplementation(fail);
      native.request.mockImplementation(fail);

      const request =
        kind === "settings"
          ? macosNotificationDeliveryStatus()
          : requestMacosNotificationPermission();
      await expect(request).rejects.toBe(error);
      expect(native.stop).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("rejects and releases the run loop if reading an asynchronous native error throws", async () => {
    const { requestMacosNotificationPermission } = await import("./macos-notification-permission");
    const error = new Error("Native error object is unavailable");
    const request = requestMacosNotificationPermission();
    const result = expect(request).rejects.toBe(error);
    await vi.dynamicImportSettled();

    expect(() =>
      native.request.mock.calls[0]![1](false, {
        localizedDescription: () => {
          throw error;
        },
      }),
    ).not.toThrow();
    await result;
    expect(native.stop).toHaveBeenCalledOnce();
  });

  it("returns settings and ignores duplicate callbacks after releasing the run loop", async () => {
    const { macosNotificationDeliveryStatus } = await import("./macos-notification-permission");
    const request = macosNotificationDeliveryStatus();
    await vi.dynamicImportSettled();
    const callback = native.settings.mock.calls[0]![0];
    const settings = {
      authorizationStatus: () => 2,
      alertSetting: () => 2,
      notificationCenterSetting: () => 2,
    };
    callback(settings);
    callback(settings);

    await expect(request).resolves.toEqual({ authorization: "authorized", delivery: "alerts" });
    expect(native.stop).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});
