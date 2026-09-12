// @vitest-environment node

import type { OpenCodeEvent } from "@opencode/client";
import { describe, expect, it } from "vitest";
import { EventReplayGuard } from "./event-replay-guard";

const event = (id: string, seq?: number) =>
  ({
    id,
    type: "server.connected",
    data: {},
    ...(seq === undefined ? {} : { durable: { aggregateID: "session-1", seq, version: 1 } }),
  }) as OpenCodeEvent;

describe("event replay guard", () => {
  it("drops replayed event IDs and durable sequences", () => {
    const guard = new EventReplayGuard();

    expect(guard.admit(event("event-1"))).toBe(true);
    expect(guard.admit(event("event-1"))).toBe(false);
    expect(guard.admit(event("event-2", 4))).toBe(true);
    expect(guard.admit(event("different-id", 4))).toBe(false);
  });

  it("bounds retained replay keys", () => {
    const guard = new EventReplayGuard(2);

    expect(guard.admit(event("event-1"))).toBe(true);
    expect(guard.admit(event("event-2"))).toBe(true);
    expect(guard.admit(event("event-3"))).toBe(true);
    expect(guard.admit(event("event-1"))).toBe(true);
  });
});
