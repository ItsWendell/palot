import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { TranscriptProjectionRow } from "../lib/turn-projection";
import {
  readTranscriptPrependAnchor,
  resolveTranscriptPrependAnchor,
  useTranscriptPrependAnchor,
} from "./use-transcript-prepend-anchor";

/**
 * A transcript laid out by hand: Happy DOM has no layout, so each turn is a stack of blocks with
 * heights, positioned from the top of the scroll content, and rects follow `scrollTop`.
 */
interface Block {
  height: number;
  prompt?: string;
  response?: string;
  divider?: boolean;
}
interface Turn {
  id: string;
  user?: string;
  blocks: Block[];
}

const VIEWPORT_HEIGHT = 600;
let frames: FrameRequestCallback[] = [];

beforeEach(() => {
  frames = [];
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn((callback: FrameRequestCallback) => frames.push(callback)),
  );
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function runFrames(count: number) {
  for (let frame = 0; frame < count; frame += 1) {
    const pending = frames;
    frames = [];
    for (const callback of pending) callback(performance.now());
  }
}

function rect(top: number, height: number): DOMRect {
  return { top, bottom: top + height, height, left: 0, right: 800, width: 800 } as DOMRect;
}

function transcript() {
  const viewport = document.createElement("div");
  let scrollTop = 0;
  Object.defineProperty(viewport, "scrollTop", {
    configurable: true,
    get: () => scrollTop,
    set: (value: number) => {
      scrollTop = Math.max(0, value);
    },
  });
  viewport.getBoundingClientRect = () => rect(0, VIEWPORT_HEIGHT);
  document.body.append(viewport);

  function render(turns: Turn[]) {
    viewport.replaceChildren();
    let y = 64;
    for (const turn of turns) {
      const element = document.createElement("div");
      element.dataset.turnRowId = turn.id;
      const start = y;
      for (const block of turn.blocks) {
        const child = document.createElement("div");
        if (block.prompt) child.dataset.palotPromptId = block.prompt;
        if (block.response) child.dataset.palotResponseMessage = block.response;
        if (block.divider) child.dataset.palotUnread = "";
        const top = y;
        child.getBoundingClientRect = () => rect(top - viewport.scrollTop, block.height);
        element.append(child);
        y += block.height;
      }
      const height = y - start;
      element.getBoundingClientRect = () => rect(start - viewport.scrollTop, height);
      viewport.append(element);
    }
    return turns.map(
      (turn) =>
        ({
          id: turn.id,
          turn: { user: turn.user ? { id: turn.user } : null },
        }) as unknown as TranscriptProjectionRow,
    );
  }

  const top = (selector: string) => viewport.querySelector(selector)!.getBoundingClientRect().top;
  return { viewport, render, top };
}

function conversation(number: number, extra: Block[] = []): Turn {
  return {
    id: `prompt-${number}`,
    user: `prompt-${number}`,
    blocks: [
      { height: 80, prompt: `prompt-${number}` },
      ...extra,
      { height: 300, response: `answer-${number}` },
    ],
  };
}

function harness(initial: { turns: Turn[]; historyStartID: string; hasMore?: boolean }) {
  const view = transcript();
  const pin = vi.fn();
  const rows = view.render(initial.turns);
  const hook = renderHook(
    (props: { rows: TranscriptProjectionRow[]; historyStartID: string }) =>
      useTranscriptPrependAnchor({
        viewport: { current: view.viewport },
        rows: props.rows,
        historyStartID: props.historyStartID,
        hasMore: initial.hasMore ?? true,
        bottomInset: 100,
        layoutVersion: props.rows.length,
        willScroll: vi.fn(),
        didScroll: vi.fn(),
        pin,
      }),
    { initialProps: { rows, historyStartID: initial.historyStartID } },
  );
  return {
    ...view,
    ...hook,
    pin,
    apply(turns: Turn[], historyStartID: string) {
      const next = view.render(turns);
      hook.rerender({ rows: next, historyStartID });
    },
  };
}

const older = [conversation(1), conversation(2), conversation(3)];

it("keeps the answer the reader sees in place when an older page lands above it", () => {
  const view = harness({
    turns: [conversation(4), conversation(5), conversation(6)],
    historyStartID: "prompt-4",
  });
  view.viewport.scrollTop = 420;
  const before = view.top('[data-palot-response-message="answer-5"]');
  act(() => void view.result.current.capture());
  expect(view.pin).toHaveBeenLastCalledWith(expect.objectContaining({ turnID: "prompt-5" }));

  view.apply([...older, conversation(4), conversation(5), conversation(6)], "prompt-1");
  // Corrected in the commit that applied the page, before it paints.
  expect(view.top('[data-palot-response-message="answer-5"]')).toBe(before);
  expect(view.viewport.scrollTop).toBe(420 + 3 * 380);
});

it("follows a turn whose key changes when the older page completes it", () => {
  // The newer page starts at a steer, so its first turn is keyed by the steer until the
  // older page brings the prompt that opened it.
  const partial: Turn = {
    id: "steer-3",
    user: "steer-3",
    blocks: [
      { height: 80, prompt: "steer-3" },
      { height: 300, response: "answer-3" },
    ],
  };
  const view = harness({ turns: [partial, conversation(4)], historyStartID: "steer-3" });
  const before = view.top('[data-palot-response-message="answer-3"]');
  act(() => void view.result.current.capture());

  const completed: Turn = {
    id: "prompt-3",
    user: "prompt-3",
    blocks: [
      { height: 80, prompt: "prompt-3" },
      { height: 40 },
      // The opener becomes a steer and gains its label.
      { height: 100, prompt: "steer-3" },
      { height: 300, response: "answer-3" },
    ],
  };
  view.apply([conversation(1), conversation(2), completed, conversation(4)], "prompt-1");
  expect(view.top('[data-palot-response-message="answer-3"]')).toBe(before);
  expect(view.viewport.scrollTop).toBeGreaterThan(700);
});

it("holds a regrouped turn by its bottom edge when no message in it is on screen", () => {
  const work: Turn = { id: "step-3", blocks: [{ height: 900 }] };
  const view = harness({ turns: [work, conversation(4)], historyStartID: "step-3" });
  view.viewport.scrollTop = 200;
  const bottom = () =>
    view.viewport.querySelector('[data-turn-row-id="prompt-3"]')!.getBoundingClientRect().bottom;
  const anchor = readTranscriptPrependAnchor({
    viewport: view.viewport,
    rows: view.render([work, conversation(4)]),
    hasMore: true,
    bottomInset: 100,
    historyStartID: "step-3",
  });
  expect(anchor?.message).toBeNull();
  act(() => void view.result.current.capture());
  const before = view.viewport
    .querySelector('[data-turn-row-id="step-3"]')!
    .getBoundingClientRect().bottom;

  view.apply(
    [
      conversation(1),
      { id: "prompt-3", user: "prompt-3", blocks: [{ height: 80 }, { height: 900 }] },
      conversation(4),
    ],
    "prompt-1",
  );
  expect(bottom()).toBe(before);
});

it("keeps the place when the reader keeps scrolling while the page loads", () => {
  const view = harness({
    turns: [conversation(4), conversation(5), conversation(6)],
    historyStartID: "prompt-4",
  });
  act(() => void view.result.current.capture());
  // Wheel momentum at the top edge: the reader took over, but the page has not landed yet.
  act(() => view.result.current.release("user"));
  expect(view.result.current.isHolding()).toBe(true);
  // A scroll that does move them is the place to keep instead.
  view.viewport.scrollTop = 300;
  act(() => view.result.current.readerMoved());
  const before = view.top('[data-palot-response-message="answer-4"]');

  view.apply([...older, conversation(4), conversation(5), conversation(6)], "prompt-1");
  expect(view.top('[data-palot-response-message="answer-4"]')).toBe(before);
  expect(view.viewport.scrollTop).toBe(300 + 3 * 380);
});

it("lets a reader who scrolls after the page landed take over", () => {
  const view = harness({ turns: [conversation(4), conversation(5)], historyStartID: "prompt-4" });
  act(() => void view.result.current.capture());
  view.apply([...older, conversation(4), conversation(5)], "prompt-1");
  act(() => view.result.current.release("user"));
  expect(view.result.current.isHolding()).toBe(false);
  expect(view.pin).toHaveBeenLastCalledWith(null);
});

it("does not hold the place for a jump, which lands on its own target", () => {
  const view = harness({ turns: [conversation(4), conversation(5)], historyStartID: "prompt-4" });
  act(() => void view.result.current.capture());
  act(() => view.result.current.release("cancel"));
  view.apply([...older, conversation(4), conversation(5)], "prompt-1");
  expect(view.viewport.scrollTop).toBe(0);
});

it("absorbs the New divider leaving the turn above the anchored answer", () => {
  const view = harness({
    turns: [conversation(4), conversation(5, [{ height: 40, divider: true }])],
    historyStartID: "prompt-4",
  });
  // The divider sits just above the reading line, between the prompt and its answer.
  view.viewport.scrollTop = 530;
  const before = view.top('[data-palot-response-message="answer-5"]');
  act(() => void view.result.current.capture());
  // The older page holds an earlier unseen message, so the divider moves up there.
  view.apply(
    [conversation(1, [{ height: 40, divider: true }]), conversation(4), conversation(5)],
    "prompt-1",
  );
  expect(view.top('[data-palot-response-message="answer-5"]')).toBe(before);
});

it("keeps holding while later measurements settle, then lets go", () => {
  const view = harness({ turns: [conversation(4), conversation(5)], historyStartID: "prompt-4" });
  view.viewport.scrollTop = 100;
  const before = view.top('[data-palot-response-message="answer-4"]');
  act(() => void view.result.current.capture());
  view.apply([conversation(3), conversation(4), conversation(5)], "prompt-3");
  // The prepended turn is measured taller than first rendered.
  view.render([conversation(3, [{ height: 120 }]), conversation(4), conversation(5)]);
  act(() => runFrames(1));
  expect(view.top('[data-palot-response-message="answer-4"]')).toBe(before);
  act(() => runFrames(10));
  expect(view.result.current.isHolding()).toBe(false);
});

it("lets go when the older page changes nothing on screen", () => {
  let now = 1_000;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  const view = harness({ turns: [conversation(4)], historyStartID: "prompt-4" });
  act(() => void view.result.current.capture());
  act(() => view.result.current.fetched());
  now += 1_001;
  act(() => runFrames(1));
  expect(view.result.current.isHolding()).toBe(false);
});

it("prefers something other than an opening prompt that an older page can turn into a steer", () => {
  const view = transcript();
  const rows = view.render([conversation(4), conversation(5)]);
  const anchor = readTranscriptPrependAnchor({
    viewport: view.viewport,
    rows,
    hasMore: true,
    bottomInset: 100,
    historyStartID: "prompt-4",
  });
  expect(anchor?.message?.selector).toBe('[data-palot-response-message="answer-4"]');
  const complete = readTranscriptPrependAnchor({
    viewport: view.viewport,
    rows,
    hasMore: false,
    bottomInset: 100,
    historyStartID: "prompt-4",
  });
  expect(complete?.message?.selector).toBe('[data-palot-prompt-id="prompt-4"]');
});

it("resolves a regrouped turn as the one before the turn that followed it", () => {
  const row = (id: string) => ({ id }) as unknown as TranscriptProjectionRow;
  const anchor = { turnID: "steer-3", nextTurnID: "prompt-4" };
  expect(resolveTranscriptPrependAnchor(anchor, [row("steer-3"), row("prompt-4")])).toEqual({
    index: 0,
    regrouped: false,
  });
  expect(
    resolveTranscriptPrependAnchor(anchor, [row("prompt-1"), row("prompt-3"), row("prompt-4")]),
  ).toEqual({ index: 1, regrouped: true });
});
