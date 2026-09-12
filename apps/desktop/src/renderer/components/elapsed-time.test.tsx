import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ElapsedTime } from "./elapsed-time";

const epoch = new Date("2026-09-11T12:00:00Z").getTime();

function setVisibility(value: DocumentVisibilityState) {
  vi.spyOn(document, "visibilityState", "get").mockReturnValue(value);
  act(() => document.dispatchEvent(new Event("visibilitychange")));
}

describe("ElapsedTime", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(epoch);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("shares one interval between counters without rerendering their parent", () => {
    const parentRender = vi.fn();
    const intervals = vi.spyOn(globalThis, "setInterval");
    function Parent() {
      parentRender();
      return (
        <>
          <ElapsedTime startedAt={epoch - 20_000} completedAt={null} running />
          <ElapsedTime startedAt={epoch - 64_000} completedAt={null} running />
        </>
      );
    }
    const view = render(<Parent />);

    expect(screen.getByText("20s")).toBeTruthy();
    expect(screen.getByText("1m 4s")).toBeTruthy();
    expect(intervals).toHaveBeenCalledTimes(1);
    expect(intervals).toHaveBeenCalledWith(expect.any(Function), 1_000);
    act(() => vi.advanceTimersByTime(1_000));
    expect(screen.getByText("21s")).toBeTruthy();
    expect(screen.getByText("1m 5s")).toBeTruthy();
    expect(parentRender).toHaveBeenCalledTimes(1);
    expect(intervals).toHaveBeenCalledTimes(1);

    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("uses wall time instead of accumulating interval ticks", () => {
    render(<ElapsedTime startedAt={epoch - 20_000} completedAt={null} running />);
    act(() => {
      vi.setSystemTime(epoch + 44_000);
      vi.advanceTimersByTime(1_000);
    });
    expect(screen.getByText("1m 5s")).toBeTruthy();
  });

  it("pauses while hidden and catches up immediately on visibility", () => {
    render(<ElapsedTime startedAt={epoch - 20_000} completedAt={null} running />);
    setVisibility("hidden");
    expect(vi.getTimerCount()).toBe(0);
    act(() => vi.advanceTimersByTime(45_000));
    expect(screen.getByText("20s")).toBeTruthy();

    setVisibility("visible");
    expect(screen.getByText("1m 5s")).toBeTruthy();
    expect(vi.getTimerCount()).toBe(1);
    act(() => vi.advanceTimersByTime(1_000));
    expect(screen.getByText("1m 6s")).toBeTruthy();
  });

  it("does not start a clock when mounted hidden and removes its listener on cleanup", () => {
    setVisibility("hidden");
    const addListener = vi.spyOn(document, "addEventListener");
    const removeListener = vi.spyOn(document, "removeEventListener");
    const view = render(<ElapsedTime startedAt={epoch - 5_000} completedAt={null} running />);
    expect(screen.getByText("5s")).toBeTruthy();
    expect(vi.getTimerCount()).toBe(0);
    const visibilityListener = addListener.mock.calls.find(([type]) => type === "visibilitychange");
    expect(visibilityListener).toBeDefined();
    view.unmount();
    expect(removeListener).toHaveBeenCalledWith("visibilitychange", visibilityListener![1]);
    setVisibility("visible");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps the clock until the last live counter is removed", () => {
    const first = render(<ElapsedTime startedAt={epoch - 5_000} completedAt={null} running />);
    const second = render(<ElapsedTime startedAt={epoch - 10_000} completedAt={null} running />);
    first.unmount();
    expect(vi.getTimerCount()).toBe(1);
    act(() => vi.advanceTimersByTime(1_000));
    expect(screen.getByText("11s")).toBeTruthy();
    second.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("freezes to completion timestamps and restarts from the new run rather than stale completion", () => {
    const view = render(<ElapsedTime startedAt={epoch - 20_000} completedAt={null} running />);
    view.rerender(
      <ElapsedTime
        startedAt={epoch - 20_000}
        completedAt={epoch - 5_000}
        fallbackDurationMs={99_000}
        running={false}
        titlePrefix="Returned after"
      />,
    );
    expect(screen.getByTitle("Returned after 15s").textContent).toBe("15s");
    expect(vi.getTimerCount()).toBe(0);
    act(() => vi.advanceTimersByTime(10_000));
    expect(screen.getByText("15s")).toBeTruthy();
    view.rerender(
      <ElapsedTime
        startedAt={epoch + 8_000}
        completedAt={epoch - 5_000}
        fallbackDurationMs={99_000}
        running
      />,
    );
    expect(screen.getByText("2s")).toBeTruthy();
    expect(vi.getTimerCount()).toBe(1);
    act(() => vi.advanceTimersByTime(1_000));
    expect(screen.getByText("3s")).toBeTruthy();
  });

  it("freezes to a fallback without subscribing when completion timestamps are missing", () => {
    const addListener = vi.spyOn(document, "addEventListener");
    render(
      <ElapsedTime
        startedAt={epoch}
        completedAt={null}
        fallbackDurationMs={65_000}
        running={false}
      />,
    );
    expect(screen.getByText("1m 5s")).toBeTruthy();
    expect(vi.getTimerCount()).toBe(0);
    expect(addListener.mock.calls.filter(([type]) => type === "visibilitychange")).toHaveLength(0);
    act(() => vi.advanceTimersByTime(60_000));
    expect(screen.getByText("1m 5s")).toBeTruthy();
  });

  it.each([
    { startedAt: epoch, completedAt: null, running: false },
    { startedAt: null, completedAt: epoch, running: false },
    { startedAt: null, completedAt: epoch, fallbackDurationMs: 65_000, running: true },
    { startedAt: Number.NaN, completedAt: epoch, fallbackDurationMs: 65_000, running: true },
    {
      startedAt: null,
      completedAt: null,
      fallbackDurationMs: Number.POSITIVE_INFINITY,
      running: false,
    },
  ])("omits unreliable duration data: %j", (props) => {
    const view = render(<ElapsedTime {...props} />);
    expect(view.container.textContent).toBe("");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears a completed fallback when a resumed run has no start timestamp", () => {
    const view = render(
      <ElapsedTime
        startedAt={null}
        completedAt={null}
        fallbackDurationMs={65_000}
        running={false}
      />,
    );
    expect(screen.getByText("1m 5s")).toBeTruthy();
    view.rerender(
      <ElapsedTime startedAt={null} completedAt={null} fallbackDurationMs={65_000} running />,
    );
    expect(view.container.textContent).toBe("");
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    { startedAt: epoch + 5_000, completedAt: null, running: true },
    { startedAt: epoch, completedAt: epoch - 5_000, running: false },
    { startedAt: null, completedAt: null, fallbackDurationMs: -5_000, running: false },
    { startedAt: 0, completedAt: 0, running: false },
  ])("clamps negative durations and preserves zero: %j", (props) => {
    render(<ElapsedTime {...props} />);
    expect(screen.getByText("0s")).toBeTruthy();
  });

  it("preserves large duration text without adding live announcements", () => {
    const view = render(<ElapsedTime startedAt={0} completedAt={60_000_005_000} running={false} />);
    expect(screen.getByText("1000000m 5s")).toBeTruthy();
    expect(view.container.querySelector("[aria-live], [role='status']")).toBeNull();
  });
});
