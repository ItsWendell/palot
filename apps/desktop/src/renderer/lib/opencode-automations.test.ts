import { describe, expect, it } from "vitest";
import {
  describeCron,
  mergeOpenCodeAutomations,
  openCodeActionSummary,
  openCodeRunLabel,
  openCodeTriggerLabel,
  type OpenCodeAutomation,
} from "./opencode-automations";

function automation(overrides: Partial<OpenCodeAutomation> = {}): OpenCodeAutomation {
  return {
    id: "aut_1",
    name: "Check build",
    projectID: "prj_1",
    directory: "/repo",
    trigger: { type: "every", every: "1 hour" },
    tz: "UTC",
    action: { type: "prompt", prompt: "Look at CI", to: { session: "ses_1" } },
    status: "active",
    runCount: 0,
    time: { created: 1, updated: 1 },
    ...overrides,
  };
}

const server = { profileID: "local", connectionID: "c1", serverName: "This Mac" };

describe("mergeOpenCodeAutomations", () => {
  it("keeps one row per server and ID, preferring the newest copy", () => {
    const stale = automation({ name: "Old" });
    const fresh = automation({ name: "New", time: { created: 1, updated: 5 } });
    const merged = mergeOpenCodeAutomations([
      { ...server, automations: [fresh] },
      { ...server, automations: [stale] },
      { profileID: "remote", connectionID: "c2", serverName: "Box", automations: [stale] },
    ]);
    expect(merged.map((entry) => [entry.key, entry.automation.name])).toEqual([
      ["local:aut_1", "New"],
      ["remote:aut_1", "Old"],
    ]);
  });

  it("lists active automations before paused and finished ones, soonest first", () => {
    const merged = mergeOpenCodeAutomations([
      {
        ...server,
        automations: [
          automation({ id: "aut_done", status: "done" }),
          automation({ id: "aut_paused", status: "paused" }),
          automation({ id: "aut_later", nextDueAt: 2_000 }),
          automation({ id: "aut_soon", nextDueAt: 1_000 }),
        ],
      },
    ]);
    expect(merged.map((entry) => entry.automation.id)).toEqual([
      "aut_soon",
      "aut_later",
      "aut_paused",
      "aut_done",
    ]);
  });
});

describe("openCodeTriggerLabel", () => {
  it("describes each trigger kind and names a zone other than the local one", () => {
    expect(openCodeTriggerLabel({ type: "every", every: "30 minutes" }, "UTC", "UTC")).toBe(
      "Every 30 minutes",
    );
    expect(
      openCodeTriggerLabel({ type: "cron", cron: "0 9 * * 1-5" }, "Europe/Amsterdam", "UTC"),
    ).toBe("Weekdays at 9:00 AM · Europe/Amsterdam");
    expect(openCodeTriggerLabel({ type: "cron", cron: "5 4 1,15 * *" }, "UTC", "UTC")).toBe(
      "Cron 5 4 1,15 * *",
    );
    expect(openCodeTriggerLabel({ type: "at", at: "2026-11-24T18:30:00Z" }, "UTC", "UTC")).toBe(
      "Once · Nov 24, 2026 at 6:30 PM",
    );
    expect(openCodeTriggerLabel({ type: "at", at: "2026-11-24T09:00" }, "UTC", "UTC")).toBe(
      "Once · 2026-11-24 09:00",
    );
    expect(
      openCodeTriggerLabel({ type: "event", server: "github", event: "push" }, "UTC", "UTC"),
    ).toBe("When github sends push");
  });
});

describe("describeCron", () => {
  it.each([
    ["* * * * *", "Every minute"],
    ["*/15 * * * *", "Every 15 minutes"],
    ["0 * * * *", "Hourly"],
    ["30 * * * *", "Hourly at :30"],
    ["0 */2 * * *", "Every 2 hours"],
    ["30 14 * * *", "Daily at 2:30 PM"],
    ["0 0 * * 0", "Sundays at 12:00 AM"],
    ["0 8 1 * *", "Monthly on day 1 at 8:00 AM"],
    ["0 8 * 1 *", null],
    ["not a cron", null],
  ])("%s", (expression, expected) => {
    expect(describeCron(expression)).toBe(expected);
  });
});

describe("openCodeActionSummary", () => {
  it("names the target of each action", () => {
    expect(openCodeActionSummary(automation().action)).toEqual({
      type: "session",
      sessionID: "ses_1",
      prompt: "Look at CI",
    });
    expect(
      openCodeActionSummary({ type: "prompt", prompt: "Triage", to: { subagent: "general" } }),
    ).toEqual({ type: "subagent", agent: "general", prompt: "Triage" });
    expect(openCodeActionSummary({ type: "code", code: "return" })).toEqual({ type: "code" });
    expect(openCodeActionSummary({ type: "shell", command: "make check" })).toEqual({
      type: "shell",
      command: "make check",
    });
  });
});

describe("openCodeRunLabel", () => {
  const now = Date.parse("2026-11-24T12:00:00Z");
  it("shows the next run only while active and the last outcome when it was not a plain run", () => {
    expect(
      openCodeRunLabel(
        automation({
          nextDueAt: now + 3_600_000,
          lastRunAt: now - 7_200_000,
          lastOutcome: "failed",
        }),
        now,
      ),
    ).toMatch(/^Next run in \d+ \w+ · Last ran \d+ \w+ ago · failed$/);
    expect(openCodeRunLabel(automation({ status: "paused", nextDueAt: now + 1 }), now)).toBeNull();
    expect(
      openCodeRunLabel(automation({ lastRunAt: now - 60_000, lastOutcome: "fired" }), now),
    ).toMatch(/^Last ran \d+ \w+ ago$/);
  });
});
