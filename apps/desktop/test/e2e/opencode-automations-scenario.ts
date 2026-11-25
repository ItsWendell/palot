import { join } from "node:path";
import { expect } from "@playwright/test";
import type { Scenario } from "./scenarios.ts";

const PROMPT = "Return the scripted setup response.";

/**
 * OpenCode's own automations (`experimental.automations`) appear read-only on the Scheduled
 * page beside Palot's scheduled tasks, with Pause/Resume and an in-place Delete confirm.
 */
export const openCodeAutomationsScenario: Scenario = {
  description:
    "list OpenCode automations on the Scheduled page, link their task, pause, resume and delete one",
  prompt: PROMPT,
  expectedModelCalls: 1,
  openCodeConfig: { experimental: { automations: true } },
  arrange(llm) {
    llm.text("Automation fixture ready");
  },
  async assert(page, { client, session, runRoot }) {
    await page.getByText("Automation fixture ready", { exact: true }).waitFor();
    const directory = session.location.directory;
    await client.experimental.automation.create({
      sessionID: session.id,
      name: "Weekday CI check",
      trigger: { type: "cron", cron: "0 9 * * 1-5" },
      action: {
        type: "prompt",
        prompt: "Check CI on main and report failures.",
        to: { session: session.id },
      },
    });
    const nightly = await client.experimental.automation.create({
      sessionID: session.id,
      name: "Nightly cleanup script",
      trigger: { type: "every", every: "6 hours" },
      action: { type: "code", code: "return;" },
    });
    await client.experimental.automation.pause({ automationID: nightly.id });

    await page.evaluate(() => {
      (globalThis as unknown as { location: { hash: string } }).location.hash = "#/scheduled";
    });
    const section = page.getByRole("region", { name: "OpenCode automations" });
    await section.waitFor({ timeout: 20_000 });
    const weekday = section.getByRole("listitem").filter({ hasText: "Weekday CI check" });
    await expect(weekday).toContainText("Weekdays at 9:00 AM");
    await expect(weekday).toContainText("Prompts");
    await expect(weekday).toContainText(/Next run in/);
    const nightlyRow = section.getByRole("listitem").filter({ hasText: "Nightly cleanup script" });
    await expect(nightlyRow).toContainText("Paused");
    await expect(nightlyRow).toContainText("Every 6 hours");
    await expect(nightlyRow).toContainText("Runs a script, no model");
    await page.getByRole("main", { name: "Scheduled tasks" }).screenshot({
      path: join(runRoot, "opencode-automations.png"),
    });

    await weekday.hover();
    await weekday.getByRole("button", { name: "Pause Weekday CI check" }).click();
    await expect(weekday).toContainText("Paused");
    await weekday.getByRole("button", { name: "Resume Weekday CI check" }).click();
    await expect(weekday.getByRole("button", { name: "Pause Weekday CI check" })).toBeVisible();

    await nightlyRow.hover();
    await nightlyRow.getByRole("button", { name: "Delete Nightly cleanup script" }).click();
    await nightlyRow.getByRole("button", { name: "Confirm delete Nightly cleanup script" }).click();
    await expect(nightlyRow).toHaveCount(0);
    expect(
      (await client.experimental.automation.list({ directory })).map((item) => item.name),
    ).toEqual(["Weekday CI check"]);

    await weekday
      .getByRole("button", { name: /^(?!Pause|Delete|Resume)/ })
      .first()
      .click();
    await page.getByLabel("Current task").waitFor();
  },
};
