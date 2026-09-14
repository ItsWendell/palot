import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useTranscriptInfiniteScroll } from "./use-transcript-infinite-scroll";

function setup(overrides = {}) {
  const loadOlder = vi.fn(async () => true);
  const canLoad = vi.fn(() => true);
  const initial = {
    scopeID: "connection/session",
    resetKey: 0,
    firstVisibleIndex: 8 as number | null,
    ready: true,
    blocked: false,
    hasMore: true,
    failed: false,
    canLoad,
    loadOlder,
    ...overrides,
  };
  const hook = renderHook((input) => useTranscriptInfiniteScroll(input), { initialProps: initial });
  return { ...hook, initial, loadOlder, canLoad };
}

describe("virtual transcript infinite scroll", () => {
  it("loads when an upward reader reaches the near-top range, not on mount or programmatic scrolling", () => {
    const { rerender, initial, result, loadOlder } = setup();
    rerender({ ...initial, firstVisibleIndex: 0 });
    expect(loadOlder).not.toHaveBeenCalled();
    rerender(initial);
    act(() => result.current.onUpwardIntent());
    expect(loadOlder).not.toHaveBeenCalled();
    rerender({ ...initial, firstVisibleIndex: 1 });
    expect(loadOlder).toHaveBeenCalledOnce();
  });

  it.each([{ blocked: true }, { ready: false }, { failed: true }, { hasMore: false }])(
    "ignores gestures while unavailable: %j",
    (overrides) => {
      const { result, loadOlder } = setup({ firstVisibleIndex: 0, ...overrides });
      act(() => result.current.onUpwardIntent());
      expect(loadOlder).not.toHaveBeenCalled();
    },
  );

  it("waits for a virtual range instead of assuming missing geometry means the top", () => {
    const { rerender, initial, result, loadOlder } = setup({ firstVisibleIndex: null });
    act(() => result.current.onUpwardIntent());
    expect(loadOlder).not.toHaveBeenCalled();
    rerender({ ...initial, firstVisibleIndex: 0 });
    expect(loadOlder).toHaveBeenCalledOnce();
  });

  it("coalesces intent before query loading and does not chain requests after a prepend", () => {
    const { rerender, initial, result, loadOlder } = setup({ firstVisibleIndex: 1 });
    act(() => {
      result.current.onUpwardIntent();
      result.current.onUpwardIntent();
    });
    expect(loadOlder).toHaveBeenCalledOnce();
    rerender({ ...initial, blocked: true });
    act(() => result.current.onUpwardIntent());
    rerender({ ...initial, firstVisibleIndex: 0 });
    expect(loadOlder).toHaveBeenCalledOnce();
    act(() => result.current.onUpwardIntent());
    expect(loadOlder).toHaveBeenCalledTimes(2);
  });

  it("allows another explicit gesture after a short/same-turn page without needing to scroll away", () => {
    const { result, loadOlder } = setup({ firstVisibleIndex: 0 });
    expect(loadOlder).not.toHaveBeenCalled();
    act(() => result.current.onUpwardIntent());
    expect(loadOlder).toHaveBeenCalledOnce();
    act(() => result.current.onUpwardIntent());
    expect(loadOlder).toHaveBeenCalledTimes(2);
  });

  it("checks synchronous request ownership before the query loading render", () => {
    const { result, loadOlder, canLoad } = setup({ firstVisibleIndex: 0 });
    canLoad.mockReturnValue(false);
    act(() => result.current.onUpwardIntent());
    expect(loadOlder).not.toHaveBeenCalled();
    canLoad.mockReturnValue(true);
    act(() => result.current.onUpwardIntent());
    expect(loadOlder).toHaveBeenCalledOnce();
  });

  it("rechecks deferred intent on a new gesture at the top without a range change", () => {
    const { rerender, initial, result, loadOlder, canLoad } = setup();
    act(() => result.current.onUpwardIntent());
    // Request/anchor ownership can change synchronously before its loading render.
    canLoad.mockReturnValue(false);
    rerender({ ...initial, firstVisibleIndex: 0 });
    expect(loadOlder).not.toHaveBeenCalled();

    canLoad.mockReturnValue(true);
    expect(loadOlder).not.toHaveBeenCalled();
    act(() => result.current.onUpwardIntent());
    expect(loadOlder).toHaveBeenCalledOnce();
    rerender({ ...initial, firstVisibleIndex: 0 });
    expect(loadOlder).toHaveBeenCalledOnce();
  });

  it("discards pending user intent when navigation or restoration takes over", () => {
    const { rerender, initial, result, loadOlder } = setup();
    act(() => result.current.onUpwardIntent());
    rerender({ ...initial, blocked: true });
    rerender({ ...initial, firstVisibleIndex: 0 });
    expect(loadOlder).not.toHaveBeenCalled();
    act(() => result.current.onUpwardIntent());
    expect(loadOlder).toHaveBeenCalledOnce();
  });

  it("does not carry intent to another connection/session", () => {
    const { rerender, initial, result, loadOlder } = setup();
    act(() => result.current.onUpwardIntent());
    rerender({ ...initial, firstVisibleIndex: 0, scopeID: "another/session" });
    expect(loadOlder).not.toHaveBeenCalled();
  });

  it("clears intent on downward input or return to latest before a layout change", () => {
    const { rerender, initial, result, loadOlder } = setup();
    act(() => result.current.onUpwardIntent());
    act(() => result.current.clearIntent());
    rerender({ ...initial, firstVisibleIndex: 1 });
    expect(loadOlder).not.toHaveBeenCalled();
  });

  it("does not carry earlier reading intent across a new submission", () => {
    const { rerender, initial, result, loadOlder } = setup();
    act(() => result.current.onUpwardIntent());
    rerender({ ...initial, firstVisibleIndex: 1, resetKey: 1 });
    expect(loadOlder).not.toHaveBeenCalled();
  });

  it("uses the latest loader without requesting on callback identity changes", () => {
    const { rerender, initial, result, loadOlder } = setup({ firstVisibleIndex: 0 });
    const latest = vi.fn(async () => true);
    rerender({ ...initial, loadOlder: latest });
    expect(latest).not.toHaveBeenCalled();
    act(() => result.current.onUpwardIntent());
    expect(latest).toHaveBeenCalledOnce();
    expect(loadOlder).not.toHaveBeenCalled();
  });
});
