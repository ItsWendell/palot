import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PalotBeacon } from "./palot-beacon";

const motionQuery = "(prefers-reduced-motion: no-preference) and (any-pointer: fine)";
const trackingProperties = ["--beacon-look-x", "--beacon-look-y", "--beacon-lean"];

function installMotionPreference() {
  const queries = new Map<string, MediaQueryList>();
  vi.spyOn(window, "matchMedia").mockImplementation((query) => {
    let media = queries.get(query);
    if (!media) {
      media = Object.assign(new EventTarget(), {
        media: query,
        matches: query === motionQuery,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
      });
      queries.set(query, media);
    }
    return media;
  });
  const media = window.matchMedia(motionQuery);
  return {
    media,
    setAllowed(allowed: boolean) {
      act(() => {
        Object.defineProperty(media, "matches", { value: allowed, configurable: true });
        media.dispatchEvent(new Event("change"));
      });
    },
  };
}

function installAnimationFrames() {
  let nextID = 0;
  const pending = new Map<number, FrameRequestCallback>();
  const request = vi.fn((callback: FrameRequestCallback) => {
    const id = ++nextID;
    pending.set(id, callback);
    return id;
  });
  const cancel = vi.fn((id: number) => pending.delete(id));
  vi.stubGlobal("requestAnimationFrame", request);
  vi.stubGlobal("cancelAnimationFrame", cancel);
  return {
    pending,
    request,
    cancel,
    flush() {
      act(() => {
        const callbacks = [...pending.values()];
        pending.clear();
        for (const callback of callbacks) callback(16);
      });
    },
  };
}

function setup() {
  const view = render(<PalotBeacon />);
  const button = screen.getByRole<HTMLButtonElement>("button", { name: "Say hello to Palot" });
  vi.spyOn(button, "getBoundingClientRect").mockReturnValue(new DOMRect(100, 100, 64, 64));
  return { ...view, button };
}

function move(x = 10_000, y = 10_000, pointerType = "mouse") {
  fireEvent.pointerMove(window, { clientX: x, clientY: y, pointerType });
}

function expectTrackingCleared(button: HTMLButtonElement) {
  for (const property of trackingProperties) {
    expect(button.style.getPropertyValue(property)).toBe("");
  }
}

function finishAnimation(button: HTMLButtonElement, animationName: string) {
  // Happy DOM does not run CSS animations. Send their real bubbling completion event.
  const event = new Event("animationend", { bubbles: true });
  Object.defineProperty(event, "animationName", { value: animationName });
  fireEvent(button.querySelector("svg")!, event);
}

describe("PalotBeacon", () => {
  let motion: ReturnType<typeof installMotionPreference>;
  let frames: ReturnType<typeof installAnimationFrames>;

  beforeEach(() => {
    delete document.documentElement.dataset.reducedMotion;
    motion = installMotionPreference();
    frames = installAnimationFrames();
    vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  });

  afterEach(() => {
    cleanup();
    delete document.documentElement.dataset.reducedMotion;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("coalesces pointer moves into one frame and follows the latest position within subtle bounds", () => {
    const { button } = setup();
    move(-10_000, -10_000);
    move(0, 0);
    move(10_000, 10_000);
    expect(frames.request).toHaveBeenCalledTimes(1);
    expectTrackingCleared(button);

    frames.flush();
    const x = Number.parseFloat(button.style.getPropertyValue("--beacon-look-x"));
    const y = Number.parseFloat(button.style.getPropertyValue("--beacon-look-y"));
    const lean = Number.parseFloat(button.style.getPropertyValue("--beacon-lean"));
    expect(x).toBeGreaterThan(0);
    expect(x).toBeLessThanOrEqual(2.5);
    expect(y).toBeGreaterThan(0);
    expect(y).toBeLessThanOrEqual(2.25);
    expect(lean).toBeGreaterThan(0);
    expect(lean).toBeLessThanOrEqual(6);
    expect(button.style.getPropertyValue("--beacon-look-x")).toMatch(/px$/);
    expect(button.style.getPropertyValue("--beacon-look-y")).toMatch(/px$/);
    expect(button.style.getPropertyValue("--beacon-lean")).toMatch(/deg$/);

    move(-10_000, -10_000);
    expect(frames.request).toHaveBeenCalledTimes(2);
    frames.flush();
    expect(Number.parseFloat(button.style.getPropertyValue("--beacon-look-x"))).toBeLessThan(0);
    expect(
      Number.parseFloat(button.style.getPropertyValue("--beacon-look-x")),
    ).toBeGreaterThanOrEqual(-2.5);
    expect(Number.parseFloat(button.style.getPropertyValue("--beacon-look-y"))).toBeLessThan(0);
    expect(
      Number.parseFloat(button.style.getPropertyValue("--beacon-look-y")),
    ).toBeGreaterThanOrEqual(-2.25);
    expect(Number.parseFloat(button.style.getPropertyValue("--beacon-lean"))).toBeLessThan(0);
    expect(
      Number.parseFloat(button.style.getPropertyValue("--beacon-lean")),
    ).toBeGreaterThanOrEqual(-6);
    expect(frames.pending.size).toBe(0);
  });

  it.each(["blur", "pointer leaving the window", "scroll", "visibilitychange"])(
    "clears tracking and cancels pending work on %s",
    (reason) => {
      const { button } = setup();
      move();
      frames.flush();
      expect(button.style.getPropertyValue("--beacon-look-x")).not.toBe("");
      move(-10_000, -10_000);
      const [pendingID] = frames.pending.keys();

      if (reason === "pointer leaving the window") {
        fireEvent.pointerOut(window, { relatedTarget: null });
      } else if (reason === "visibilitychange") {
        fireEvent(document, new Event("visibilitychange"));
      } else {
        fireEvent(window, new Event(reason));
      }

      expect(frames.cancel).toHaveBeenCalledWith(pendingID);
      expect(frames.pending.size).toBe(0);
      expectTrackingCleared(button);
      frames.flush();
      expectTrackingCleared(button);
      move();
      frames.flush();
      expect(button.style.getPropertyValue("--beacon-look-x")).not.toBe("");
    },
  );

  it("does not reset when the pointer crosses elements inside the window", () => {
    const { button } = setup();
    move();
    fireEvent.pointerOut(window, { relatedTarget: button });
    frames.flush();
    expect(Number.parseFloat(button.style.getPropertyValue("--beacon-look-x"))).toBeGreaterThan(0);
  });

  it("ignores touch hover and movement, clearing any stale mouse tracking", () => {
    const { button } = setup();
    fireEvent.pointerEnter(button, { pointerType: "touch" });
    move(500, 500, "touch");
    expect(button.dataset.gesture).toBe("idle");
    expect(frames.request).not.toHaveBeenCalled();
    move();
    frames.flush();
    move();
    move(500, 500, "touch");
    expect(frames.pending.size).toBe(0);
    expectTrackingCleared(button);
  });

  it("does not resume tracking from pointer events while the document is hidden", () => {
    const { button } = setup();
    move();
    frames.flush();
    vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    move();
    expect(frames.pending.size).toBe(0);
    expectTrackingCleared(button);
  });

  it("starts inert when native accessibility already requests reduced motion", () => {
    document.documentElement.dataset.reducedMotion = "true";
    const { button } = setup();
    expect(button.disabled).toBe(true);
    move();
    fireEvent.pointerEnter(button, { pointerType: "mouse" });
    fireEvent.click(button);
    expect(frames.request).not.toHaveBeenCalled();
    expect(button.dataset.gesture).toBe("idle");
    expect(button.dataset.spinning).toBe("false");
  });

  it.each(["native preference", "system preference"])(
    "dynamically cancels tracking and gestures when the %s reduces motion",
    async (source) => {
      const { button } = setup();
      async function setReduced(reducedMotion: boolean) {
        if (source === "system preference") motion.setAllowed(!reducedMotion);
        else {
          await act(async () => {
            document.documentElement.dataset.reducedMotion = String(reducedMotion);
          });
        }
        await waitFor(() => expect(button.disabled).toBe(reducedMotion));
      }

      move();
      frames.flush();
      move();
      const [pendingID] = frames.pending.keys();
      await setReduced(true);
      expect(button.disabled).toBe(true);
      expect(frames.cancel).toHaveBeenCalledWith(pendingID);
      expect(frames.pending.size).toBe(0);
      expectTrackingCleared(button);
      frames.request.mockClear();
      move();
      fireEvent.pointerEnter(button, { pointerType: "mouse" });
      fireEvent.click(button);
      expect(frames.request).not.toHaveBeenCalled();
      expect(button.dataset.gesture).toBe("idle");
      expect(button.dataset.spinning).toBe("false");

      await setReduced(false);
      expect(button.disabled).toBe(false);
      fireEvent.click(button);
      expect(button.dataset.gesture).toBe("hello");
      expect(button.dataset.spinning).toBe("true");
      await setReduced(true);
      expect(button.dataset.gesture).toBe("idle");
      expect(button.dataset.spinning).toBe("false");
      await setReduced(false);
      expect(button.dataset.gesture).toBe("idle");
      expect(button.dataset.spinning).toBe("false");
      move();
      frames.flush();
      expect(button.style.getPropertyValue("--beacon-look-x")).not.toBe("");
      fireEvent.click(button);
      expect(button.dataset.spinning).toBe("true");
    },
  );

  it("stays disabled when system motion returns but native accessibility still reduces motion", async () => {
    motion.setAllowed(false);
    const { button } = setup();
    expect(button.disabled).toBe(true);
    await act(async () => {
      document.documentElement.dataset.reducedMotion = "true";
    });
    motion.setAllowed(true);
    expect(button.disabled).toBe(true);
    move();
    expect(frames.request).not.toHaveBeenCalled();
  });

  it.each([
    { random: 0.1, gesture: "hello", completion: "palot-beacon-hello-loop" },
    { random: 0.9, gesture: "orbit", completion: "palot-beacon-orbit-loop" },
  ])("waits for $gesture completion before allowing another hover gesture", (scenario) => {
    const random = vi.spyOn(Math, "random").mockReturnValue(scenario.random);
    const { button } = setup();
    move();
    fireEvent.pointerEnter(button, { pointerType: "mouse" });
    expect(button.dataset.gesture).toBe(scenario.gesture);
    expect(frames.pending.size).toBe(0);
    move();
    expect(frames.pending.size).toBe(0);
    random.mockReturnValue(scenario.random < 0.5 ? 0.9 : 0.1);
    fireEvent.pointerLeave(button, { pointerType: "mouse" });
    fireEvent.pointerEnter(button, { pointerType: "mouse" });
    expect(button.dataset.gesture).toBe(scenario.gesture);
    finishAnimation(button, "palot-beacon-hello-gaze");
    expect(button.dataset.gesture).toBe(scenario.gesture);
    finishAnimation(button, scenario.completion);
    expect(button.dataset.gesture).toBe("idle");
    move();
    frames.flush();
    expect(button.style.getPropertyValue("--beacon-look-x")).not.toBe("");
    fireEvent.pointerLeave(button, { pointerType: "mouse" });
    fireEvent.pointerEnter(button, { pointerType: "mouse" });
    expect(button.dataset.gesture).toBe(scenario.gesture === "hello" ? "orbit" : "hello");
  });

  it("unlocks another click after the spin completes without ending the longer gesture", () => {
    const { button } = setup();
    fireEvent.click(button);
    expect(button.dataset.spinning).toBe("true");
    finishAnimation(button, "palot-beacon-hello-blink");
    expect(button.dataset.spinning).toBe("true");
    finishAnimation(button, "palot-beacon-spin");
    expect(button.dataset.spinning).toBe("false");
    expect(button.dataset.gesture).toBe("hello");
    fireEvent.click(button);
    expect(button.dataset.spinning).toBe("true");
    finishAnimation(button, "palot-beacon-hello-loop");
    expect(button.dataset.gesture).toBe("idle");
    move();
    expect(frames.pending.size).toBe(0);
    finishAnimation(button, "palot-beacon-spin");
    move();
    frames.flush();
    expect(button.style.getPropertyValue("--beacon-look-x")).not.toBe("");
  });

  it("cancels pending frames and removes global and media listeners on unmount", () => {
    const addWindow = vi.spyOn(window, "addEventListener");
    const removeWindow = vi.spyOn(window, "removeEventListener");
    const addDocument = vi.spyOn(document, "addEventListener");
    const removeDocument = vi.spyOn(document, "removeEventListener");
    const addMedia = vi.spyOn(motion.media, "addEventListener");
    const removeMedia = vi.spyOn(motion.media, "removeEventListener");
    const observe = vi.spyOn(MutationObserver.prototype, "observe");
    const disconnect = vi.spyOn(MutationObserver.prototype, "disconnect");
    const { button, unmount } = setup();
    move();
    frames.flush();
    move();
    const [pendingID] = frames.pending.keys();
    unmount();
    expect(frames.cancel).toHaveBeenCalledWith(pendingID);
    expect(frames.pending.size).toBe(0);
    expectTrackingCleared(button);
    for (const type of ["pointermove", "pointerout", "blur", "scroll"]) {
      const registration = addWindow.mock.calls.find(([event]) => event === type);
      expect(registration).toBeDefined();
      if (type === "scroll") {
        expect(removeWindow).toHaveBeenCalledWith(type, registration![1], true);
      } else {
        expect(removeWindow).toHaveBeenCalledWith(type, registration![1]);
      }
    }
    const visibility = addDocument.mock.calls.find(([type]) => type === "visibilitychange");
    expect(visibility).toBeDefined();
    expect(removeDocument).toHaveBeenCalledWith("visibilitychange", visibility![1]);
    const subscription = addMedia.mock.calls.find(([type]) => type === "change");
    expect(subscription).toBeDefined();
    expect(removeMedia).toHaveBeenCalledWith("change", subscription![1]);
    const rootObserverIndex = observe.mock.calls.findIndex(
      ([target]) => target === document.documentElement,
    );
    expect(rootObserverIndex).toBeGreaterThanOrEqual(0);
    expect(disconnect.mock.contexts).toContain(observe.mock.contexts[rootObserverIndex]);
    frames.request.mockClear();
    move();
    motion.setAllowed(false);
    motion.setAllowed(true);
    move();
    expect(frames.request).not.toHaveBeenCalled();
  });
});
