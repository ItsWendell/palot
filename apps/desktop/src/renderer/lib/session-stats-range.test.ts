import { describe, expect, it } from "vitest";
import {
  formatUsageDateRange,
  previousUsageDateRange,
  usageDateRange,
} from "./session-stats-range";

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

  it.each([
    ["spring", Date.UTC(2026, 2, 30, 12), 167, 168],
    ["autumn", Date.UTC(2026, 9, 26, 12), 169, 168],
  ])(
    "compares full calendar ranges across the %s clock change",
    (_season, now, currentHours, previousHours) => {
      const range = usageDateRange(7, now, "Europe/Amsterdam");
      const previous = previousUsageDateRange(range);

      expect(previous.to).toBe(range.from);
      expect(range.to - range.from).toBe(currentHours * 60 * 60_000);
      expect(previous.to - previous.from).toBe(previousHours * 60 * 60_000);
      expect(previous.timezone).toBe("Europe/Amsterdam");
    },
  );

  it("formats the inclusive returned range", () => {
    const range = usageDateRange(30, new Date(2026, 7, 25, 12).getTime(), "UTC");
    expect(formatUsageDateRange(range)).toContain("to");
  });
});
