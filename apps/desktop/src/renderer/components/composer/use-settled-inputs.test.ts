import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PendingRequestView } from "../../lib/view-models";
import { IDLE_SEND_GRACE_MS, useSettledInputs } from "./use-settled-inputs";

const input = (id: string) => ({ id, type: "input", delivery: "queue" }) as PendingRequestView;

describe("useSettledInputs", () => {
  beforeEach(() => void vi.useFakeTimers());
  afterEach(() => void vi.useRealTimers());

  it("keeps a message sent to an idle task out of the queue while it is on its way", () => {
    const { result, rerender } = renderHook(
      ({ requests, working }) => useSettledInputs(requests, working),
      { initialProps: { requests: [] as PendingRequestView[], working: false } },
    );
    const sent = [input("a")];
    rerender({ requests: sent, working: false });
    expect(result.current).toEqual([]);
    // The turn starting does not bring it back for the moment before it is delivered.
    rerender({ requests: sent, working: true });
    expect(result.current).toEqual([]);
    rerender({ requests: [], working: true });
    expect(result.current).toEqual([]);
  });

  it("shows it once it is still waiting after the grace", () => {
    const { result, rerender } = renderHook(
      ({ requests, working }) => useSettledInputs(requests, working),
      { initialProps: { requests: [] as PendingRequestView[], working: false } },
    );
    const sent = [input("a")];
    rerender({ requests: sent, working: false });
    act(() => void vi.advanceTimersByTime(IDLE_SEND_GRACE_MS));
    expect(result.current).toBe(sent);
  });

  it("shows inputs at once when the task works or they were waiting at open", () => {
    const waiting = [input("a")];
    const { result, rerender } = renderHook(
      ({ requests, working }) => useSettledInputs(requests, working),
      { initialProps: { requests: waiting, working: false } },
    );
    expect(result.current).toBe(waiting);
    const more = [...waiting, input("b")];
    rerender({ requests: more, working: true });
    expect(result.current).toBe(more);
  });

  it("shows the copies a move to the top admits at once, so the paused queue never flashes", () => {
    const copies = new Map<string, string>();
    const waiting = [input("a"), input("b")];
    const { result, rerender } = renderHook(
      ({ requests }) => useSettledInputs(requests, false, copies),
      { initialProps: { requests: waiting } },
    );
    copies.set("copy_a", "a");
    const moved = [input("b"), input("copy_a")];
    rerender({ requests: moved });
    expect(result.current).toBe(moved);
  });
});
