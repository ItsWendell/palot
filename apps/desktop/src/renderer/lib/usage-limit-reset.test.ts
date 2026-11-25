import { describe, expect, it } from "vitest";
import {
  resettingLimit,
  usageLimitResetAt,
  usageLimitResetsText,
  usageLimitResetText,
  usageLimitRetryLabel,
  usageLimitTitle,
} from "./usage-limit-reset";

const failedAt = Date.UTC(2026, 9, 26, 12, 0, 0);

describe("usage limit reset", () => {
  it("names usage and rate-limit failures", () => {
    expect(usageLimitTitle("provider.free-limit")).toBe("Free usage limit reached");
    expect(usageLimitTitle("provider.quota")).toBe("Usage limit reached");
    expect(usageLimitTitle("provider.rate-limit")).toBe("Rate limited");
    expect(usageLimitTitle("provider.auth")).toBeNull();
    expect(usageLimitTitle(null)).toBeNull();
  });

  it("names OpenCode 2.4's specific limits, the Go window from the response body", () => {
    const body = JSON.stringify({ metadata: { workspace: "wrk_1", limitName: "weekly" } });
    expect(usageLimitTitle("provider.go-limit", 429, body)).toBe(
      "OpenCode Go weekly limit reached",
    );
    expect(usageLimitTitle("provider.budget-limit", 429)).toBe("Workspace usage limit reached");
    expect(usageLimitTitle("provider.model-budget-limit", 429)).toBe("Model spend limit reached");
    expect(usageLimitTitle("provider.chatgpt-limit")).toBe("ChatGPT usage limit reached");
    expect(usageLimitTitle("provider.chatgpt-workspace-limit")).toBe(
      "ChatGPT workspace limit reached",
    );
  });

  it("calls a 402 quota out of credits, a balance that does not reset", () => {
    expect(usageLimitTitle("provider.quota", 402)).toBe("Out of credits");
    expect(usageLimitTitle("provider.quota", 429)).toBe("Usage limit reached");
    expect(resettingLimit("provider.quota", 402)).toBe(false);
    expect(resettingLimit("provider.quota", 429)).toBe(true);
    expect(resettingLimit("provider.rate-limit")).toBe(true);
    expect(resettingLimit("provider.auth")).toBe(false);
  });

  it("labels a retry with its countdown and attempt", () => {
    expect(usageLimitRetryLabel("Usage limit reached", 2)).toBe(
      "Usage limit reached · retrying (attempt 2)",
    );
    expect(usageLimitRetryLabel("Usage limit reached", 2, 40)).toBe(
      "Usage limit reached · retrying in 40s (attempt 2)",
    );
    expect(usageLimitRetryLabel("Rate limited", null, 0)).toBe("Rate limited · retrying");
  });

  it("says when a limit being retried resets, and nothing once it has", () => {
    expect(usageLimitResetsText(failedAt + 3_600_000, failedAt, "en-GB")).toMatch(
      /^Resets at \d{2}:\d{2}\.$/,
    );
    expect(usageLimitResetsText(failedAt - 1, failedAt)).toBeNull();
    expect(usageLimitResetsText(null, failedAt)).toBeNull();
  });

  it("counts the wait from when the failure was recorded and rejects unusable waits", () => {
    expect(usageLimitResetAt(failedAt, 90_000)).toBe(failedAt + 90_000);
    for (const wait of [undefined, null, -1, Number.NaN, 46 * 86_400_000])
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
