import { expect } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Scenario } from "./scenarios.ts";
import { isTitleRequest } from "./test-llm-server.ts";

const NAME = "Check CI";
const PROMPT = "Check whether CI passed.";
const READY = "Palot tool capability probe complete.";
const FINAL = "CI check scheduled and tasks listed.";

export const palotToolsScenario: Scenario = {
  description:
    "approve an agent-scheduled task through client-hosted MCP, list tasks without approval, and verify the Scheduled page",
  prompt: "Schedule a CI check tomorrow at 09:00, then list my tasks.",
  expectedModelCalls: 4,
  arrange(llm) {
    // Inspect a real model request before choosing direct MCP or Code Mode invocation.
    llm.text(READY);
  },
  async run(page, { client, session, llm, runRoot }) {
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    const agentTools = page.getByRole("switch", { name: "Palot tools for agents", exact: true });
    await expect(agentTools).toBeEnabled();
    await agentTools.check();
    await expect(agentTools).toBeChecked();
    await page.evaluate((sessionID) => {
      location.hash = `#/sessions/${sessionID}`;
    }, session.id);
    await page.getByLabel("Current task").waitFor();
    await client.session.prompt({ sessionID: session.id, text: "Inspect the available tools." });
    await client.session.wait({ sessionID: session.id });
    await expect(page.getByText(READY, { exact: true })).toBeVisible();
    // The API-created fixture has no preset rules. Change presets through the UI:
    // reselecting the already-selected Defaults option would be a no-op.
    await page.getByRole("button", { name: "Approvals: Defaults", exact: true }).click();
    await page.getByRole("option", { name: /^Full access\b/ }).click();
    await page
      .getByRole("alertdialog", { name: "Enable Full access?" })
      .getByRole("button", { name: "Enable Full access", exact: true })
      .click();
    await page.getByRole("button", { name: "Approvals: Full access", exact: true }).click();
    await page.getByRole("option", { name: /^Defaults\b/ }).click();
    await expect
      .poll(async () => (await client.session.get({ sessionID: session.id })).permissions)
      .toContainEqual({ action: "palot_schedule_task", resource: "*", effect: "ask" });
    const probe = llm.requests.find((request) => !isTitleRequest(request.body));
    if (!probe) throw new Error("Palot tool probe did not reach the scripted model");
    const tools = probe.body.tools as Array<{ name?: string; function?: { name: string } }>;
    const names = tools.map((tool) => tool.function?.name ?? tool.name);
    const direct = names.includes("palot_schedule_task");
    if (!direct) expect(names).toContain("execute");
    console.log(`Palot model tools (${direct ? "direct MCP" : "execute"}):`, names);
    await writeFile(
      join(runRoot, "palot-tools-catalog.json"),
      JSON.stringify({ invocation: direct ? "direct" : "execute", tools }, null, 2),
      { mode: 0o600 },
    );

    const schedule = await page.evaluate(() => {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(9, 0, 0, 0);
      const pad = (value: number) => String(value).padStart(2, "0");
      return {
        at: `${tomorrow.getFullYear()}-${pad(tomorrow.getMonth() + 1)}-${pad(tomorrow.getDate())}T09:00`,
        instant: tomorrow.getTime(),
      };
    });
    const args = { name: NAME, prompt: PROMPT, at: schedule.at };
    llm.tool(
      direct ? "palot_schedule_task" : "execute",
      direct ? args : { code: `return await tools.palot.schedule_task(${JSON.stringify(args)})` },
    );
    llm.tool(
      direct ? "palot_list_tasks" : "execute",
      direct ? {} : { code: "return await tools.palot.list_tasks({})" },
    );
    llm.text(FINAL);
    await client.session.prompt({
      sessionID: session.id,
      text: `Schedule a CI check at ${schedule.at}, then list my tasks.`,
    });
    await expect
      .poll(async () => (await client.permission.list({ sessionID: session.id })).length)
      .toBe(1);
    const request = (await client.permission.list({ sessionID: session.id }))[0]!;
    expect(request.action).toBe("palot_schedule_task");
    const card = page.locator(`[data-palot-request-id="${request.id}"]`);
    await expect(card.getByText("Schedule a task", { exact: true })).toBeVisible();
    await expect(card.getByText(NAME, { exact: true })).toBeVisible();
    await expect(card.locator("details")).not.toHaveAttribute("open");
    await expect(card.locator("summary")).toHaveText("Details");
    await expect(card.getByRole("button", { name: "Deny", exact: true })).toBeVisible();
    // Scheduling can be allowed per project; this scenario approves once.
    await expect(card.getByRole("button", { name: "Always allow for this project" })).toBeVisible();
    expect(
      await page.evaluate(async () => {
        const { profileID } = await window.palot.runtimeStatus();
        return (await window.palot.loadAutomations(profileID)).automations;
      }),
    ).toHaveLength(0);
    await page.screenshot({ path: join(runRoot, "palot-tools-approval.png") });
    await card.getByRole("button", { name: "Allow once", exact: true }).click();

    // No further replies: if the read tool asks for approval, continuation never reaches FINAL.
    await expect(page.getByText(FINAL, { exact: true })).toBeVisible({ timeout: 30_000 });
    await client.session.wait({ sessionID: session.id });
    expect(await client.permission.list({ sessionID: session.id })).toHaveLength(0);
    await expect(page.locator('[data-palot-request-type="permission"]')).toHaveCount(0);
    const calls = llm.requests.filter((request) => !isTitleRequest(request.body));
    expect(calls).toHaveLength(4);
    const scheduleResults = (
      calls[2]!.body.messages as Array<{ role: string; content: unknown }>
    ).filter((message) => message.role === "tool");
    const listResults = (calls[3]!.body.messages as Array<{ role: string; content: unknown }>)
      .filter((message) => message.role === "tool")
      .at(-1);
    expect(JSON.stringify(scheduleResults)).toContain("scheduled");
    expect(JSON.stringify(listResults)).toContain("tasks");
    expect(JSON.stringify(listResults)).toContain(session.id);
    await writeFile(join(runRoot, "llm-requests.json"), JSON.stringify(llm.requests, null, 2), {
      mode: 0o600,
    });

    const automations = await page.evaluate(async () => {
      const { profileID } = await window.palot.runtimeStatus();
      return (await window.palot.loadAutomations(profileID)).automations;
    });
    expect(automations).toHaveLength(1);
    expect(automations[0]).toMatchObject({
      name: NAME,
      status: "active",
      action: { prompt: PROMPT },
      destination: { type: "session", sessionID: session.id },
      trigger: { type: "once", at: schedule.instant },
    });
    await page.getByRole("button", { name: "Scheduled", exact: true }).click();
  },
  async assert(page, { llm, runRoot }) {
    await expect(page.getByRole("heading", { name: "Scheduled tasks", exact: true })).toBeVisible();
    await expect(
      page.getByRole("main", { name: "Scheduled tasks" }).getByText(NAME, { exact: true }),
    ).toBeVisible();
    expect(llm.scriptedCalls()).toBe(4);
    await page.screenshot({ path: join(runRoot, "palot-tools-scheduled.png") });
  },
};
