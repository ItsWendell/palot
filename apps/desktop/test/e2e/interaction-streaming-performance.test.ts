import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installInteractionResponseProbe } from "./interaction-streaming-performance";

// These tests exercise only the serialized DOM observer, not native CDP/host identity.
vi.mock("./performance.ts", () => ({ measureInteraction: vi.fn() }));
vi.mock("@playwright/test", () => ({ expect: vi.fn() }));

type TestProbe = {
  result: Promise<{
    failure: string | null;
    usefulDOMAt: number | null;
    untrustedEvents: number;
    markerLookups: number;
  }>;
  stop(): void;
};
const browser = globalThis as typeof globalThis & { __palotInteractionResponse?: TestProbe };
const probe = () => browser.__palotInteractionResponse!;

function fixture() {
  document.body.innerHTML = `<button id="switch">Beta</button><main aria-label="Current task"><div data-palot-transcript-surface data-palot-transcript-state="visible" style="opacity:1"><div aria-label="Task transcript" data-bottom-locked="true"><strong>ALPHA live 000</strong></div></div><button aria-label="Stop task">Stop</button></main>`;
  const root = document.querySelector("main")!;
  const viewport = document.querySelector<HTMLElement>('[aria-label="Task transcript"]')!;
  Object.defineProperties(viewport, {
    scrollHeight: { configurable: true, value: 2000 },
    clientHeight: { configurable: true, value: 500 },
  });
  viewport.scrollTop = 1500;
  return { root, viewport, button: document.querySelector("#switch")! };
}

describe("bounded interaction DOM response observer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    probe()?.stop();
    delete browser.__palotInteractionResponse;
    document.body.replaceChildren();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("requires both wheel intent and actual scroll movement, and identifies synthetic events", async () => {
    const { viewport } = fixture();
    installInteractionResponseProbe(viewport, { kind: "wheel-up" });
    viewport.dispatchEvent(new WheelEvent("wheel", { deltaY: -900 }));
    viewport.dataset.bottomLocked = "false";
    viewport.dispatchEvent(new Event("scroll"));
    viewport.scrollTop = 600;
    viewport.dispatchEvent(new Event("scroll"));
    expect(await probe().result).toMatchObject({
      failure: null,
      untrustedEvents: 1,
      usefulDOMAt: expect.any(Number),
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not mistake bottom-lock alone for a resumed live edge", async () => {
    const { viewport } = fixture();
    viewport.scrollTop = 600;
    viewport.dataset.bottomLocked = "false";
    installInteractionResponseProbe(viewport, { kind: "resume", timeoutMs: 50 });
    viewport.dispatchEvent(new WheelEvent("wheel", { deltaY: 100_000 }));
    viewport.dataset.bottomLocked = "true";
    viewport.dispatchEvent(new Event("scroll"));
    await vi.advanceTimersByTimeAsync(50);
    expect(await probe().result).toMatchObject({
      failure: "Timed out waiting for useful DOM response",
      usefulDOMAt: null,
    });
  });

  it("requires the idle composer replacement rather than Stop removal alone", async () => {
    const { root } = fixture();
    const stop = root.querySelector('[aria-label="Stop task"]')!;
    installInteractionResponseProbe(stop, { kind: "stop" });
    stop.dispatchEvent(new MouseEvent("click"));
    stop.remove();
    root.dispatchEvent(new Event("transitionend"));
    const send = document.createElement("button");
    send.setAttribute("aria-label", "Send message");
    root.append(send);
    root.dispatchEvent(new Event("transitionend"));
    expect(await probe().result).toMatchObject({ failure: null, usefulDOMAt: expect.any(Number) });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("reacquires replaced transcript nodes but rejects offscreen target markers", async () => {
    const { root, viewport, button } = fixture();
    installInteractionResponseProbe(button, {
      kind: "navigation",
      sessionID: "beta",
      label: "BETA",
    });
    button.dispatchEvent(new MouseEvent("click"));
    location.hash = "#/sessions/beta";
    const next = viewport.cloneNode(false) as HTMLElement;
    next.innerHTML = "<strong>BETA live 005</strong>";
    viewport.replaceWith(next);
    vi.spyOn(next, "getBoundingClientRect").mockReturnValue({ top: 0, bottom: 500 } as DOMRect);
    const bounds = vi.spyOn(next.firstElementChild!, "getBoundingClientRect");
    bounds.mockReturnValue({ top: 600, bottom: 620, height: 20 } as DOMRect);
    root.dispatchEvent(new Event("transitionend"));
    bounds.mockReturnValue({ top: 300, bottom: 320, height: 20 } as DOMRect);
    root.dispatchEvent(new Event("transitionend"));
    expect(await probe().result).toMatchObject({
      failure: null,
      markerLookups: 1,
      usefulDOMAt: expect.any(Number),
    });
  });

  it("settles and clears its timer when replaced or explicitly stopped", async () => {
    const { viewport } = fixture();
    installInteractionResponseProbe(viewport, { kind: "wheel-up" });
    const first = probe();
    installInteractionResponseProbe(viewport, { kind: "resume" });
    expect(await first.result).toMatchObject({ failure: "Probe stopped before response" });
    probe().stop();
    expect(await probe().result).toMatchObject({ failure: "Probe stopped before response" });
    expect(vi.getTimerCount()).toBe(0);
  });
});
