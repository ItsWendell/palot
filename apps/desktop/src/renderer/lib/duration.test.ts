import { describe, expect, it } from "vitest";
import { formatDurationPrecise, formatElapsed } from "./duration";

describe("formatElapsed", () => {
  it.each([
    [0, "0s"],
    [999, "0s"],
    [1_000, "1s"],
    [59_900, "59s"],
    [60_000, "1m"],
    [65_000, "1m 5s"],
    [120_000, "2m"],
    [3_599_999, "59m 59s"],
    [3_600_000, "1h"],
    [3_605_000, "1h 5s"],
    [3_725_000, "1h 2m 5s"],
  ])("formats %d ms as %s", (ms, label) => {
    expect(formatElapsed(ms)).toBe(label);
  });

  it("treats negative and invalid values as no time", () => {
    expect(formatElapsed(-5_000)).toBe("0s");
    expect(formatElapsed(Number.NaN)).toBe("0s");
  });
});

describe("formatDurationPrecise", () => {
  it.each([
    [0, "0ms"],
    [120, "120ms"],
    [999, "999ms"],
    [1_000, "1s"],
    [1_449, "1.4s"],
    [9_999, "9.9s"],
    [10_000, "10s"],
    [59_900, "59s"],
    [60_000, "1m"],
    [65_400, "1m 5s"],
    [3_600_000, "1h"],
  ])("formats %d ms as %s", (ms, label) => {
    expect(formatDurationPrecise(ms)).toBe(label);
  });
});
