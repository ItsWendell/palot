import { describe, expect, it } from "vitest";
import { formatUsageDateRange, usageDateRange } from "./session-stats-range";

describe("usage date ranges", () => {
  it("keeps one stable cache window for the local calendar day", () => {
    const morning = new Date(2026, 7, 25, 8).getTime();
    const evening = new Date(2026, 7, 25, 22).getTime();

    expect(usageDateRange(30, morning)).toEqual(usageDateRange(30, evening));
  });

  it("uses timezone calendar midnights across daylight-saving changes", () => {
    const range = usageDateRange(7, Date.UTC(2026, 2, 30, 12), "Europe/Amsterdam");
    const from = new Intl.DateTimeFormat("en-CA", {
      dateStyle: "short",
      timeStyle: "medium",
      hourCycle: "h23",
      timeZone: range.timezone,
    }).format(range.from);
    const to = new Intl.DateTimeFormat("en-CA", {
      dateStyle: "short",
      timeStyle: "medium",
      hourCycle: "h23",
      timeZone: range.timezone,
    }).format(range.to);

    expect(from).toContain("00:00:00");
    expect(to).toContain("00:00:00");
    expect(range.to - range.from).toBe(167 * 60 * 60_000);
  });

  it("formats the inclusive returned range", () => {
    const range = usageDateRange(30, new Date(2026, 7, 25, 12).getTime(), "UTC");
    expect(formatUsageDateRange(range)).toContain("to");
  });
});
