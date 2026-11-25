// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";
import { runShutdownSequence } from "./shutdown-sequence";

afterEach(() => {
  vi.useRealTimers();
});

describe("shutdown sequence", () => {
  it("logs a failing step and still runs the later ones in order", async () => {
    const order: string[] = [];
    const log = vi.fn();
    const failure = new Error("tray broke");
    const result = await runShutdownSequence(
      [
        { name: "sync", run: () => order.push("sync") },
        {
          name: "tray",
          run: async () => {
            order.push("tray");
            throw failure;
          },
        },
        {
          name: "throws",
          run: () => {
            order.push("throws");
            throw failure;
          },
        },
        { name: "database", run: async () => order.push("database") },
      ],
      { deadlineMs: 10_000, log },
    );
    expect(result).toBe("settled");
    expect(order).toEqual(["sync", "tray", "throws", "database"]);
    expect(log.mock.calls).toEqual([
      ["Shutdown step failed: tray", failure],
      ["Shutdown step failed: throws", failure],
    ]);
  });

  it("ends at the deadline when a step hangs and starts no later step", async () => {
    vi.useFakeTimers();
    const log = vi.fn();
    const later = vi.fn();
    const pending = runShutdownSequence(
      [
        { name: "guest links", run: () => new Promise(() => {}) },
        { name: "database", run: later },
      ],
      { deadlineMs: 10_000, log },
    );
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(pending).resolves.toBe("deadline");
    expect(later).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith("Shutdown did not finish within 10000 ms; quitting anyway");
  });
});
