import { expect, type Page } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Scenario } from "./scenarios.ts";

const PR_URL = "https://github.com/palot-e2e/fixture/pull/7";

async function create(
  page: Page,
  name: string,
  type: "Local webhook" | "GitHub pull request",
  prompt: string,
) {
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await page.getByLabel("Scheduled task title").fill(name);
  await page.getByLabel("Scheduled task prompt").fill(prompt);
  await page.getByRole("combobox", { name: "Run destination", exact: true }).click();
  await page.getByRole("option", { name: "Existing task", exact: true }).click();
  await page.getByRole("combobox", { name: "Trigger type", exact: true }).click();
  await page.getByRole("option", { name: type, exact: true }).click();
  if (type === "GitHub pull request") {
    await page.getByLabel("PR repository filter").fill("palot-e2e/fixture");
    await page.getByLabel("PR branch filter").fill("feature");
  }
  await page
    .getByLabel("Scheduled task editor")
    .getByRole("button", { name: "Create", exact: true })
    .click();
  await expect(page.getByRole("button", { name: "Save changes", exact: true })).toBeVisible();
}

export const eventAutomationsScenario: Scenario = {
  description:
    "create a webhook task in the UI, dispatch a payload and a fake linked-PR CI failure, and dedupe both",
  prompt: "",
  expectedModelCalls: 2,
  arrange(llm) {
    llm.text("Webhook event handled.");
    llm.text("CI failure event handled.");
  },
  async prepareProject({ runRoot }) {
    const state = join(runRoot, "github-state.json");
    await writeFile(state, JSON.stringify({ created: true, checkStatus: "PENDING" }), {
      mode: 0o600,
    });
    process.env.PALOT_TEST_GITHUB_STATE = state;
    process.env.GH_TOKEN = "palot-e2e-dummy-token";
    process.env.GITHUB_TOKEN = "palot-e2e-dummy-token";
    process.env.GH_HOST = "github.com";
    const fixture = fileURLToPath(new URL("./fixtures/github.cjs", import.meta.url));
    process.env.NODE_OPTIONS = `${process.env.NODE_OPTIONS ?? ""} --require=${JSON.stringify(fixture)}`;
  },
  async run(page, { client, session, runRoot }) {
    await page.getByRole("button", { name: "Scheduled", exact: true }).click();
    await create(
      page,
      "Webhook fixture",
      "Local webhook",
      "Inspect {{payload.reason}} for build {{payload.build}}.",
    );
    const snapshot = () =>
      page.evaluate(async () => {
        const { profileID } = await window.palot.runtimeStatus();
        return window.palot.loadAutomations(profileID);
      });
    const before = await snapshot();
    const automation = before.automations.find((item) => item.name === "Webhook fixture")!;
    if (automation.trigger.type !== "webhook") throw new Error("Webhook trigger was not saved");
    const endpoint = `${before.webhookAddress}/hooks/${automation.id}/${automation.trigger.token}`;
    const post = () =>
      fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": "fixture-delivery" },
        body: JSON.stringify({ reason: "E2E payload arrived", build: 42 }),
      });
    expect((await post()).status).toBe(202);
    await expect
      .poll(
        async () =>
          (await snapshot()).runs.find((run) => run.automationID === automation.id)?.state,
      )
      .toBe("succeeded");
    expect(await (await post()).json()).toEqual({ result: "duplicate" });
    const messages = await client.message.list({ sessionID: session.id, type: "user", limit: 20 });
    expect(
      messages.data.some(
        (message) =>
          message.type === "user" &&
          message.text.includes('Inspect "E2E payload arrived" for build 42.'),
      ),
    ).toBe(true);
    await page.screenshot({ path: join(runRoot, "event-webhook.png") });

    await page.getByRole("button", { name: "Close editor", exact: true }).click();
    await create(
      page,
      "PR failure fixture",
      "GitHub pull request",
      "Inspect {{payload.event}} on {{payload.repository}}.",
    );
    const refresh = () =>
      page.evaluate(async (sessionID) => {
        const { profileID } = await window.palot.runtimeStatus();
        const result = await window.palot.sourceControl.refreshPullRequests({
          profileID,
          sessionID,
        });
        if (!result.ok) throw new Error(result.error.message);
      }, session.id);
    await page.evaluate(
      async ({ sessionID, url }) => {
        const { profileID } = await window.palot.runtimeStatus();
        const result = await window.palot.sourceControl.linkPullRequest({
          profileID,
          sessionID,
          url,
        });
        if (!result.ok) throw new Error(result.error.message);
      },
      { sessionID: session.id, url: PR_URL },
    );
    await refresh(); // Baseline, not old CI news.
    const pr = (await snapshot()).automations.find((item) => item.name === "PR failure fixture")!;
    expect((await snapshot()).runs.filter((run) => run.automationID === pr.id)).toHaveLength(0);
    await writeFile(
      join(runRoot, "github-state.json"),
      JSON.stringify({ created: true, checkStatus: "FAILURE" }),
      { mode: 0o600 },
    );
    await refresh();
    await expect
      .poll(async () => (await snapshot()).runs.find((run) => run.automationID === pr.id)?.state)
      .toBe("succeeded");
    await refresh();
    expect((await snapshot()).runs.filter((run) => run.automationID === pr.id)).toHaveLength(1);
    const after = await client.message.list({ sessionID: session.id, type: "user", limit: 20 });
    expect(
      after.data.some(
        (message) =>
          message.type === "user" &&
          message.text.includes('Inspect "checks-failed" on "palot-e2e/fixture".'),
      ),
    ).toBe(true);
    await page.screenshot({ path: join(runRoot, "event-pr-failure.png") });
    await writeFile(
      join(runRoot, "event-automations.json"),
      JSON.stringify({ webhookRuns: 1, prRuns: 1, payloadInPrompt: true, deduped: true }, null, 2),
      { mode: 0o600 },
    );
  },
  async assert(_page, { llm }) {
    expect(llm.scriptedCalls()).toBe(2);
  },
};
