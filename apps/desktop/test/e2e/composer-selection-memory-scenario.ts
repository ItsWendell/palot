import type { ModelRef, OpenCodeClient } from "@opencode/client";
import { expect, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Scenario } from "./scenarios.ts";
import { isTitleRequest } from "./test-llm-server.ts";

const ALPHA = "memory-alpha";
const BETA = "memory-beta";
const MODEL = "test-model";
const OTHER_MODEL = "memory-alternate";
const PROMPT = "Confirm the composer selection memory fixture.";
const RESPONSE = "Composer selection memory fixture complete.";
const AUTOMATIC_PROMPT = "Use the configured automatic agent and reasoning for this fixture.";
const AUTOMATIC_RESPONSE = "Automatic agent defaults preserved.";
const ALPHA_SYSTEM = "You are the memory-alpha deterministic fixture agent.";
const BETA_SYSTEM = "You are the memory-beta deterministic fixture agent.";
const ref = (id: string, variant?: string): ModelRef => ({
  providerID: "test",
  id,
  ...(variant ? { variant } : {}),
});

export const composerSelectionMemoryScenario: Scenario = {
  description:
    "remember explicit agent, model, and reasoning choices without rewriting opened tasks",
  prompt: PROMPT,
  expectedModelCalls: 2,
  arrange(llm) {
    llm.text(AUTOMATIC_RESPONSE);
    llm.text(RESPONSE);
  },
  async prepareProject({ projectDirectory }) {
    await promisify(execFile)(
      "git",
      [
        "-c",
        "user.name=Palot E2E",
        "-c",
        "user.email=palot-e2e@example.invalid",
        "-c",
        "commit.gpgsign=false",
        "commit",
        "--allow-empty",
        "--quiet",
        "-m",
        "Seed selection memory repository",
      ],
      { cwd: projectDirectory },
    );
  },
  async prepare(home) {
    const directory = join(home, ".config", "opencode");
    await mkdir(directory, { recursive: true });
    await writeFile(
      join(directory, "opencode.json"),
      JSON.stringify({
        $schema: "https://opencode.ai/config.json",
        default_agent: ALPHA,
        agents: {
          [ALPHA]: {
            mode: "primary",
            model: `test/${MODEL}#low`,
            system: ALPHA_SYSTEM,
          },
          [BETA]: {
            mode: "primary",
            model: `test/${OTHER_MODEL}#high`,
            system: BETA_SYSTEM,
          },
        },
        // Extend the harness's test provider, retaining its loopback URL and dummy key.
        // V2 custom variants are an array of request overlays, not a keyed object.
        providers: {
          test: {
            models: Object.fromEntries(
              [MODEL, OTHER_MODEL].map((id) => [
                id,
                {
                  name: id === MODEL ? "Test Model" : "Memory Alternate",
                  limit: { context: 100_000, output: 10_000 },
                  variants: [
                    { id: "low", body: { reasoning_effort: "low" } },
                    { id: "high", body: { reasoning_effort: "high" } },
                  ],
                },
              ]),
            ),
          },
        },
      }),
      { mode: 0o600 },
    );
  },
  async seed(client, { projectDirectory }) {
    const location = { directory: projectDirectory };
    for (const id of [MODEL, OTHER_MODEL]) {
      await expect
        .poll(
          async () => {
            const model = (await client.model.list({ location })).data.find(
              (entry) => entry.providerID === "test" && entry.id === id,
            );
            return model?.variants.map((variant) => variant.id).sort();
          },
          { timeout: 30_000, message: `Wait for deterministic model test/${id} variants` },
        )
        .toEqual(["high", "low"]);
    }
    for (const id of [ALPHA, BETA]) {
      await expect
        .poll(
          async () => (await client.agent.list({ location })).data.find((agent) => agent.id === id),
          { timeout: 30_000, message: `Wait for deterministic agent ${id}` },
        )
        .toMatchObject({ mode: "primary" });
    }
  },
  async run(page, { client, session, projectDirectory, runRoot, llm }) {
    const projectID = await fixtureProjectID(client, projectDirectory);
    const agents = (await client.agent.list({ location: { directory: projectDirectory } })).data;
    const alpha = agents.find((agent) => agent.id === ALPHA)!.name;
    const beta = agents.find((agent) => agent.id === BETA)!.name;

    // An untouched draft leaves automatic model selection to OpenCode rather than pinning the UI fallback.
    await openNewTask(page, projectID);
    await expect(
      page.getByRole("button", { name: "Agent: Default agent", exact: true }),
    ).toBeVisible();
    await useCurrentCheckout(page);
    await page.getByRole("textbox", { name: "Message Palot" }).fill(AUTOMATIC_PROMPT);
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    await expect(page.getByText(AUTOMATIC_RESPONSE, { exact: true })).toBeVisible();
    const automaticID = new URL(page.url()).hash.slice("#/sessions/".length);
    expect((await client.session.get({ sessionID: automaticID })).model).toBeUndefined();
    const automaticRequests = llm.requests.filter(({ body }) => !isTitleRequest(body));
    expect(automaticRequests).toHaveLength(1);
    expect(automaticRequests[0]!.body.model).toBe(MODEL);
    expect(automaticRequests[0]!.body.reasoning_effort).toBeUndefined();
    expect(JSON.stringify(automaticRequests[0]!.body)).toContain(ALPHA_SYSTEM);
    await openNewTask(page, projectID);
    await expect(
      page.getByRole("button", { name: "Agent: Default agent", exact: true }),
    ).toBeVisible();
    await navigate(page, `#/sessions/${session.id}`);

    // Successful live choices seed durable memory, independently for each model and agent.
    await selectAgent(page, alpha);
    await expectControls(page, alpha, "Test Model", "Low");
    await selectReasoning(page, "High");
    await expectSelection(client, session.id, ALPHA, ref(MODEL, "high"));
    await selectModel(page, OTHER_MODEL, "Memory Alternate");
    await selectReasoning(page, "Low");
    await expectSelection(client, session.id, ALPHA, ref(OTHER_MODEL, "low"));
    await selectModel(page, MODEL, "Test Model");
    await expectControls(page, alpha, "Test Model", "High");
    await selectAgent(page, beta);
    await expectControls(page, beta, "Memory Alternate", "High");
    await selectReasoning(page, "Auto");
    await expectSelection(client, session.id, BETA, ref(OTHER_MODEL));
    await selectAgent(page, alpha);
    await expectSelection(client, session.id, ALPHA, ref(MODEL, "high"));

    // Opening server-owned state must neither rewrite that task nor replace explicit memory.
    const other = await client.session.create({ location: { directory: projectDirectory } });
    await client.session.switchAgent({ sessionID: other.id, agent: BETA });
    await client.session.switchModel({ sessionID: other.id, model: ref(OTHER_MODEL, "low") });
    await navigate(page, `#/sessions/${other.id}`);
    await expectControls(page, beta, "Memory Alternate", "Low");
    await openNewTask(page, projectID);
    await expectControls(page, alpha, "Test Model", "High");
    await page.reload({ waitUntil: "domcontentloaded" });
    await expectControls(page, alpha, "Test Model", "High");
    await expectSelection(client, other.id, BETA, ref(OTHER_MODEL, "low"));

    // Draft switches restore both per-agent memory and explicit Auto over a configured variant.
    await selectAgent(page, beta);
    await expectControls(page, beta, "Memory Alternate", "Auto");
    await selectAgent(page, alpha);
    await selectModel(page, OTHER_MODEL, "Memory Alternate");
    await expectControls(page, alpha, "Memory Alternate", "Low");
    await selectAgent(page, beta);
    await expectControls(page, beta, "Memory Alternate", "Auto");
    await captureSelectors(page, runRoot);
    expect(llm.scriptedCalls()).toBe(1);

    // Explicit choices also reach the local scripted LLM through actual new-task creation.
    await useCurrentCheckout(page);
    await page.getByRole("textbox", { name: "Message Palot" }).fill(PROMPT);
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    await expect.poll(() => new URL(page.url()).hash).toMatch(/^#\/sessions\//);
    const createdID = new URL(page.url()).hash.slice("#/sessions/".length);
    expect(createdID).not.toBe(session.id);
    expect(createdID).not.toBe(other.id);
    await expectSelection(client, createdID, BETA, ref(OTHER_MODEL));
    await client.session.wait({ sessionID: createdID });
    await expect(page.getByText(RESPONSE, { exact: true })).toBeVisible();
    const requests = llm.requests.filter(({ body }) => !isTitleRequest(body));
    expect(requests).toHaveLength(2);
    expect(requests[1]!.body.model).toBe(OTHER_MODEL);
    expect(JSON.stringify(requests[1]!.body)).toContain(BETA_SYSTEM);
    expect(requests[1]!.body.reasoning_effort).toBeUndefined();
    const messages = (await client.message.list({ sessionID: createdID })).data;
    expect(
      messages.filter((message) => message.type === "user").map((message) => message.text),
    ).toEqual([PROMPT]);
  },
  async assert(page, { client, projectDirectory }) {
    // A successfully created task commits draft selections for the next task and reload.
    await openNewTask(page, await fixtureProjectID(client, projectDirectory));
    await page.reload({ waitUntil: "domcontentloaded" });
    const beta = (await client.agent.list({ location: { directory: projectDirectory } })).data.find(
      (agent) => agent.id === BETA,
    )!.name;
    await expectControls(page, beta, "Memory Alternate", "Auto");
  },
};

async function selectAgent(page: Page, name: string) {
  await page.getByRole("button", { name: /^Agent:/ }).click();
  await page.getByRole("combobox", { name: "Choose agent", exact: true }).fill(name);
  await page.getByRole("option").filter({ hasText: name }).click();
  await expect(page.getByRole("button", { name: `Agent: ${name}`, exact: true })).toBeEnabled();
}

async function selectModel(page: Page, id: string, name: string) {
  await page.getByRole("button", { name: /^Model:/ }).click();
  await page.getByRole("combobox", { name: "Choose model", exact: true }).fill(id);
  await page
    .getByRole("listbox", { name: "Suggestions", exact: true })
    .getByRole("option")
    .filter({ hasText: name })
    .click();
  await expect(page.getByRole("button", { name: /^Model:/ })).toContainText(name);
}

async function selectReasoning(page: Page, name: string) {
  await page.getByRole("button", { name: /^Reasoning:/ }).click();
  await page.getByRole("button", { name, exact: true }).click();
  await expect(page.getByRole("button", { name: `Reasoning: ${name}`, exact: true })).toBeEnabled();
}

async function expectControls(page: Page, agent: string, model: string, reasoning: string) {
  await expect(page.getByRole("button", { name: `Agent: ${agent}`, exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: /^Model:/ })).toContainText(model);
  await expect(
    page.getByRole("button", { name: `Reasoning: ${reasoning}`, exact: true }),
  ).toBeEnabled();
}

async function expectSelection(
  client: OpenCodeClient,
  sessionID: string,
  agent: string,
  model: ModelRef,
) {
  await expect
    .poll(async () => {
      const selected = await client.session.get({ sessionID });
      return { agent: selected.agent, model: selected.model };
    })
    // The public session projection canonicalizes omitted variants to "default".
    .toEqual({ agent, model: { ...model, variant: model.variant ?? "default" } });
}

async function navigate(page: Page, hash: string) {
  await page.evaluate((next) => {
    location.hash = next;
  }, hash);
  await expect(page.getByRole("textbox", { name: "Message Palot" })).toBeVisible();
}

async function openNewTask(page: Page, projectID: string) {
  await navigate(page, `#/new?projectID=${encodeURIComponent(projectID)}`);
  await expect(page.getByRole("main", { name: "New task", exact: true })).toBeVisible();
}

async function fixtureProjectID(client: OpenCodeClient, directory: string): Promise<string> {
  const project = (await client.project.list()).find((project) => project.canonical === directory);
  if (!project) throw new Error("The isolated selection-memory project was not registered");
  return project.id;
}

async function useCurrentCheckout(page: Page) {
  await page.getByRole("button", { name: /^Work in:/ }).click();
  await page.getByRole("button", { name: /^Current checkout/ }).click();
}

async function captureSelectors(page: Page, runRoot: string) {
  const viewport = page.viewportSize();
  try {
    await page.setViewportSize({ width: 920, height: 640 });
    for (const name of [/^Agent:/, /^Model:/, /^Reasoning:/]) {
      await expect(page.getByRole("button", { name })).toBeInViewport();
    }
    await page.getByRole("main", { name: "New task", exact: true }).screenshot({
      path: join(runRoot, "composer-selection-memory-920x640.png"),
    });
  } finally {
    if (viewport) await page.setViewportSize(viewport);
  }
}
