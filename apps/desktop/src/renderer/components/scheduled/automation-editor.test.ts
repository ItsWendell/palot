// @vitest-environment node

import { describe, expect, it } from "vitest";
import { buildTrigger, triggerDate, triggerTime } from "./automation-editor";

describe("automation schedule form timezone", () => {
  it("preserves the selected wall clock outside the machine timezone", () => {
    const trigger = buildTrigger(
      "daily",
      "2026-08-22",
      "09:00",
      "Europe/Amsterdam",
      "FREQ=DAILY;INTERVAL=1",
    );

    expect(trigger).toMatchObject({
      type: "recurring",
      dtstart: Date.parse("2026-08-22T07:00:00Z"),
      timezone: "Europe/Amsterdam",
    });
    expect(triggerDate(trigger)).toBe("2026-08-22");
    expect(triggerTime(trigger)).toBe("09:00");
  });

  it("uses the selected timezone offset after a DST transition", () => {
    const trigger = buildTrigger(
      "daily",
      "2026-11-02",
      "09:00",
      "America/New_York",
      "FREQ=DAILY;INTERVAL=1",
    );

    expect(trigger.type === "recurring" ? trigger.dtstart : null).toBe(
      Date.parse("2026-11-02T14:00:00Z"),
    );
  });
});
