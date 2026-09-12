import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  installStreamingStabilityProbe,
  summarizeStreamingStability,
  type StreamingStabilityCapture,
  type StreamingStabilitySample,
} from "./streaming-stability";

function sample(
  frame: number,
  statusBottom: number,
  overrides: Partial<StreamingStabilitySample> = {},
) {
  return {
    time: frame * 16,
    frame,
    phase: "raf",
    rowId: 1,
    continuityId: 1,
    statusTop: statusBottom - 20,
    statusBottom,
    dockTop: 800,
    dockHeight: 100,
    turnHeight: 300,
    turnBottom: statusBottom,
    virtualHeight: 1_000,
    virtualBottom: statusBottom + 116,
    scrollTop: 400,
    scrollHeight: 1_000,
    clientHeight: 600,
    bottomLocked: true,
    userScrolling: false,
    resized: [],
    ...overrides,
  } satisfies StreamingStabilitySample;
}

function capture(samples: StreamingStabilitySample[]): StreamingStabilityCapture {
  return {
    timeOrigin: 1_000,
    startedAt: 0,
    endedAt: 100,
    maxSamples: 20_000,
    droppedSamples: 0,
    skippedSamples: { hidden: 0, disconnected: 0, inactive: 0 },
    resizeObserver: "observing",
    samples,
  };
}

describe("excursion summary", () => {
  it("does not treat the intentional scroll-up handoff as automatic-follow failure", () => {
    const result = summarizeStreamingStability(
      capture([
        sample(1, 784, { phase: "virtual-layout" }),
        sample(2, 1784, { phase: "virtual-layout", bottomLocked: true, userScrolling: true }),
        sample(3, 784, { phase: "virtual-layout" }),
      ]),
    );
    expect(result.postLayoutOverlapCount).toBe(0);
    expect(result.tailClearanceViolationCount).toBe(0);
    expect(result.excursionCount).toBe(0);
  });
  it("catches a sustained 32px upward handoff even across active row identities", () => {
    const result = summarizeStreamingStability(
      capture([
        sample(1, 784, { phase: "virtual-layout" }),
        sample(2, 752, {
          phase: "virtual-layout",
          rowId: 2,
          continuityId: 2,
          turnBottom: 784,
          virtualBottom: 900,
        }),
        sample(3, 752, {
          phase: "virtual-layout",
          rowId: 2,
          continuityId: 2,
          turnBottom: 784,
          virtualBottom: 900,
        }),
      ]),
    );
    expect(result.settledTailSamples).toBe(3);
    expect(result.tailClearanceViolationCount).toBe(2);
    expect(result.maxTailClearanceErrorPx).toBe(32);
  });

  it("allows stable clearance across row changes, but not unmeasured estimates or short content", () => {
    const result = summarizeStreamingStability(
      capture([
        sample(1, 784, { phase: "virtual-layout" }),
        sample(2, 784.4, { phase: "virtual-layout", rowId: 2, continuityId: 2 }),
        sample(3, 650, { phase: "virtual-layout", virtualBottom: 1000 }),
        sample(4, 650, { phase: "virtual-layout", scrollHeight: 600 }),
      ]),
    );
    expect(result.settledTailSamples).toBe(2);
    expect(result.tailClearanceViolationCount).toBe(0);
  });
  it("catches a post-layout downward flash even when it stops above the composer", () => {
    const result = summarizeStreamingStability(
      capture([sample(1, 750), sample(2, 793, { phase: "virtual-layout" }), sample(3, 750.4)]),
    );
    expect(result.postLayoutOverlapCount).toBe(0);
    expect(result.postLayoutExcursionCount).toBe(1);
    expect(result.maxPostLayoutDownPx).toBe(43);
  });
  it("reports a 43 CSS px down-and-back across explicit callback phases", () => {
    const result = summarizeStreamingStability(
      capture([
        sample(1, 750),
        sample(1, 793, { phase: "resize-observer", time: 18, virtualHeight: 1_043 }),
        sample(2, 750, { scrollTop: 443, scrollHeight: 1_043 }),
      ]),
    );
    expect(result).toMatchObject({
      excursionCount: 1,
      maxDownPx: 43,
      complete: true,
      phaseCounts: { raf: 2, "resize-observer": 1 },
      excursions: [{ beforeIndex: 0, peakIndex: 1, recoveryIndex: 2, durationMs: 14 }],
    });
  });

  it("does not double-count duplicate observer samples and counts separate excursions", () => {
    const result = summarizeStreamingStability(
      capture([
        sample(1, 750),
        sample(2, 793),
        sample(2, 793, { phase: "resize-observer" }),
        sample(3, 750),
        sample(4, 770),
        sample(5, 750),
      ]),
    );
    expect(result.excursions.map((entry) => entry.downPx)).toEqual([43, 20]);
  });

  it("detects a line-growth flash despite fractional-pixel recovery rounding", () => {
    const result = summarizeStreamingStability(
      capture([sample(1, 750.4), sample(2, 837.2), sample(3, 750)]),
    );
    expect(result.excursionCount).toBe(1);
    expect(result.maxDownPx).toBeCloseTo(86.8);
    expect(
      summarizeStreamingStability(capture([sample(1, 750), sample(2, 750.4), sample(3, 750)]))
        .excursionCount,
    ).toBe(0);
  });

  it.each([
    ["sustained position", [sample(1, 750), sample(2, 793), sample(3, 793), sample(4, 750)]],
    ["growth without recovery", [sample(1, 750), sample(2, 793), sample(3, 810)]],
    ["different row", [sample(1, 750), sample(2, 793, { rowId: 2 }), sample(3, 750)]],
    ["dock resize", [sample(1, 750), sample(2, 793, { dockHeight: 143 }), sample(3, 750)]],
    ["dock movement", [sample(1, 750), sample(2, 793, { dockTop: 843 }), sample(3, 750)]],
    ["unlocked", [sample(1, 750), sample(2, 793, { bottomLocked: false }), sample(3, 750)]],
    ["skipped geometry", [sample(1, 750), sample(2, 793), sample(3, 750, { continuityId: 2 })]],
    ["missing frames", [sample(1, 750), sample(2, 793), sample(4, 750)]],
  ])("does not classify %s as a transient excursion", (_, samples) => {
    expect(summarizeStreamingStability(capture(samples)).excursionCount).toBe(0);
  });

  it("does not report incomplete or absent collection as complete", () => {
    const input = capture([sample(1, 750)]);
    input.droppedSamples = 5;
    expect(summarizeStreamingStability(input)).toMatchObject({
      complete: false,
      droppedSamples: 5,
    });
    expect(summarizeStreamingStability(capture([])).complete).toBe(false);
  });

  it("distinguishes post-layout overlap from a 43px excursion corrected in the same frame", () => {
    const before = sample(1, 780);
    const early = sample(2, 823, { phase: "resize-observer" });
    const broken = summarizeStreamingStability(
      capture([before, early, sample(2, 823, { phase: "virtual-layout" }), sample(3, 780)]),
    );
    const corrected = summarizeStreamingStability(
      capture([before, early, sample(2, 780, { phase: "virtual-layout" }), sample(3, 780)]),
    );
    expect(broken).toMatchObject({
      maxDownPx: 43,
      postLayoutOverlapCount: 1,
      maxPostLayoutOverlapPx: 23,
      phaseCounts: { "virtual-layout": 1 },
    });
    expect(corrected).toMatchObject({
      maxDownPx: 43,
      postLayoutOverlapCount: 0,
      maxPostLayoutOverlapPx: 0,
    });
  });

  it.each([
    ["first sample", []],
    ["new row", [sample(1, 780, { rowId: 2 })]],
    ["new continuity", [sample(1, 780, { continuityId: 2 })]],
    ["dock move", [sample(1, 780, { dockTop: 790 })]],
    ["dock resize", [sample(1, 780, { dockHeight: 90 })]],
    ["previous unlocked sample", [sample(1, 780, { bottomLocked: false })]],
  ])("excludes post-layout overlap after %s", (_, preceding) => {
    const result = summarizeStreamingStability(
      capture([...preceding, sample(2, 823, { phase: "virtual-layout" })]),
    );
    expect(result.postLayoutOverlapCount).toBe(0);
    expect(result.maxPostLayoutOverlapPx).toBe(0);
  });

  it("excludes unlocked and one-pixel rounding overlap but retains larger raw overlap", () => {
    const result = summarizeStreamingStability(
      capture([
        sample(1, 780),
        sample(2, 823, { phase: "virtual-layout", bottomLocked: false }),
        sample(3, 780),
        sample(4, 801, { phase: "virtual-layout" }),
        sample(5, 801.25, { phase: "virtual-layout" }),
      ]),
    );
    expect(result.postLayoutOverlapCount).toBe(1);
    expect(result.maxPostLayoutOverlapPx).toBe(1.25);
  });
});

describe("renderer probe", () => {
  const browser = globalThis as typeof globalThis & {
    __palotStreamingStabilityProbe?: { stop(): StreamingStabilityCapture };
  };
  let callback: FrameRequestCallback;
  let now: number;
  const instances = {} as { resize: Resize; mutations: Mutations };
  class Resize {
    elements = new Set<Element>();
    disconnect = vi.fn(() => this.elements.clear());
    constructor(readonly callback: ResizeObserverCallback) {
      instances.resize = this;
    }
    observe(element: Element) {
      this.elements.add(element);
    }
  }
  class Mutations {
    records: MutationRecord[] = [];
    disconnect = vi.fn();
    observe = vi.fn();
    constructor(readonly callback: MutationCallback) {
      instances.mutations = this;
    }
    takeRecords() {
      return this.records.splice(0);
    }
  }
  const stop = () => browser.__palotStreamingStabilityProbe!.stop();
  const tick = () => {
    now += 16;
    callback(now);
  };
  beforeEach(() => {
    now = 100;
    document.body.innerHTML = `<div data-bottom-locked="true"><div data-palot-virtual-transcript><div data-index="4"><div data-palot-active-turn-status>private content</div></div></div></div><div data-palot-composer-dock></div>`;
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    vi.stubGlobal("ResizeObserver", Resize);
    vi.stubGlobal("MutationObserver", Mutations);
    vi.stubGlobal("performance", { now: () => now, timeOrigin: 1_000 });
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn((fn: FrameRequestCallback) => ((callback = fn), 1)),
    );
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
  });
  afterEach(() => {
    browser.__palotStreamingStabilityProbe?.stop();
    document.body.innerHTML = "";
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("caches selectors, records both phases, and removes observers and the global on stop", () => {
    const query = vi.spyOn(document, "querySelector");
    installStreamingStabilityProbe();
    const { resize, mutations } = instances;
    expect(resize.elements.size).toBe(2);
    expect(resize.elements.has(document.querySelector("[data-palot-virtual-transcript]")!)).toBe(
      false,
    );
    const initialQueries = query.mock.calls.length;
    tick();
    mutations.callback([], mutations as unknown as MutationObserver);
    resize.callback(
      [...resize.elements].map((target) => ({ target }) as ResizeObserverEntry),
      resize as unknown as ResizeObserver,
    );
    expect(query).toHaveBeenCalledTimes(initialQueries);
    const installed = browser.__palotStreamingStabilityProbe!;
    const result = installed.stop();
    expect(result.samples.map((entry) => entry.phase)).toEqual([
      "start",
      "raf",
      "resize-observer",
      "stop",
    ]);
    expect(result.samples[2]!.resized).toEqual(["turn", "dock"]);
    expect(JSON.stringify(result)).not.toContain("private content");
    expect(browser.__palotStreamingStabilityProbe).toBeUndefined();
    expect(mutations.disconnect).toHaveBeenCalledOnce();
    expect(resize.elements.size).toBe(0);
    expect(cancelAnimationFrame).toHaveBeenCalledOnce();
    expect(installed.stop()).toBe(result);
    tick();
    expect(result.samples).toHaveLength(4);
  });

  it("samples virtual style delivery once per batch, not unrelated styled descendants", () => {
    const virtual = document.querySelector("[data-palot-virtual-transcript]")!;
    const row = document.querySelector("[data-palot-active-turn-status]")!;
    const query = vi.spyOn(document, "querySelector");
    installStreamingStabilityProbe();
    const { mutations } = instances;
    const initialQueries = query.mock.calls.length;
    const style = (target: Element, attributeName = "style") =>
      ({ type: "attributes", target, attributeName }) as unknown as MutationRecord;
    mutations.callback(
      [style(row), style(virtual, "class")],
      mutations as unknown as MutationObserver,
    );
    tick();
    mutations.callback(
      [style(virtual), style(row), style(virtual)],
      mutations as unknown as MutationObserver,
    );
    // Stop drains a pending spacer update through the same phase-specific path.
    mutations.records.push(style(virtual));
    const result = stop();
    expect(query).toHaveBeenCalledTimes(initialQueries);
    expect(result.samples.map((entry) => entry.phase)).toEqual([
      "start",
      "raf",
      "virtual-layout",
      "virtual-layout",
      "stop",
    ]);
    expect(result.samples[2]).toMatchObject({ frame: 1, time: 116, resized: [] });
  });

  it("resolves replaced spacer references before matching style mutation targets", () => {
    installStreamingStabilityProbe();
    const oldVirtual = document.querySelector("[data-palot-virtual-transcript]")!;
    const replacement = oldVirtual.cloneNode(true) as Element;
    oldVirtual.replaceWith(replacement);
    const { mutations } = instances;
    mutations.callback(
      [
        {
          type: "attributes",
          target: replacement,
          attributeName: "style",
        } as unknown as MutationRecord,
      ],
      mutations as unknown as MutationObserver,
    );
    const result = stop();
    expect(result.samples.map((entry) => entry.phase)).toEqual(["start", "virtual-layout", "stop"]);
    expect(result.samples[0]!.rowId).not.toBe(result.samples[1]!.rowId);
  });

  it("bounds retained samples and accounts for drops including the final read", () => {
    installStreamingStabilityProbe({ maxSamples: 2 });
    tick();
    tick();
    tick();
    const result = stop();
    expect(result.samples).toHaveLength(2);
    expect(result.droppedSamples).toBe(3);
    expect(summarizeStreamingStability(result).complete).toBe(false);
  });

  it("keeps a finite bound even for invalid requested limits", () => {
    installStreamingStabilityProbe({ maxSamples: NaN });
    expect(stop().maxSamples).toBe(20_000);
  });

  it("distinguishes expected inactive periods from lost active nodes", () => {
    const row = document.querySelector("[data-palot-active-turn-status]")!;
    const parent = row.parentElement!;
    row.remove();
    installStreamingStabilityProbe();
    parent.append(row);
    instances.mutations.callback([], instances.mutations as unknown as MutationObserver);
    tick();
    row.remove();
    instances.mutations.callback([], instances.mutations as unknown as MutationObserver);
    const result = stop();
    expect(result.skippedSamples).toEqual({ hidden: 0, disconnected: 0, inactive: 2 });
    expect(summarizeStreamingStability(result).complete).toBe(true);
  });

  it("re-resolves a replaced row from pending mutations at stop without mixing identity", () => {
    installStreamingStabilityProbe();
    const { mutations } = instances;
    const oldRow = document.querySelector("[data-palot-active-turn-status]")!;
    oldRow.replaceWith(oldRow.cloneNode(true));
    tick();
    mutations.records.push({} as MutationRecord);
    const result = stop();
    expect(mutations.records).toEqual([]);
    expect(result.skippedSamples.disconnected).toBe(1);
    expect(result.samples[0]!.rowId).not.toBe(result.samples[1]!.rowId);
    expect(result.samples[0]!.continuityId).not.toBe(result.samples[1]!.continuityId);
  });

  it("does not mix a virtualizer's recycled turn identity", () => {
    installStreamingStabilityProbe();
    document.querySelector("[data-index]")!.setAttribute("data-index", "5");
    instances.mutations.callback([], instances.mutations as unknown as MutationObserver);
    const result = stop();
    expect(result.samples[0]!.rowId).not.toBe(result.samples[1]!.rowId);
  });

  it("captures primitive geometry and viewport metrics at performance.now", () => {
    const rect = (top: number, height: number) =>
      ({ top, bottom: top + height, height }) as DOMRect;
    vi.spyOn(
      document.querySelector("[data-palot-active-turn-status]")!,
      "getBoundingClientRect",
    ).mockReturnValue(rect(730, 20));
    vi.spyOn(
      document.querySelector("[data-palot-composer-dock]")!,
      "getBoundingClientRect",
    ).mockReturnValue(rect(800, 100));
    vi.spyOn(document.querySelector("[data-index]")!, "getBoundingClientRect").mockReturnValue(
      rect(450, 300),
    );
    vi.spyOn(
      document.querySelector("[data-palot-virtual-transcript]")!,
      "getBoundingClientRect",
    ).mockReturnValue(rect(-400, 1_000));
    const viewport = document.querySelector("[data-bottom-locked]")!;
    Object.defineProperties(viewport, {
      scrollTop: { value: 400 },
      scrollHeight: { value: 1_000 },
      clientHeight: { value: 600 },
    });
    installStreamingStabilityProbe();
    expect(stop().samples[0]).toMatchObject({
      time: 100,
      statusTop: 730,
      statusBottom: 750,
      dockTop: 800,
      dockHeight: 100,
      turnHeight: 300,
      virtualHeight: 1_000,
      scrollTop: 400,
      scrollHeight: 1_000,
      clientHeight: 600,
      bottomLocked: true,
    });
  });

  it("breaks continuity across hidden samples and reports unsupported ResizeObserver", () => {
    vi.stubGlobal("ResizeObserver", undefined);
    installStreamingStabilityProbe();
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    tick();
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    const result = stop();
    expect(result.resizeObserver).toBe("unsupported");
    expect(result.skippedSamples.hidden).toBe(1);
    expect(result.samples[0]!.continuityId).not.toBe(result.samples[1]!.continuityId);
  });
});
