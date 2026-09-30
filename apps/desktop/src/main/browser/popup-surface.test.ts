// @vitest-environment node
import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({
  windows: [] as Array<Record<string, any>>,
  fromWebContents: vi.fn(() => null as object | null),
}));
vi.mock("electron", () => ({
  BrowserWindow: class extends EventEmitter {
    static fromWebContents = fake.fromWebContents;
    options: Record<string, unknown>;
    visible = false;
    destroyed = false;
    showInactive = vi.fn(() => {
      this.visible = true;
    });
    show = vi.fn(() => {
      this.visible = true;
    });
    focus = vi.fn();
    hide = vi.fn(() => {
      this.visible = false;
    });
    destroy = vi.fn(() => {
      this.destroyed = true;
      this.visible = false;
    });
    loadURL = vi.fn();
    setTitle = vi.fn();
    isVisible = () => this.visible;
    isDestroyed = () => this.destroyed;
    getContentBounds = () => ({ x: 100, y: 200, width: 788, height: 568 });
    constructor(options: Record<string, unknown>) {
      super();
      this.options = options;
      fake.windows.push(this);
    }
  },
}));

import { createBrowserPopupSurface, popupWebPreferences } from "./popup-surface";

function fixture() {
  const session = { id: "expected" };
  const contents = Object.assign(new EventEmitter(), {
    session,
    isDestroyed: vi.fn(() => false),
    loadURL: vi.fn(),
    getURL: vi.fn(() => "about:blank"),
  });
  const owner = Object.assign(new EventEmitter(), {
    visible: true,
    minimized: false,
    destroyed: false,
    webContents: { isDestroyed: vi.fn(() => false) },
    isVisible() {
      return this.visible;
    },
    isMinimized() {
      return this.minimized;
    },
    isDestroyed() {
      return this.destroyed;
    },
  });
  return { owner, contents, session };
}

beforeEach(() => {
  fake.windows.length = 0;
  fake.fromWebContents.mockReset().mockReturnValue(null);
  vi.unstubAllEnvs();
});

describe("popup surface", () => {
  it("shows the committed origin instead of a site-controlled window title", () => {
    const { owner, contents, session } = fixture();
    const surface = createBrowserPopupSurface(
      owner as never,
      { webContents: contents } as never,
      session as never,
    );
    const window = fake.windows[0]!;
    expect(window.setTitle).toHaveBeenLastCalledWith("Palot Browser · about:blank");
    contents.getURL.mockReturnValue("https://login.example.test/path?private=value");
    contents.emit("did-navigate", {}, contents.getURL());
    expect(window.setTitle).toHaveBeenLastCalledWith("Palot Browser · https://login.example.test");
    const event = { preventDefault: vi.fn() };
    contents.emit("page-title-updated", event, "Trusted bank");
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(window.setTitle).toHaveBeenLastCalledWith("Palot Browser · https://login.example.test");
    surface.dispose();
    expect(contents.listenerCount("page-title-updated")).toBe(0);
  });
  it("refuses missing, destroyed, foreign-session, and already-owned children", () => {
    const { owner, contents, session } = fixture();
    const create = (options: object) =>
      createBrowserPopupSurface(owner as never, options, session as never);
    expect(() => create({})).toThrow("Popup child webContents is unavailable");
    contents.isDestroyed.mockReturnValue(true);
    expect(() => create({ webContents: contents })).toThrow(
      "Popup child webContents is unavailable",
    );
    contents.isDestroyed.mockReturnValue(false);
    expect(() => create({ webContents: { ...contents, session: {} } })).toThrow(
      "Popup child session mismatch",
    );
    fake.fromWebContents.mockReturnValue({});
    expect(() => create({ webContents: contents })).toThrow("Popup child already belongs");
    fake.fromWebContents.mockReturnValue(null);
    owner.destroyed = true;
    expect(() => create({ webContents: contents })).toThrow("Popup owner is unavailable");
    expect(fake.windows).toHaveLength(0);
  });

  it("uses only bounded geometry and fixed secure options, preserving the supplied child", () => {
    const { owner, contents, session } = fixture();
    const surface = createBrowserPopupSurface(
      owner as never,
      {
        webContents: contents,
        width: Infinity,
        height: 100_000,
        x: 90_000,
        y: -90_000,
        fullscreen: true,
        alwaysOnTop: true,
        modal: true,
        show: true,
        parent: {} as never,
        webPreferences: { nodeIntegration: true, preload: "/evil", session: {} as never },
      } as never,
      session as never,
    );
    const window = fake.windows[0]!;
    expect(surface.contents).toBe(contents);
    expect(surface.window).toBe(window);
    expect(window.options).toMatchObject({
      webContents: contents,
      parent: owner,
      width: 960,
      height: 1200,
      minWidth: 480,
      minHeight: 320,
      show: false,
      modal: false,
      autoHideMenuBar: true,
      webPreferences: popupWebPreferences(session as never),
    });
    for (const key of ["x", "y", "fullscreen", "alwaysOnTop"])
      expect(window.options).not.toHaveProperty(key);
    expect(window.options.webPreferences).not.toHaveProperty("preload");
    expect(window.options.webPreferences).not.toHaveProperty("partition");
    expect(contents.loadURL).not.toHaveBeenCalled();
    expect(window.loadURL).not.toHaveBeenCalled();
    surface.layout({ x: 10, y: 20, width: 30, height: 40 });
    expect(surface.getBounds()).toEqual({ x: 0, y: 0, width: 788, height: 568 });
    expect(window.options).toMatchObject({ width: 960, height: 1200 });
    surface.dispose();
  });

  it("gates requested visibility on the owner and reconciles hide/minimize/show/restore", () => {
    const { owner, contents, session } = fixture();
    const surface = createBrowserPopupSurface(
      owner as never,
      { webContents: contents } as never,
      session as never,
    );
    const window = fake.windows[0]!;
    expect(surface.getVisible()).toBe(false);
    surface.setVisible(true);
    expect(window.showInactive).toHaveBeenCalledOnce();
    expect(surface.getVisible()).toBe(true);
    owner.visible = false;
    owner.emit("hide");
    expect(surface.getVisible()).toBe(false);
    expect(window.hide).toHaveBeenCalledOnce();
    surface.focus?.();
    expect(window.focus).not.toHaveBeenCalled();
    owner.visible = true;
    owner.emit("show");
    expect(surface.getVisible()).toBe(true);
    owner.minimized = true;
    owner.emit("minimize");
    expect(surface.getVisible()).toBe(false);
    owner.minimized = false;
    owner.emit("restore");
    expect(surface.getVisible()).toBe(true);
    surface.setVisible(false);
    owner.emit("hide");
    owner.emit("show");
    expect(surface.getVisible()).toBe(false);
    surface.dispose();
  });

  it("focuses explicitly only when permitted and destroys immediately once", () => {
    const { owner, contents, session } = fixture();
    const surface = createBrowserPopupSurface(
      owner as never,
      { webContents: contents } as never,
      session as never,
    );
    const window = fake.windows[0]!;
    surface.focus?.();
    expect(window.show).toHaveBeenCalledOnce();
    expect(window.focus).toHaveBeenCalledOnce();
    surface.dispose();
    expect(window.destroy).toHaveBeenCalledOnce();
    expect(owner.listenerCount("show")).toBe(0);
    expect(owner.listenerCount("hide")).toBe(0);
    expect(owner.listenerCount("restore")).toBe(0);
    expect(owner.listenerCount("minimize")).toBe(0);
    surface.dispose();
    owner.emit("show");
    expect(window.destroy).toHaveBeenCalledOnce();
    expect(surface.getVisible()).toBe(false);
    expect(surface.getBounds()).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });

  it("does not steal focus in an inactive E2E session", () => {
    vi.stubEnv("PALOT_E2E_INACTIVE", "1");
    const { owner, contents, session } = fixture();
    const surface = createBrowserPopupSurface(
      owner as never,
      { webContents: contents } as never,
      session as never,
    );
    surface.focus?.();
    const window = fake.windows[0]!;
    expect(window.showInactive).toHaveBeenCalledOnce();
    expect(window.focus).not.toHaveBeenCalled();
    expect(window.show).not.toHaveBeenCalled();
    surface.dispose();
  });
});
