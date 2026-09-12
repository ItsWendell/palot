import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useIsMobile } from "./use-mobile";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("useIsMobile", () => {
  it("reads and subscribes to the media query as an external store", () => {
    let matches = true;
    const listeners = new Set<() => void>();
    vi.spyOn(window, "matchMedia").mockImplementation(
      () =>
        ({
          get matches() {
            return matches;
          },
          addEventListener: (_type: string, listener: () => void) => {
            listeners.add(listener);
          },
          removeEventListener: (_type: string, listener: () => void) => {
            listeners.delete(listener);
          },
        }) as unknown as MediaQueryList,
    );

    const { result, unmount } = renderHook(() => useIsMobile());
    expect(result.current).toBe(true);
    expect(listeners.size).toBe(1);

    act(() => {
      matches = false;
      for (const listener of listeners) listener();
    });
    expect(result.current).toBe(false);

    unmount();
    expect(listeners.size).toBe(0);
  });
});
