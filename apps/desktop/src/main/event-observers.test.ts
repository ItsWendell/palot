// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { notifyEventObservers } from "./event-observers";

describe("event observers", () => {
  it("isolates observer failures so later observers and transport still run", () => {
    const order: string[] = [];
    const error = vi.fn(() => order.push("error"));

    notifyEventObservers(
      [
        () => {
          order.push("first");
          throw new Error("observer failed");
        },
        () => order.push("second"),
      ],
      "event",
      error,
    );

    expect(order).toEqual(["first", "error", "second"]);
    expect(error).toHaveBeenCalledOnce();
  });
});
