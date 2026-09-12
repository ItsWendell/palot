import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const embla = vi.hoisted(() => {
  const listeners = new Map<string, Set<() => void>>();
  const state = { previous: false, next: true };
  const api = {
    canScrollPrev: vi.fn(() => state.previous),
    canScrollNext: vi.fn(() => state.next),
    scrollPrev: vi.fn(),
    scrollNext: vi.fn(),
    on: vi.fn((event: string, listener: () => void) => {
      const current = listeners.get(event) ?? new Set();
      current.add(listener);
      listeners.set(event, current);
      return api;
    }),
    off: vi.fn((event: string, listener: () => void) => {
      listeners.get(event)?.delete(listener);
      return api;
    }),
  };
  return {
    api,
    listeners,
    state,
    emit(event: string) {
      for (const listener of listeners.get(event) ?? []) listener();
    },
  };
});

vi.mock("embla-carousel-react", () => ({
  default: () => [vi.fn(), embla.api],
}));

import { Carousel, CarouselNext, CarouselPrevious } from "./carousel";

describe("Carousel", () => {
  beforeEach(() => {
    embla.state.previous = false;
    embla.state.next = true;
    embla.listeners.clear();
    vi.clearAllMocks();
  });

  it("subscribes to Embla availability and removes both listeners", () => {
    const setApi = vi.fn();
    const view = render(
      <Carousel setApi={setApi}>
        <CarouselPrevious />
        <CarouselNext />
      </Carousel>,
    );

    expect(setApi).toHaveBeenCalledWith(embla.api);
    expect(
      (screen.getByRole("button", { name: "Previous slide" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect((screen.getByRole("button", { name: "Next slide" }) as HTMLButtonElement).disabled).toBe(
      false,
    );

    act(() => {
      embla.state.previous = true;
      embla.state.next = false;
      embla.emit("select");
    });

    expect(
      (screen.getByRole("button", { name: "Previous slide" }) as HTMLButtonElement).disabled,
    ).toBe(false);
    expect((screen.getByRole("button", { name: "Next slide" }) as HTMLButtonElement).disabled).toBe(
      true,
    );

    view.unmount();
    expect(embla.listeners.get("select")).toHaveLength(0);
    expect(embla.listeners.get("reInit")).toHaveLength(0);
  });
});
