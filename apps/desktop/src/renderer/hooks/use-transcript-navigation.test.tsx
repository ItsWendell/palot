import { act, cleanup, renderHook } from "@testing-library/react";
import type { Virtualizer } from "@tanstack/react-virtual";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { TranscriptProjectionRow } from "../lib/turn-projection";
import { useTranscriptNavigation } from "./use-transcript-navigation";

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function row(id: string): TranscriptProjectionRow {
  return {
    id: `turn-${id}`,
    turn: { user: { id }, users: [{ id }] },
  } as unknown as TranscriptProjectionRow;
}
function prompts(rows: TranscriptProjectionRow[]) {
  return rows.flatMap((row, rowIndex) =>
    row.turn.user
      ? [
          {
            messageID: row.turn.user.id,
            turnID: row.id,
            rowIndex,
            label: row.turn.user.id,
          },
        ]
      : [],
  );
}
const geometry = { getTotalSize: () => 1000, getVirtualItems: () => [] };
it("pins the stable message's turn and re-resolves its virtual index after prepend", () => {
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn(() => 1),
  );
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  const scrollToIndex = vi.fn();
  const unlock = vi.fn();
  const pin = vi.fn();
  const props = {
    scopeID: "connection/session",
    bottomInset: 100,
    viewport: { current: document.createElement("div") },
    virtualizer: { ...geometry, scrollToIndex } as unknown as Virtualizer<HTMLDivElement, Element>,
    unlock,
    pin,
    clearAnchor: vi.fn(),
    hasMore: true,
    loading: false,
    historyStartID: "b",
    loadOlder: vi.fn(async () => true),
  };
  const { result, rerender } = renderHook(
    ({ rows }) => useTranscriptNavigation({ ...props, rows, prompts: prompts(rows) }),
    { initialProps: { rows: [row("b"), row("c")] } },
  );
  act(() => result.current.jump("b"));
  expect(unlock).toHaveBeenCalled();
  expect(pin).toHaveBeenCalledWith("turn-b");
  expect(scrollToIndex).toHaveBeenLastCalledWith(0, { align: "start" });
  rerender({ rows: [row("a"), row("b"), row("c")] });
  expect(scrollToIndex).toHaveBeenLastCalledWith(1, { align: "start" });
});

function paginationHarness(indexed = false) {
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn(() => 1),
  );
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  const pages: Array<{ resolve(value: boolean): void; reject(error: Error): void }> = [];
  const loadOlder = vi.fn(
    () => new Promise<boolean>((resolve, reject) => pages.push({ resolve, reject })),
  );
  const scrollToIndex = vi.fn();
  const pin = vi.fn();
  const hook = renderHook(
    ({ rows, historyStartID, loading }) =>
      useTranscriptNavigation({
        scopeID: "connection/session",
        bottomInset: 100,
        rows,
        prompts: prompts(rows),
        indexedPrompts: indexed ? prompts([row("a"), row("b"), row("c")]) : undefined,
        historyStartID,
        loading,
        viewport: { current: document.createElement("div") },
        virtualizer: { ...geometry, scrollToIndex } as unknown as Virtualizer<
          HTMLDivElement,
          Element
        >,
        pin,
        unlock: vi.fn(),
        clearAnchor: vi.fn(),
        hasMore: true,
        loadOlder,
      }),
    { initialProps: { rows: [row("b"), row("c")], historyStartID: "b", loading: false } },
  );
  act(() => hook.result.current.jump("b"));
  act(() => hook.result.current.move("previous"));
  return { ...hook, pages, loadOlder, pin, scrollToIndex };
}

const assistant = {
  id: "turn-assistant",
  turn: { user: null, users: [] },
} as unknown as TranscriptProjectionRow;

it("continues past an assistant-only page and jumps when an earlier user prompt arrives", async () => {
  const view = paginationHarness();
  expect(view.loadOlder).toHaveBeenCalledTimes(1);
  view.rerender({
    rows: [assistant, row("b"), row("c")],
    historyStartID: "assistant",
    loading: true,
  });
  await act(async () => view.pages[0]!.resolve(true));
  // Wait for projection hydration, even after the request completes.
  expect(view.loadOlder).toHaveBeenCalledTimes(1);
  view.rerender({
    rows: [assistant, row("b"), row("c")],
    historyStartID: "assistant",
    loading: false,
  });
  expect(view.loadOlder).toHaveBeenCalledTimes(2);
  view.rerender({
    rows: [row("a"), assistant, row("b"), row("c")],
    historyStartID: "a",
    loading: false,
  });
  await act(async () => view.pages[1]!.resolve(true));
  expect(view.loadOlder).toHaveBeenCalledTimes(2);
  expect(view.pin).toHaveBeenLastCalledWith("turn-a");
  expect(view.scrollToIndex).toHaveBeenLastCalledWith(0, { align: "start" });
});

it("loads an indexed but unhydrated prompt before resolving its actual turn", async () => {
  const view = paginationHarness(true);
  expect(view.loadOlder).toHaveBeenCalledTimes(1);
  view.rerender({
    rows: [assistant, row("b"), row("c")],
    historyStartID: "assistant",
    loading: false,
  });
  await act(async () => view.pages[0]!.resolve(true));
  expect(view.loadOlder).toHaveBeenCalledTimes(2);
  view.rerender({
    rows: [row("a"), assistant, row("b"), row("c")],
    historyStartID: "a",
    loading: false,
  });
  await act(async () => view.pages[1]!.resolve(true));
  expect(view.pin).toHaveBeenLastCalledWith("turn-a");
  expect(view.scrollToIndex).toHaveBeenLastCalledWith(0, { align: "start" });
});

it("does not resume an indexed history jump after manual cancellation", async () => {
  const view = paginationHarness(true);
  act(() => view.result.current.cancel());
  view.rerender({
    rows: [assistant, row("b"), row("c")],
    historyStartID: "assistant",
    loading: false,
  });
  await act(async () => view.pages[0]!.resolve(true));
  expect(view.loadOlder).toHaveBeenCalledTimes(1);
});

it.each(["failure", "no progress", "rejection"])(
  "stops automatic pagination after %s",
  async (outcome) => {
    const view = paginationHarness();
    // A streamed tail update is not evidence that the history page advanced.
    view.rerender({ rows: [row("b"), row("c"), assistant], historyStartID: "b", loading: false });
    await act(async () => {
      if (outcome === "rejection") view.pages[0]!.reject(new Error("Page unavailable"));
      else view.pages[0]!.resolve(outcome === "no progress");
    });
    expect(view.loadOlder).toHaveBeenCalledTimes(1);
    // A later independent history update must not resurrect the cancelled navigation.
    view.rerender({
      rows: [assistant, row("b"), row("c")],
      historyStartID: "assistant",
      loading: false,
    });
    expect(view.loadOlder).toHaveBeenCalledTimes(1);
    expect(view.pin).not.toHaveBeenCalledWith("turn-a");
  },
);

function navigationHarness({
  width = 1000,
  height = 500,
  totalSize = 2000,
  promptCount = 4,
  mounted = true,
} = {}) {
  let nextFrame = 0;
  const frames = new Map<number, FrameRequestCallback>();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  let measureViewport = () => {};
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        measureViewport = callback;
      }
      observe() {}
      disconnect() {}
    },
  );
  const viewport = document.createElement("div");
  Object.defineProperties(viewport, {
    clientWidth: { value: width, configurable: true },
    clientHeight: { value: height, configurable: true },
    scrollHeight: { value: totalSize, configurable: true },
  });
  const element = document.createElement("div");
  element.dataset.turnRowId = "turn-b";
  const measure = vi
    .spyOn(element, "getBoundingClientRect")
    .mockReturnValue({ top: 100 } as DOMRect);
  viewport.append(element);
  const rows = [row("a"), row("b"), row("c"), row("d")].slice(0, promptCount);
  const input = {
    rows,
    prompts: prompts(rows),
    viewport: { current: mounted ? viewport : null } as { current: HTMLDivElement | null },
    bottomInset: 100,
    virtualizer: {
      scrollToIndex: vi.fn(),
      getTotalSize: () => totalSize,
      getVirtualItems: () => [
        { index: 0, start: 0, end: 100 },
        { index: 1, start: 100, end: 900 },
        { index: 2, start: 900, end: 1800 },
        { index: 3, start: 1800, end: 2000 },
      ],
    } as unknown as Virtualizer<HTMLDivElement, Element>,
    pin: vi.fn(),
    unlock: vi.fn(),
    clearAnchor: vi.fn(),
    hasMore: false,
    loading: false,
    historyStartID: "a",
    loadOlder: vi.fn(async () => false),
  };
  const hook = renderHook(({ scopeID }) => useTranscriptNavigation({ ...input, scopeID }), {
    initialProps: { scopeID: "connection/session" },
  });
  function flush() {
    const pending = [...frames.values()];
    frames.clear();
    act(() => pending.forEach((callback) => callback(performance.now())));
  }
  function resize(width: number, height?: number) {
    Object.defineProperty(viewport, "clientWidth", { value: width, configurable: true });
    if (height !== undefined)
      Object.defineProperty(viewport, "clientHeight", { value: height, configurable: true });
    act(() => measureViewport());
  }
  return { ...hook, frames, viewport, measure, input, flush, resize };
}

it.each([320, 600, 863, 864, 1000])(
  "keeps prompt navigation available at pane width %s",
  (width) => {
    const view = navigationHarness({ width });
    expect(view.result.current.railVisible).toBe(true);
    expect(view.result.current.railCompact).toBe(width < 864);
    view.viewport.scrollTop = 400;
    view.flush();
    expect(view.result.current.activeMessageID).toBe("b");
    act(() => view.result.current.jump("c"));
    expect(view.input.pin).toHaveBeenLastCalledWith("turn-c");
    expect(view.input.virtualizer.scrollToIndex).toHaveBeenLastCalledWith(2, { align: "start" });
  },
);

it.each([
  { width: 320, promptCount: 3 },
  { width: 1000, promptCount: 3 },
  { width: 320, height: 250 },
  { width: 1000, height: 250 },
  { width: 320, totalSize: 500 },
  { width: 1000, totalSize: 500 },
])("still requires enough prompts, usable height, and overflow: %j", (geometry) => {
  const view = navigationHarness(geometry);
  expect(view.result.current.railVisible).toBe(false);
});

it("shows the rail once a viewport that mounts after the first render is measured", () => {
  // A cold transcript load mounts the scroll viewport only after its first page arrives.
  const view = navigationHarness({ mounted: false });
  expect(view.result.current.railVisible).toBe(false);
  view.input.viewport.current = view.viewport;
  view.rerender({ scopeID: "connection/session" });
  expect(view.result.current.railVisible).toBe(true);
});

it("switches compact presentation on pane resize without losing current-position tracking", () => {
  const view = navigationHarness();
  view.viewport.scrollTop = 400;
  view.flush();
  view.resize(600);
  expect(view.result.current.railVisible).toBe(true);
  expect(view.result.current.railCompact).toBe(true);
  expect(view.result.current.activeMessageID).toBe("b");
  view.viewport.scrollTop = 0;
  act(() => view.viewport.dispatchEvent(new Event("scroll")));
  view.flush();
  expect(view.result.current.activeMessageID).toBe("a");
  view.resize(864);
  expect(view.result.current.railVisible).toBe(true);
  expect(view.result.current.railCompact).toBe(false);
  expect(view.result.current.activeMessageID).toBe("a");
});

it("uses actual viewport intersection, not pinned membership, for the active prompt", () => {
  const view = navigationHarness();
  view.viewport.scrollTop = 400;
  view.flush();
  expect(view.result.current.railVisible).toBe(true);
  expect(view.result.current.activeMessageID).toBe("b");
});

it("selects the latest prompt at the actual bottom even when the preceding exchange is still at the reading line", () => {
  const view = navigationHarness();
  view.viewport.scrollTop = 1500;
  view.flush();
  expect(view.result.current.activeMessageID).toBe("d");
  view.viewport.scrollTop = 1490;
  act(() => view.viewport.dispatchEvent(new Event("scroll")));
  view.flush();
  expect(view.result.current.activeMessageID).toBe("c");
});

it("uses browser extent rather than virtual estimates and tolerates fractional end offsets", () => {
  const view = navigationHarness({ totalSize: 10_000 });
  Object.defineProperty(view.viewport, "scrollHeight", { value: 2000, configurable: true });
  view.viewport.scrollTop = 1499.5;
  view.flush();
  expect(view.result.current.activeMessageID).toBe("d");
});

it("updates selection after viewport resize without a scroll event", () => {
  const view = navigationHarness();
  view.viewport.scrollTop = 1400;
  view.flush();
  expect(view.result.current.activeMessageID).toBe("c");
  view.resize(1000, 600);
  view.flush();
  expect(view.result.current.activeMessageID).toBe("d");
});

it("coalesces virtual-geometry notifications and scroll events into one active-position read", () => {
  const view = navigationHarness();
  view.viewport.scrollTop = 1500;
  view.flush();
  expect(view.result.current.activeMessageID).toBe("d");
  Object.defineProperty(view.viewport, "scrollHeight", { value: 2200, configurable: true });
  act(() => {
    view.result.current.onGeometryChange();
    view.result.current.onGeometryChange();
    view.viewport.dispatchEvent(new Event("scroll"));
  });
  expect(view.frames.size).toBe(1);
  view.flush();
  expect(view.result.current.activeMessageID).toBe("c");
});

it("does not schedule geometry tracking while the rail is ineligible or after unmount", () => {
  const view = navigationHarness({ promptCount: 3 });
  act(() => view.result.current.onGeometryChange());
  expect(view.frames.size).toBe(0);
  const notify = view.result.current.onGeometryChange;
  view.unmount();
  act(notify);
  expect(view.frames.size).toBe(0);
});

it("cancels manual navigation synchronously and releases only its transient pin", () => {
  const view = navigationHarness();
  act(() => view.result.current.jump("b"));
  const pending = [...view.frames.values()];
  act(() => view.result.current.cancel());
  view.measure.mockClear();
  act(() => pending.forEach((callback) => callback(performance.now())));
  expect(view.measure).not.toHaveBeenCalled();
  expect(view.input.pin).toHaveBeenLastCalledWith(null);
});

it("drops a held reading position on a jump, but only moves it when the reader scrolls", () => {
  const view = navigationHarness();
  act(() => view.result.current.jump("b"));
  // A jump lands on its target; holding the older-page position would pull it back.
  expect(view.input.clearAnchor).toHaveBeenLastCalledWith("cancel");
  act(() => view.result.current.cancel());
  // Wheel, keys or touch while a page loads: keep the reader's place, wherever it now is.
  expect(view.input.clearAnchor).toHaveBeenLastCalledWith("user");
});

it("fences corrections from the previous connection and clears the active marker", () => {
  const view = navigationHarness();
  act(() => view.result.current.jump("b"));
  const pending = [...view.frames.values()];
  view.rerender({ scopeID: "another-connection/session" });
  view.measure.mockClear();
  act(() => pending.forEach((callback) => callback(performance.now())));
  expect(view.measure).not.toHaveBeenCalled();
  expect(view.input.pin).toHaveBeenLastCalledWith(null);
});

it("tracks and lands on a steer inside its turn", () => {
  const view = navigationHarness();
  const steer = document.createElement("div");
  steer.dataset.palotPromptId = "b2";
  const steerTop = vi
    .spyOn(steer, "getBoundingClientRect")
    .mockReturnValue({ top: 200 } as DOMRect);
  view.viewport.querySelector('[data-turn-row-id="turn-b"]')!.append(steer);
  const steered = view.input.rows.map((row) =>
    row.id === "turn-b"
      ? ({ ...row, turn: { ...row.turn, users: [...row.turn.users, { id: "b2" }] } } as typeof row)
      : row,
  );
  const prompts = [
    ...view.input.prompts.slice(0, 2),
    { messageID: "b2", turnID: "turn-b", rowIndex: 1, label: "b2" },
    ...view.input.prompts.slice(2),
  ];
  const { result } = renderHook(() =>
    useTranscriptNavigation({ ...view.input, rows: steered, prompts, scopeID: "steer" }),
  );

  view.viewport.scrollTop = 400;
  view.flush();
  expect(result.current.activeMessageID).toBe("b");
  steerTop.mockReturnValue({ top: 10 } as DOMRect);
  act(() => view.viewport.dispatchEvent(new Event("scroll")));
  view.flush();
  expect(result.current.activeMessageID).toBe("b2");

  steerTop.mockReturnValue({ top: 200 } as DOMRect);
  act(() => result.current.jump("b2"));
  expect(view.input.pin).toHaveBeenLastCalledWith("turn-b");
  view.flush();
  // The correction aligns the steer, not the turn row (at 100), with the viewport top.
  expect(view.viewport.scrollTop).toBe(600);
});
