// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const screen = vi.hoisted(() => ({
  getDisplayNearestPoint: vi.fn(),
  getCursorScreenPoint: vi.fn(),
}));
vi.mock("electron", () => ({ screen }));

import { popupNativeContextMenu } from "./native-menu-popup";

describe("popupNativeContextMenu", () => {
  const bounds = { x: 449, y: 214, width: 1920, height: 1080 };
  const params = { x: 120, y: 80, menuSourceType: "mouse" as const };
  const popup = vi.fn();
  const menu = { popup } as unknown as Electron.Menu;
  const window = {
    isDestroyed: () => false,
    webContents: { isDestroyed: () => false },
    getContentBounds: () => ({ x: 600, y: 300, width: 900, height: 700 }),
  } as unknown as Electron.BrowserWindow;

  beforeEach(() => {
    vi.spyOn(process, "platform", "get").mockReturnValue("linux");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    screen.getDisplayNearestPoint.mockReturnValue({ bounds, workArea: bounds });
    screen.getCursorScreenPoint.mockReturnValue({ x: 700, y: 400 });
    popup.mockClear();
  });
  afterEach(() => vi.restoreAllMocks());

  it("uses the originating event's coordinates and source, not the current cursor", () => {
    expect(popupNativeContextMenu(menu, window, { ...params, menuSourceType: "keyboard" })).toBe(
      true,
    );
    expect(screen.getDisplayNearestPoint).toHaveBeenCalledWith({ x: 720, y: 380 });
    expect(screen.getCursorScreenPoint).not.toHaveBeenCalled();
    expect(popup).toHaveBeenCalledWith({ window, x: 120, y: 80, sourceType: "keyboard" });
  });

  it.each(["bounds", "workArea"])("does not enter native popup with empty %s", (field) => {
    screen.getDisplayNearestPoint.mockReturnValue({
      bounds,
      workArea: bounds,
      [field]: { x: 449, y: 214, width: 0, height: 0 },
    });
    expect(popupNativeContextMenu(menu, window, params)).toBe(false);
    expect(popup).not.toHaveBeenCalled();
    // No sticky disable: a reconnected display restores menus on the next event.
    screen.getDisplayNearestPoint.mockReturnValue({ bounds, workArea: bounds });
    expect(popupNativeContextMenu(menu, window, params)).toBe(true);
    expect(popup).toHaveBeenCalledOnce();
  });

  it.each([
    { x: -1, y: 80 },
    { x: 120, y: -1 },
  ])("rejects a cursor sentinel that cannot be preflighted on Wayland: %j", (point) => {
    expect(popupNativeContextMenu(menu, window, { ...params, ...point })).toBe(false);
    expect(screen.getDisplayNearestPoint).not.toHaveBeenCalled();
    expect(screen.getCursorScreenPoint).not.toHaveBeenCalled();
    expect(popup).not.toHaveBeenCalled();
  });

  it("does not query geometry or open a popup after window destruction", () => {
    const destroyed = { ...window, isDestroyed: () => true } as Electron.BrowserWindow;
    expect(popupNativeContextMenu(menu, destroyed, params)).toBe(false);
    expect(screen.getDisplayNearestPoint).not.toHaveBeenCalled();
    expect(popup).not.toHaveBeenCalled();
  });

  it("leaves non-Linux native menus independent of the Linux geometry guard", () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("darwin");
    expect(popupNativeContextMenu(menu, window, params)).toBe(true);
    expect(screen.getDisplayNearestPoint).not.toHaveBeenCalled();
  });
});
