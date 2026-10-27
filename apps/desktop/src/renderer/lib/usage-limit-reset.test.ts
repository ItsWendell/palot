import { describe, expect, it } from "vitest";
import { usageLimitResetAt, usageLimitResetText, usageLimitTitle } from "./usage-limit-reset";

const failedAt = Date.UTC(2026, 9, 26, 12, 0, 0);

describe("usage limit reset", () => {
  it("names usage and rate-limit failures", () => {
    expect(usageLimitTitle("provider.free-limit")).toBe("Free usage limit reached");
    expect(usageLimitTitle("provider.quota")).toBe("Usage limit reached");
    expect(usageLimitTitle("provider.rate-limit")).toBe("Rate limited");
    expect(usageLimitTitle("provider.auth")).toBeNull();
    expect(usageLimitTitle(null)).toBeNull();
  });

  it("counts the wait from when the failure was recorded and rejects unusable waits", () => {
    expect(usageLimitResetAt(failedAt, 90_000)).toBe(failedAt + 90_000);
    for (const wait of [undefined, null, -1, Number.NaN, 8 * 86_400_000])
      expect(usageLimitResetAt(failedAt, wait)).toBeNull();
  });

  it("says when to try again, with a date only when the reset is not today", () => {
    const today = usageLimitResetText(failedAt, 3_600_000, failedAt, "en-GB");
    expect(today).toMatch(/^Try again after \d{2}:\d{2}\.$/);
    const later = usageLimitResetText(failedAt, 3 * 86_400_000, failedAt, "en-GB");
    expect(later).toMatch(/^Try again after .*2026.*\d{2}:\d{2}\.$/);
    expect(usageLimitResetText(failedAt, 60_000, failedAt + 120_000)).toBe(
      "The limit has reset; you can try again.",
    );
    expect(usageLimitResetText(failedAt, undefined)).toBeNull();
  });
});
