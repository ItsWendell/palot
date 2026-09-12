// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Tray } from "electron";
const state = vi.hoisted(() => ({
  mode: null as "light" | "dark" | null,
  desktop: new Set<() => void>(),
  native: new Set<() => void>(),
  probe: vi.fn(),
  image: vi.fn((file: string) => ({ file, isEmpty: () => false })),
}));
vi.mock("electron", () => ({
  nativeImage: { createFromPath: state.image },
  nativeTheme: {
    shouldUseDarkColors: true,
    on: (_event: string, listener: () => void) => state.native.add(listener),
    off: (_event: string, listener: () => void) => state.native.delete(listener),
  },
}));
vi.mock("./appearance-service", () => ({
  appearanceService: () => ({
    preferences: () => ({ mode: "dark", omarchyTheme: state.mode ? { mode: state.mode } : null }),
    onDesktopThemeChanged: (listener: () => void) => {
      state.desktop.add(listener);
      return () => state.desktop.delete(listener);
    },
  }),
}));
vi.mock("./linux-desktop", () => ({ desktopProbe: state.probe }));
import { followLinuxTrayAppearance } from "./tray-appearance";

beforeEach(() => {
  vi.clearAllMocks();
  state.mode = null;
  state.desktop.clear();
  state.native.clear();
  state.probe.mockResolvedValue("(<<uint32 1>>,)");
});
describe("Linux tray appearance", () => {
  it("follows Omarchy in both directions independently of a dark app preference", () => {
    state.mode = "light";
    const setImage = vi.fn();
    const stop = followLinuxTrayAppearance({ setImage } as unknown as Tray, "/icons/trayLinux.png");
    expect(setImage).toHaveBeenLastCalledWith(
      expect.objectContaining({ file: "/icons/trayLinuxLight.png" }),
    );
    state.mode = "dark";
    state.desktop.forEach((listener) => listener());
    expect(setImage).toHaveBeenLastCalledWith(
      expect.objectContaining({ file: "/icons/trayLinux.png" }),
    );
    state.native.forEach((listener) => listener());
    expect(setImage).toHaveBeenCalledTimes(2);
    expect(state.probe).not.toHaveBeenCalled();
    stop();
    expect(state.desktop.size).toBe(0);
    expect(state.native.size).toBe(0);
  });
  it("uses the system portal rather than the app's nativeTheme override", async () => {
    state.probe.mockResolvedValue("(<<uint32 2>>,)");
    const setImage = vi.fn();
    const stop = followLinuxTrayAppearance({ setImage } as unknown as Tray, "/icons/trayLinux.png");
    await vi.waitFor(() =>
      expect(setImage).toHaveBeenCalledWith(
        expect.objectContaining({ file: "/icons/trayLinuxLight.png" }),
      ),
    );
    stop();
  });
  it("ignores stale portal reads and pending updates after disposal", async () => {
    let resolve!: (value: string) => void;
    state.probe.mockImplementation(
      () =>
        new Promise<string>((done) => {
          resolve = done;
        }),
    );
    const setImage = vi.fn();
    const stop = followLinuxTrayAppearance({ setImage } as unknown as Tray, "/icons/trayLinux.png");
    state.mode = "dark";
    state.desktop.forEach((listener) => listener());
    resolve("(<<uint32 2>>,)");
    await Promise.resolve();
    expect(setImage).toHaveBeenCalledTimes(1);
    expect(setImage).toHaveBeenLastCalledWith(
      expect.objectContaining({ file: "/icons/trayLinux.png" }),
    );
    state.mode = null;
    state.native.forEach((listener) => listener());
    stop();
    resolve("(<<uint32 2>>,)");
    await Promise.resolve();
    expect(setImage).toHaveBeenCalledTimes(1);
  });
});
