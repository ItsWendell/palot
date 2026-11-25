import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FIRST_PAINT_FALLBACK_MS,
  presentWhenReady,
  startupWindowPresentation,
} from "./window-startup";

describe("startupWindowPresentation", () => {
  it("keeps an explicitly hidden development window hidden", () => {
    expect(startupWindowPresentation({ PALOT_START_HIDDEN: "1" })).toBe("hidden");
  });

  it("preserves inactive visible E2E launches", () => {
    expect(startupWindowPresentation({ PALOT_E2E_INACTIVE: "1" })).toBe("inactive");
  });

  it("supports visible inactive development launches", () => {
    expect(startupWindowPresentation({ PALOT_START_INACTIVE: "1" })).toBe("inactive");
  });

  it("focuses ordinary launches", () => {
    expect(startupWindowPresentation({})).toBe("focused");
  });
});

describe("presentWhenReady", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function fakeWindow() {
    const window = Object.assign(new EventEmitter(), {
      destroyed: false,
      isDestroyed: () => window.destroyed,
      webContents: new EventEmitter(),
    });
    return window;
  }

  it("presents on the first paint, once", () => {
    vi.useFakeTimers();
    const window = fakeWindow();
    const present = vi.fn();
    presentWhenReady(window, present);
    window.webContents.emit("did-finish-load");
    window.emit("ready-to-show");
    vi.advanceTimersByTime(FIRST_PAINT_FALLBACK_MS);
    expect(present).toHaveBeenCalledOnce();
  });

  it("presents after the load when the first paint never comes", () => {
    vi.useFakeTimers();
    const window = fakeWindow();
    const present = vi.fn();
    presentWhenReady(window, present);
    window.webContents.emit("did-finish-load");
    vi.advanceTimersByTime(FIRST_PAINT_FALLBACK_MS - 1);
    expect(present).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(present).toHaveBeenCalledOnce();
    window.emit("ready-to-show");
    expect(present).toHaveBeenCalledOnce();
  });

  it("leaves a destroyed window alone", () => {
    vi.useFakeTimers();
    const window = fakeWindow();
    const present = vi.fn();
    presentWhenReady(window, present);
    window.webContents.emit("did-finish-load");
    window.destroyed = true;
    vi.advanceTimersByTime(FIRST_PAINT_FALLBACK_MS);
    expect(present).not.toHaveBeenCalled();
  });
});
