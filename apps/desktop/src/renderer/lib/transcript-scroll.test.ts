import { describe, expect, it, vi } from "vitest";
import {
  cancelTranscriptScrollFrame,
  composerTranscriptPageDirection,
  nearTranscriptTurns,
  transcriptPageScrollTop,
  nextTranscriptBottomLock,
  normalizeTranscriptWheelDelta,
  transcriptWheelIsSideways,
  readTranscriptScrollUpdate,
  scheduleTranscriptScrollFrame,
  transcriptDistanceFromBottom,
  transcriptKeyboardScrollDelta,
  transcriptScrollTargetConsumesDelta,
  transcriptSubmissionFollowsBottom,
} from "./transcript-scroll";

describe("transcript keyboard intent", () => {
  const event = {
    key: "PageDown",
    defaultPrevented: false,
    shiftKey: false,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
  };
  it("recognizes scroll keys originating from a focused transcript link", () => {
    const target = document.createElement("a");
    expect(transcriptKeyboardScrollDelta({ ...event, target })).toBe(1);
    expect(transcriptKeyboardScrollDelta({ ...event, key: "Home", target })).toBe(-1);
  });
  it("leaves editing and widget keyboard navigation alone", () => {
    const textarea = document.createElement("textarea");
    expect(transcriptKeyboardScrollDelta({ ...event, target: textarea })).toBe(0);
    const listbox = document.createElement("div");
    listbox.setAttribute("role", "listbox");
    const option = document.createElement("div");
    listbox.append(option);
    expect(transcriptKeyboardScrollDelta({ ...event, target: option })).toBe(0);
    expect(
      transcriptKeyboardScrollDelta({
        ...event,
        target: document.createElement("a"),
        defaultPrevented: true,
      }),
    ).toBe(0);
  });
});

describe("composer page keys", () => {
  const event = {
    key: "PageUp",
    defaultPrevented: false,
    isComposing: false,
    shiftKey: false,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
  };
  function composerInput(tag: "textarea" | "div") {
    const input = document.createElement(tag);
    input.setAttribute("data-palot-composer-input", "");
    input.setAttribute("aria-expanded", "false");
    if (tag === "div") input.contentEditable = "true";
    return input;
  }

  it("pages from the plain and rich composer inputs", () => {
    expect(composerTranscriptPageDirection({ ...event, target: composerInput("textarea") })).toBe(
      -1,
    );
    const rich = composerInput("div");
    const text = document.createElement("p");
    rich.append(text);
    expect(composerTranscriptPageDirection({ ...event, key: "PageDown", target: text })).toBe(1);
  });

  it("keeps native page keys elsewhere, with modifiers, while composing, or with a popup open", () => {
    const input = composerInput("textarea");
    expect(
      composerTranscriptPageDirection({ ...event, target: document.createElement("textarea") }),
    ).toBe(0);
    for (const modifier of ["shiftKey", "metaKey", "ctrlKey", "altKey", "isComposing"] as const) {
      expect(composerTranscriptPageDirection({ ...event, [modifier]: true, target: input })).toBe(
        0,
      );
    }
    expect(composerTranscriptPageDirection({ ...event, key: "ArrowUp", target: input })).toBe(0);
    input.setAttribute("aria-expanded", "true");
    expect(composerTranscriptPageDirection({ ...event, target: input })).toBe(0);
  });

  it("pages 80% of the area above the composer and clamps to the scroll range", () => {
    const metrics = { scrollTop: 1_000, scrollHeight: 3_000, clientHeight: 700 };
    expect(transcriptPageScrollTop({ metrics, obscuredBottom: 200, direction: -1 })).toBe(600);
    expect(
      transcriptPageScrollTop({ metrics, obscuredBottom: 200, direction: 1, from: 1_400 }),
    ).toBe(1_800);
    expect(
      transcriptPageScrollTop({
        metrics: { ...metrics, scrollTop: 100 },
        obscuredBottom: 0,
        direction: -1,
      }),
    ).toBe(0);
    expect(
      transcriptPageScrollTop({
        metrics: { ...metrics, scrollTop: 2_200 },
        obscuredBottom: 0,
        direction: 1,
      }),
    ).toBe(2_300);
  });
});

describe("transcript bottom lock", () => {
  it("does not read DOM geometry for a bottom-locked scroll without user intent", () => {
    const geometryRead = vi.fn(() => {
      throw new Error("Unexpected synchronous geometry read");
    });
    const metrics = Object.defineProperties(
      {},
      {
        scrollTop: { get: geometryRead },
        scrollHeight: { get: geometryRead },
        clientHeight: { get: geometryRead },
      },
    ) as { scrollTop: number; scrollHeight: number; clientHeight: number };
    expect(
      readTranscriptScrollUpdate({
        current: true,
        metrics,
        previousScrollTop: 600,
        intent: null,
      }),
    ).toBeNull();
    expect(geometryRead).not.toHaveBeenCalled();
  });

  it.each(["up", "anchor", "scrollbar"] as const)(
    "still reads actual scroll position and unlocks for %s intent",
    (intent) => {
      expect(
        readTranscriptScrollUpdate({
          current: true,
          metrics: { scrollTop: 575, scrollHeight: 1_000, clientHeight: 400 },
          previousScrollTop: 600,
          intent,
        }),
      ).toEqual({ locked: false, scrollTop: 575 });
    },
  );

  it("tracks unlocked momentum and re-arms on returning to the live edge", () => {
    const metrics = { scrollTop: 500, scrollHeight: 1_000, clientHeight: 400 };
    expect(
      readTranscriptScrollUpdate({
        current: false,
        metrics,
        previousScrollTop: 570,
        intent: null,
      }),
    ).toEqual({ locked: false, scrollTop: 500 });
    expect(
      readTranscriptScrollUpdate({
        current: false,
        metrics: { ...metrics, scrollTop: 580 },
        previousScrollTop: 500,
        intent: null,
      }),
    ).toEqual({ locked: true, scrollTop: 580 });
  });

  it("stays locked when layout growth moves the viewport away without user input", () => {
    expect(
      nextTranscriptBottomLock({
        current: true,
        metrics: { scrollTop: 400, scrollHeight: 1_000, clientHeight: 400 },
        previousScrollTop: 400,
        intent: null,
      }),
    ).toBe(true);
  });

  it("releases after an upward gesture", () => {
    expect(
      nextTranscriptBottomLock({
        current: true,
        metrics: { scrollTop: 575, scrollHeight: 1_000, clientHeight: 400 },
        previousScrollTop: 600,
        intent: "up",
      }),
    ).toBe(false);
  });

  it("stays unlocked while momentum moves farther away", () => {
    expect(
      nextTranscriptBottomLock({
        current: false,
        metrics: { scrollTop: 500, scrollHeight: 1_000, clientHeight: 400 },
        previousScrollTop: 570,
        intent: null,
      }),
    ).toBe(false);
  });

  it("uses scroll direction when the user drags the scrollbar", () => {
    expect(
      nextTranscriptBottomLock({
        current: true,
        metrics: { scrollTop: 500, scrollHeight: 1_000, clientHeight: 400 },
        previousScrollTop: 600,
        intent: "scrollbar",
      }),
    ).toBe(false);
  });

  it("restores the lock when the viewport returns near the bottom", () => {
    expect(
      nextTranscriptBottomLock({
        current: false,
        metrics: { scrollTop: 565, scrollHeight: 1_000, clientHeight: 400 },
        previousScrollTop: 500,
        intent: null,
      }),
    ).toBe(true);
  });

  it("does not re-arm while restoring a history anchor", () => {
    expect(
      nextTranscriptBottomLock({
        current: false,
        metrics: { scrollTop: 565, scrollHeight: 1_000, clientHeight: 400 },
        previousScrollTop: 500,
        intent: "anchor",
      }),
    ).toBe(false);
  });

  it("clamps overscroll and normalizes wheel delta modes", () => {
    expect(
      transcriptDistanceFromBottom({ scrollTop: 620, scrollHeight: 1_000, clientHeight: 400 }),
    ).toBe(0);
    expect(normalizeTranscriptWheelDelta({ deltaY: -2, deltaMode: 1, viewportHeight: 600 })).toBe(
      -80,
    );
    expect(normalizeTranscriptWheelDelta({ deltaY: -1, deltaMode: 2, viewportHeight: 600 })).toBe(
      -600,
    );
  });

  it.each([
    { deltaX: 5, deltaY: -30, shiftKey: false, sideways: false },
    { deltaX: 80, deltaY: -30, shiftKey: false, sideways: true },
    { deltaX: -80, deltaY: 30, shiftKey: false, sideways: true },
    { deltaX: 0, deltaY: -30, shiftKey: true, sideways: true },
  ])("tells sideways wheel gestures from reading up or down: %j", ({ sideways, ...wheel }) => {
    expect(transcriptWheelIsSideways(wheel)).toBe(sideways);
  });

  it("lets nested scroll panes consume gestures until their boundary", () => {
    const metrics = { scrollTop: 20, scrollHeight: 500, clientHeight: 200 };

    expect(transcriptScrollTargetConsumesDelta(metrics, -40)).toBe(true);
    expect(transcriptScrollTargetConsumesDelta(metrics, 40)).toBe(true);
    expect(transcriptScrollTargetConsumesDelta({ ...metrics, scrollTop: 0 }, -40)).toBe(false);
    expect(transcriptScrollTargetConsumesDelta({ ...metrics, scrollTop: 300 }, 40)).toBe(false);
  });

  it("can schedule again after cleanup cancels a pending frame", () => {
    const callbacks = new Map<number, FrameRequestCallback>();
    let id = 0;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callbacks.set(++id, callback);
      return id;
    });
    vi.stubGlobal("cancelAnimationFrame", (frameID: number) => callbacks.delete(frameID));
    const frame = { current: null as number | null };
    const callback = vi.fn();

    scheduleTranscriptScrollFrame(frame, callback);
    cancelTranscriptScrollFrame(frame);
    scheduleTranscriptScrollFrame(frame, callback);
    callbacks.get(frame.current ?? -1)?.(0);

    expect(callback).toHaveBeenCalledOnce();
    expect(frame.current).toBeNull();
    vi.unstubAllGlobals();
  });
});

describe("near transcript turns", () => {
  // Three turns: a tall one, the visible one (index 1), and a short one below.
  const items = [
    { start: 0, end: 2000 },
    { start: 2000, end: 3000 },
    { start: 3000, end: 3100 },
  ];

  it("leaves neighbouring turns unmounted while they are far from the viewport", () => {
    expect(
      nearTranscriptTurns({
        startIndex: 1,
        endIndex: 1,
        items,
        scrollOffset: 2400,
        viewportHeight: 300,
      }),
    ).toEqual([]);
  });

  it("mounts the neighbours that are about to scroll into view", () => {
    expect(
      nearTranscriptTurns({
        startIndex: 1,
        endIndex: 1,
        items,
        scrollOffset: 2100,
        viewportHeight: 700,
      }),
    ).toEqual([0, 2]);
  });

  it("has no neighbours past either end of the transcript", () => {
    expect(
      nearTranscriptTurns({
        startIndex: 0,
        endIndex: 2,
        items,
        scrollOffset: 0,
        viewportHeight: 3100,
      }),
    ).toEqual([]);
  });
});

describe("transcript submission follow", () => {
  const scrolled = { scrollTop: 400, scrollHeight: 3000, clientHeight: 800 };
  it("takes a reader who follows the bottom along with the sent prompt", () => {
    expect(
      transcriptSubmissionFollowsBottom({
        locked: true,
        metrics: { ...scrolled, scrollTop: 2200 },
      }),
    ).toBe(true);
  });
  it("keeps a reader who scrolled up where they are", () => {
    expect(transcriptSubmissionFollowsBottom({ locked: false, metrics: scrolled })).toBe(false);
    // Any scroll away from the bottom shows Scroll to bottom, so even a short way up stays put.
    expect(
      transcriptSubmissionFollowsBottom({
        locked: false,
        metrics: { ...scrolled, scrollTop: 2100 },
      }),
    ).toBe(false);
  });
  it("follows when the transcript fits its viewport or is not mounted", () => {
    expect(
      transcriptSubmissionFollowsBottom({
        locked: false,
        metrics: { scrollTop: 0, scrollHeight: 800, clientHeight: 800 },
      }),
    ).toBe(true);
    expect(transcriptSubmissionFollowsBottom({ locked: false, metrics: null })).toBe(true);
  });
});
