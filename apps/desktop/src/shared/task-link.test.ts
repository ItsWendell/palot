// @vitest-environment node
import { describe, expect, it } from "vitest";
import { parseTaskLink, taskLink } from "./task-link";

const id = "ses_0123456789abcdefghijABCDEF";

describe("task links", () => {
  it("round-trips the links Palot writes", () => {
    expect(taskLink(id)).toBe(`palot://task/${id}`);
    expect(parseTaskLink(taskLink(id, "6f1c2a9e-1b2c-4d5e-8f90-1234567890ab"))).toEqual({
      sessionID: id,
      profileID: "6f1c2a9e-1b2c-4d5e-8f90-1234567890ab",
    });
    // A profile that is not a plain id is left out rather than written.
    expect(taskLink(id, "a b")).toBe(`palot://task/${id}`);
    expect(() => taskLink("ses_short")).toThrow();
  });

  it("refuses look-alikes", () => {
    for (const link of [
      `https://task/${id}`,
      `palot://TASK/${id}x`,
      `palot://task:1/${id}`,
      `palot://task/${id}?`,
      `palot://task/${id}#`,
      `palot://task/${id} `,
      `palot://task/${id}%00`,
      `palot://task/${"x".repeat(600)}`,
    ])
      expect(parseTaskLink(link)).toBeNull();
  });
});
