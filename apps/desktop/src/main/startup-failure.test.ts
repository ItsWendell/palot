// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { createProcessFailureHandler } from "./startup-failure";

function handler(startupFinished: boolean) {
  const recover = vi.fn();
  const log = vi.fn();
  const handle = createProcessFailureHandler({
    startupFinished: () => startupFinished,
    recover,
    log,
  });
  return { handle, recover, log };
}

describe("process failure routing", () => {
  it("sends failures during startup to recovery", () => {
    const { handle, recover, log } = handler(false);
    const failure = new Error("boot");
    handle("rejection", failure);
    expect(recover).toHaveBeenCalledExactlyOnceWith(failure);
    expect(log).not.toHaveBeenCalled();
  });

  it("logs every failure after startup without opening recovery", () => {
    const { handle, recover, log } = handler(true);
    const first = new Error("first");
    const second = new Error("second");
    handle("exception", first);
    handle("rejection", second);
    expect(recover).not.toHaveBeenCalled();
    expect(log.mock.calls).toEqual([
      ["Palot caught an uncaught exception", first],
      ["Palot caught an unhandled promise rejection", second],
    ]);
  });
});
