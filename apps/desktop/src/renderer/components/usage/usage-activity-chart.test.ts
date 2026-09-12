import { describe, expect, it } from "vitest";
import { usageActivityRows } from "./usage-activity-chart";

describe("usage activity projection", () => {
  it("fills missing daily activity with zero-step rows", () => {
    const from = new Date(2026, 7, 1).getTime();
    const to = new Date(2026, 7, 4).getTime();
    const rows = usageActivityRows(
      [
        { date: "2026-08-01", steps: 3 },
        { date: "2026-08-03", steps: 8 },
      ],
      from,
      to,
      Intl.DateTimeFormat().resolvedOptions().timeZone,
    );

    expect(rows.map(({ steps }) => steps)).toEqual([3, 0, 8]);
  });
});
