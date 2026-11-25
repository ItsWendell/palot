import { describe, expect, it } from "vitest";
import { ENTER_GUARD_MS, requestGuard } from "./request-guard";

describe("requestGuard", () => {
  it("lets a request that arrives during a pause take Enter at once", () => {
    const guard = requestGuard({
      shownAt: 10_000,
      lastKeystrokeAt: 10_000 - ENTER_GUARD_MS,
      now: 10_000,
      draftAtArrival: false,
    });
    expect(guard).toEqual({ field: "feedback", armed: true, ownsEnter: true, armsAt: null });
  });

  it("lets a request take Enter when nobody has typed", () => {
    expect(
      requestGuard({ shownAt: 5, lastKeystrokeAt: null, now: 5, draftAtArrival: false }).ownsEnter,
    ).toBe(true);
  });

  it("makes a request that arrives mid-typing wait for a 1.5 s pause", () => {
    const typing = { shownAt: 10_000, lastKeystrokeAt: 9_800, draftAtArrival: false };
    const early = requestGuard({ ...typing, now: 10_500 });
    expect(early.armed).toBe(false);
    expect(early.ownsEnter).toBe(false);
    expect(early.armsAt).toBe(9_800 + ENTER_GUARD_MS);
    expect(requestGuard({ ...typing, now: 11_300 }).ownsEnter).toBe(true);
  });

  it("keeps typing after the request arrived deferring it", () => {
    const guard = requestGuard({
      shownAt: 10_000,
      lastKeystrokeAt: 12_000,
      now: 13_000,
      draftAtArrival: false,
    });
    expect(guard.ownsEnter).toBe(false);
    expect(guard.armsAt).toBe(13_500);
  });

  it("never turns a draft that existed before the request into feedback", () => {
    const guard = requestGuard({
      shownAt: 10_000,
      lastKeystrokeAt: 1_000,
      now: 60_000,
      draftAtArrival: true,
    });
    expect(guard.field).toBe("message");
    expect(guard.armed).toBe(true);
    expect(guard.ownsEnter).toBe(false);
  });
});
