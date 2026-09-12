// @vitest-environment node

import { describe, expect, it } from "vitest";
import type { AutomationTrigger } from "../../shared";
import {
  advanceNextRun,
  automationOccurrences,
  initialNextRun,
  nextAutomationOccurrence,
  overdueOccurrenceCount,
  isMissedAutomationOccurrence,
  validateAutomationTrigger,
} from "./recurrence";

describe("automation recurrence", () => {
  it("calculates weekday occurrences in the selected timezone", () => {
    const trigger: AutomationTrigger = {
      version: 1,
      type: "recurring",
      dtstart: Date.parse("2026-08-21T09:00:00+02:00"),
      timezone: "Europe/Amsterdam",
      rrule: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR",
    };

    const values = automationOccurrences(trigger, Date.parse("2026-08-21T07:00:01Z"), 3);
    expect(values).toHaveLength(3);
    expect(
      values.map((value) =>
        new Intl.DateTimeFormat("en-US", {
          timeZone: trigger.timezone,
          weekday: "short",
          hour: "numeric",
          hour12: false,
        }).format(value),
      ),
    ).toEqual(["Mon, 09", "Tue, 09", "Wed, 09"]);
  });

  it.each([
    {
      name: "spring forward",
      start: "2026-03-28T09:00:00+01:00",
      expected: ["2026-03-28T08:00:00Z", "2026-03-29T07:00:00Z", "2026-03-30T07:00:00Z"] as const,
    },
    {
      name: "fall back",
      start: "2026-10-24T09:00:00+02:00",
      expected: ["2026-10-24T07:00:00Z", "2026-10-25T08:00:00Z", "2026-10-26T08:00:00Z"] as const,
    },
  ])(
    "keeps 09:00 local time across $name and respects instant boundaries",
    ({ start, expected }) => {
      const trigger: AutomationTrigger = {
        version: 1,
        type: "recurring",
        dtstart: Date.parse(start),
        timezone: "Europe/Amsterdam",
        rrule: "FREQ=DAILY;COUNT=3",
      };
      const first = Date.parse(expected[0]);
      const second = Date.parse(expected[1]);
      const third = Date.parse(expected[2]);

      expect(automationOccurrences(trigger, first - 1)).toEqual([first, second, third]);
      expect(initialNextRun(trigger, second)).toBe(second);
      expect(nextAutomationOccurrence(trigger, second - 1)).toBe(second);
      expect(nextAutomationOccurrence(trigger, second)).toBe(third);
      expect(advanceNextRun(trigger, second)).toBe(third);
      expect(advanceNextRun(trigger, third)).toBeNull();
      expect(overdueOccurrenceCount(trigger, first, third - 1)).toBe(2);
      expect(overdueOccurrenceCount(trigger, first, third)).toBe(3);
      expect(overdueOccurrenceCount(trigger, second, third, 1)).toBe(1);
    },
  );

  it("uses the local calendar day with a fractional-hour timezone offset", () => {
    const trigger: AutomationTrigger = {
      version: 1,
      type: "recurring",
      dtstart: Date.parse("2026-08-24T00:30:00+05:45"),
      timezone: "Asia/Kathmandu",
      rrule: "FREQ=WEEKLY;BYDAY=MO;COUNT=2",
    };

    expect(automationOccurrences(trigger, trigger.dtstart - 1)).toEqual([
      Date.parse("2026-08-23T18:45:00Z"),
      Date.parse("2026-08-30T18:45:00Z"),
    ]);
  });

  it("keeps UTC schedules unchanged during a host timezone's spring-forward gap", () => {
    const trigger: AutomationTrigger = {
      version: 1,
      type: "recurring",
      dtstart: Date.parse("2026-03-28T02:30:00Z"),
      timezone: "UTC",
      rrule: "FREQ=DAILY;COUNT=3",
    };

    expect(automationOccurrences(trigger, trigger.dtstart - 1)).toEqual([
      Date.parse("2026-03-28T02:30:00Z"),
      Date.parse("2026-03-29T02:30:00Z"),
      Date.parse("2026-03-30T02:30:00Z"),
    ]);
  });

  it("includes a UTC UNTIL boundary after a DST change", () => {
    const trigger: AutomationTrigger = {
      version: 1,
      type: "recurring",
      dtstart: Date.parse("2026-03-28T09:00:00+01:00"),
      timezone: "Europe/Amsterdam",
      rrule: "FREQ=DAILY;UNTIL=20260330T070000Z",
    };

    expect(automationOccurrences(trigger, trigger.dtstart - 1)).toEqual([
      Date.parse("2026-03-28T08:00:00Z"),
      Date.parse("2026-03-29T07:00:00Z"),
      Date.parse("2026-03-30T07:00:00Z"),
    ]);
  });

  it("does not skip a future occurrence when the query is in the first repeated DST hour", () => {
    const trigger: AutomationTrigger = {
      version: 1,
      type: "recurring",
      dtstart: Date.parse("2026-10-24T02:30:00+02:00"),
      timezone: "Europe/Amsterdam",
      rrule: "FREQ=DAILY;COUNT=3",
    };
    const after = Date.parse("2026-10-25T02:45:00+02:00");
    const next = Date.parse("2026-10-25T02:30:00+01:00");

    expect(nextAutomationOccurrence(trigger, after)).toBe(next);
    expect(overdueOccurrenceCount(trigger, after, next - 1)).toBe(0);
    expect(overdueOccurrenceCount(trigger, after, next)).toBe(1);
    const bounded = { ...trigger, rrule: "FREQ=DAILY;UNTIL=20261025T004500Z" };
    expect(automationOccurrences(bounded, trigger.dtstart - 1)).toEqual([trigger.dtstart]);
    expect(overdueOccurrenceCount(bounded, trigger.dtstart, next)).toBe(1);
  });

  it("advances recurring schedules from now instead of replaying backlog", () => {
    const trigger: AutomationTrigger = {
      version: 1,
      type: "recurring",
      dtstart: Date.parse("2026-08-01T09:00:00Z"),
      timezone: "UTC",
      rrule: "FREQ=DAILY;INTERVAL=1",
    };
    const now = Date.parse("2026-08-22T12:00:00Z");

    expect(advanceNextRun(trigger, now)).toBe(Date.parse("2026-08-23T09:00:00Z"));
    expect(overdueOccurrenceCount(trigger, Date.parse("2026-08-20T09:00:00Z"), now)).toBe(3);
  });

  it("rejects unknown timezones", () => {
    expect(() =>
      validateAutomationTrigger({
        version: 1,
        type: "once",
        at: Date.now() + 1_000,
        timezone: "Mars/Olympus",
      }),
    ).toThrow("Unknown timezone");
  });

  it("does not classify normal scanner latency as a missed run", () => {
    expect(isMissedAutomationOccurrence(1, 30_000)).toBe(false);
    expect(isMissedAutomationOccurrence(59_999, 30_000)).toBe(false);
    expect(isMissedAutomationOccurrence(60_001, 30_000)).toBe(true);
  });
});
