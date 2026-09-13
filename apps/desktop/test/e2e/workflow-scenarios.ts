import { expect, type Page } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Scenario } from "./scenarios.ts";

const ORIGINAL_DRAFT = "Keep this unsent draft for the original task.";
const OTHER_DRAFT = "This separate draft belongs to the other task.";
const QUEUED_INPUT = "The queued input before editing.";
const EDITED_INPUT = "The edited queued input after switching tasks.";
const EDIT_NOTICE = "Editing a canceled pending message. Resubmitting adds it to the end.";
const SHARED_MODEL = "Workflow Shared Model";
const PLUGIN_FAILURE = "Workflow plugin activation failed";
const COMPACTION_PROMPT = "Hold the active turn until the compaction workflow gate is released.";
const COMPACTION_STEERS = [
  "Preserve this exact instruction: use the identifier STEER_ALPHA_19151, including its underscores.",
  "Preserve this exact instruction: report STEER_BETA_19151 after STEER_ALPHA_19151, in that order.",
] as const;
const COMPACTION_SUMMARY =
  "## Objective\n- The active shell gate completed. Pending work is not summarized.";
const COMPACTION_RESULT =
  "STEER_ALPHA_19151 then STEER_BETA_19151. Both pending instructions are complete.";
const COMPACTION_GATE_RESULT = "WORKFLOW_COMPACTION_GATE_COMPLETED";

type WorkflowScenarioName =
  | "compaction-pending-steer"
  | "composer-draft-switch"
  | "composer-pending-edit-switch"
  | "model-provider-identity"
  | "settings-plugin-failure";

export const workflowScenarios: Record<WorkflowScenarioName, Scenario> = {
  "compaction-pending-steer": {
    description:
      "compact before earlier pending steers and preserve their exact instructions after the summary",
    prompt: COMPACTION_PROMPT,
    expectedModelCalls: 3,
    arrange(llm) {
      // beta-19151 / upstream #47340: the safe boundary follows tool completion.
      // Use one ordered script, not prompt-marker routes: compaction rewrites history.
      llm.tool("shell", {
        command:
          "printf ready > .workflow-compaction-ready; while [ ! -f .workflow-compaction-release ]; do sleep 0.05; done; " +
          `printf '${COMPACTION_GATE_RESULT}\\n'`,
        timeout: 120_000,
      });
      llm.text(COMPACTION_SUMMARY);
      llm.text(COMPACTION_RESULT);
    },
    async run(page, { client, session, projectDirectory, runRoot, llm }) {
      try {
        await client.session.prompt({ sessionID: session.id, text: COMPACTION_PROMPT });
        await expect
          .poll(
            () =>
              readFile(join(projectDirectory, ".workflow-compaction-ready"), "utf8").catch(
                () => "",
              ),
            { timeout: 30_000 },
          )
          .toBe("ready");
        const steerIDs: string[] = [];
        // Admission order matters: both steers must precede the default compact request.
        for (const text of COMPACTION_STEERS) {
          const steer = await client.session.prompt({
            sessionID: session.id,
            text,
            delivery: "steer",
          });
          steerIDs.push(steer.id);
        }
        const pendingRail = page.getByRole("region", { name: "Pending messages", exact: true });
        await expect(pendingRail).toBeVisible();
        for (const text of COMPACTION_STEERS) {
          const pending = pendingRail.getByRole("region", {
            name: `Pending message actions: ${text}`,
            exact: true,
          });
          await expect(pending).toBeVisible();
          await expect(pending.getByText("Steering", { exact: true })).toBeVisible();
        }
        // Omit delivery deliberately: the official default must prioritize compaction.
        const compact = await client.session.compact({ sessionID: session.id });
        expect(compact.delivery).toBe("steer");
        const inbox = await client.session.inbox.list({ sessionID: session.id });
        expect(inbox).toHaveLength(3);
        expect(inbox).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ id: compact.id, type: "compaction", delivery: "steer" }),
            ...steerIDs.map((id, index) =>
              expect.objectContaining({
                id,
                type: "user",
                delivery: "steer",
                payload: { text: COMPACTION_STEERS[index] },
              }),
            ),
          ]),
        );
        const history = (await client.message.list({ sessionID: session.id })).data;
        expect(
          history.some((message) => message.type === "compaction" || steerIDs.includes(message.id)),
        ).toBe(false);
        expect(llm.requests).toHaveLength(1);
        try {
          await expect(pendingRail).toBeVisible();
          for (const text of COMPACTION_STEERS) {
            await expect(
              pendingRail.getByRole("region", {
                name: `Pending message actions: ${text}`,
                exact: true,
              }),
            ).toBeVisible();
          }
          await page.screenshot({ path: join(runRoot, "compaction-pending-steers.png") });
        } catch (error) {
          // Capture before finally releases the tool. Harness failure artifacts are
          // collected afterward and can otherwise confuse UI loss with delivery.
          const [heldInbox, heldHistory] = await Promise.all([
            client.session.inbox.list({ sessionID: session.id }),
            client.message.list({ sessionID: session.id, order: "asc", limit: 100 }),
          ]);
          await writeFile(
            join(runRoot, "compaction-held-failure.json"),
            JSON.stringify(
              { inbox: heldInbox, history: heldHistory.data, requests: llm.requests },
              null,
              2,
            ),
          );
          await page.screenshot({ path: join(runRoot, "compaction-held-failure.png") });
          throw error;
        }
      } finally {
        await writeFile(join(projectDirectory, ".workflow-compaction-release"), "release\n");
      }
      await client.session.wait({ sessionID: session.id });
    },
    async assert(page, { client, session, llm, runRoot }) {
      const messages = (
        await client.message.list({ sessionID: session.id, order: "asc", limit: 100 })
      ).data;
      const compactions = messages.filter((message) => message.type === "compaction");
      expect(compactions).toHaveLength(1);
      expect(compactions[0]).toMatchObject({
        status: "completed",
        reason: "manual",
        summary: COMPACTION_SUMMARY,
      });
      const compactIndex = messages.findIndex((message) => message.type === "compaction");
      expect(
        messages
          .slice(compactIndex + 1)
          .filter((message) => message.type === "user")
          .map((message) => message.text),
      ).toEqual(COMPACTION_STEERS);
      expect(
        messages.filter((message) => message.type === "user").map((message) => message.text),
      ).toEqual([COMPACTION_PROMPT, ...COMPACTION_STEERS]);
      // Context, not just archival history, must retain each steer as a real user message.
      const context = await client.session.context({ sessionID: session.id });
      expect(
        context.filter((message) => message.type === "compaction" || message.type === "user"),
      ).toEqual([
        compactions[0],
        ...messages.filter(
          (message) =>
            message.type === "user" && COMPACTION_STEERS.some((text) => text === message.text),
        ),
      ]);
      expect(await client.session.inbox.list({ sessionID: session.id })).toHaveLength(0);

      expect(llm.requests).toHaveLength(3);
      const summaryRequest = llm.requests[1]!;
      const continuationRequest = llm.requests[2]!;
      expect(summaryRequest.url).toBe("/v1/chat/completions");
      expect(summaryRequest.body.messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            role: "tool",
            content: expect.stringContaining(COMPACTION_GATE_RESULT),
          }),
        ]),
      );
      for (const text of COMPACTION_STEERS) {
        expect(JSON.stringify(summaryRequest.body)).not.toContain(text);
      }
      expect(JSON.stringify(summaryRequest.body)).not.toContain("STEER_ALPHA_19151");
      expect(JSON.stringify(summaryRequest.body)).not.toContain("STEER_BETA_19151");
      expect(continuationRequest.body.messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ role: "user", content: COMPACTION_STEERS[0] }),
          expect.objectContaining({ role: "user", content: COMPACTION_STEERS[1] }),
        ]),
      );
      const continuation = JSON.stringify(continuationRequest.body);
      expect(continuation).toContain(JSON.stringify(COMPACTION_SUMMARY).slice(1, -1));
      expect(continuation.indexOf(COMPACTION_STEERS[0])).toBeLessThan(
        continuation.indexOf(COMPACTION_STEERS[1]),
      );

      await expect(page.getByRole("region", { name: "Pending messages", exact: true })).toHaveCount(
        0,
      );
      const completed = page.getByRole("button", { name: "Compaction completed", exact: true });
      await expect(completed).toBeVisible();
      await expect(page.getByText("Compaction completed", { exact: true })).toHaveCount(1);
      await completed.click();
      await expect(page.getByText(/^Compaction request tokens:/)).toBeVisible();
      await expect(
        page.getByText("The active shell gate completed. Pending work is not summarized.", {
          exact: true,
        }),
      ).toBeVisible();
      await expect(page.getByText(COMPACTION_RESULT, { exact: true })).toBeVisible();
      for (const text of COMPACTION_STEERS)
        await expect(page.getByText(text, { exact: true })).toBeVisible();
      // Read both positions in one frame: scroll restoration can move the viewport
      // between separate boundingBox calls after expanding the summary.
      await expect
        .poll(() =>
          completed
            .or(page.getByText(COMPACTION_STEERS[0], { exact: true }))
            .evaluateAll((elements, steerText) => {
              const steer = elements.find((element) => element.textContent === steerText);
              const summary = elements.find((element) => element !== steer);
              return !!(
                steer &&
                summary &&
                summary.getBoundingClientRect().top < steer.getBoundingClientRect().top
              );
            }, COMPACTION_STEERS[0]),
        )
        .toBe(true);
      await page.screenshot({ path: join(runRoot, "compaction-steers-completed.png") });
    },
  },
  "settings-plugin-failure": {
    description: "show a real failed plugin without blocking configuration or local settings",
    prompt: "",
    expectedModelCalls: 0,
    arrange() {},
    async prepare(home) {
      const configDirectory = join(home, ".config", "opencode");
      const pluginDirectory = join(home, "workflow-failed-plugin");
      await mkdir(configDirectory, { recursive: true });
      await mkdir(pluginDirectory, { recursive: true });
      await writeFile(
        join(pluginDirectory, "package.json"),
        JSON.stringify({
          name: "workflow-failed-plugin",
          type: "module",
          exports: "./index.mjs",
        }),
      );
      await writeFile(
        join(pluginDirectory, "index.mjs"),
        [
          // Published V2 Plugin.define returns this object unchanged. No SDK import is needed.
          "export default {",
          '  id: "workflow.failed-plugin",',
          `  setup() { throw new Error(${JSON.stringify(PLUGIN_FAILURE)}); },`,
          "};",
        ].join("\n"),
      );
      await writeFile(
        join(configDirectory, "opencode.json"),
        JSON.stringify({
          plugins: [pluginDirectory],
        }),
        { mode: 0o600 },
      );
    },
    async seed(client, { projectDirectory }) {
      const location = { directory: projectDirectory };
      // The official wait settles even for failed plugins. Endpoint rejection is
      // covered in opencode-settings.test.ts, not manufactured with browser IPC stubs.
      await client.plugin.awaitActivation({ location });
      const plugins = await client.plugin.list({ location });
      expect(plugins.data).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            state: expect.objectContaining({
              status: "failed",
              error: expect.stringContaining(PLUGIN_FAILURE),
            }),
          }),
        ]),
      );
    },
    async run(page) {
      await openSettings(page);
      await page.getByRole("button", { name: "Tools", exact: true }).click();
      await page.getByRole("heading", { name: "Plugins", level: 2 }).waitFor();
      await expect(page.getByText("Failed", { exact: true })).toBeVisible();
      await page
        .getByRole("group")
        .filter({ has: page.getByText("Failed", { exact: true }) })
        .locator("summary")
        .click();
      await expect(page.getByText(PLUGIN_FAILURE, { exact: false }).last()).toBeVisible();
      await expect(page.getByText("Some settings need attention", { exact: true })).toBeVisible();

      await page.getByRole("button", { name: "Configuration", exact: true }).click();
      await page.getByRole("heading", { name: "Configuration sources", level: 2 }).waitFor();
      await expect(
        page.getByText(/\.config\/opencode\/opencode\.json/, { exact: false }).first(),
      ).toBeVisible();
      await page.getByRole("button", { name: "Appearance", exact: true }).click();
      const fontSize = page.getByRole("combobox", { name: "Interface font size" });
      await fontSize.click();
      await page.getByRole("option", { name: "19px", exact: true }).click();
      await expect(fontSize).toContainText("19px");
    },
    async assert(page, { llm }) {
      await expect(page.getByRole("combobox", { name: "Interface font size" })).toContainText(
        "19px",
      );
      await page.getByRole("button", { name: "Back to tasks", exact: true }).click();
      await expect(page.getByRole("textbox", { name: "Message Palot" })).toBeVisible();
      expect(llm.requests).toHaveLength(0);
    },
  },
  "composer-draft-switch": {
    description: "retain independent unsent drafts when switching between real tasks",
    prompt: "",
    expectedModelCalls: 0,
    arrange() {},
    async run(page, { client, session, projectDirectory }) {
      const other = await client.session.create({
        location: { directory: projectDirectory },
        title: "Workflow draft secondary task",
      });
      const composer = page.getByRole("textbox", { name: "Message Palot" });
      await composer.fill(ORIGINAL_DRAFT);
      await switchTask(page, other.id, "Workflow draft secondary task");
      await expect(composer).toHaveValue("");
      await composer.fill(OTHER_DRAFT);
      await switchTask(page, session.id, "Palot E2E: composer-draft-switch");
      await expect(composer).toHaveValue(ORIGINAL_DRAFT);
      await switchTask(page, other.id, "Workflow draft secondary task");
      await expect(composer).toHaveValue(OTHER_DRAFT);
      await switchTask(page, session.id, "Palot E2E: composer-draft-switch");

      for (const sessionID of [session.id, other.id]) {
        const messages = await client.message.list({ sessionID });
        expect(messages.data.filter((message) => message.type === "user")).toHaveLength(0);
        expect(await client.session.inbox.list({ sessionID })).toHaveLength(0);
      }
    },
    async assert(page, { llm }) {
      await expect(page.getByRole("textbox", { name: "Message Palot" })).toHaveValue(
        ORIGINAL_DRAFT,
      );
      expect(llm.requests).toHaveLength(0);
    },
  },
  "composer-pending-edit-switch": {
    description:
      "resubmit an edited queued input after task switching without losing the original draft",
    prompt: "Hold the current turn until the workflow gate is released.",
    expectedModelCalls: 3,
    arrange(llm) {
      // A real tool holds the turn open until UI assertions finish, not for a guessed delay.
      llm.tool("shell", {
        command:
          "printf ready > .workflow-queue-ready; while [ ! -f .workflow-queue-release ]; do sleep 0.05; done",
        timeout: 120_000,
      });
      llm.text("The original workflow turn is complete.");
      llm.text("The edited queued workflow input is complete.");
    },
    async run(page, { client, session, projectDirectory, runRoot }) {
      const other = await client.session.create({
        location: { directory: projectDirectory },
        title: "Workflow queued edit secondary task",
      });
      const composer = page.getByRole("textbox", { name: "Message Palot" });
      try {
        await client.session.prompt({
          sessionID: session.id,
          text: "Hold the current turn until the workflow gate is released.",
        });
        await expect
          .poll(
            () => readFile(join(projectDirectory, ".workflow-queue-ready"), "utf8").catch(() => ""),
            {
              timeout: 30_000,
            },
          )
          .toBe("ready");
        const queued = await client.session.prompt({
          sessionID: session.id,
          text: QUEUED_INPUT,
          delivery: "queue",
        });
        const pending = page.getByRole("region", {
          name: `Pending message actions: ${QUEUED_INPUT}`,
        });
        await pending.waitFor();
        await expect(pending.locator('xpath=ancestor::*[@data-slot="input-group"]')).toHaveCount(0);
        await expect(page.getByRole("region", { name: "Pending messages" })).toBeVisible();
        await page.screenshot({ path: join(runRoot, "pending-queue.png") });
        await composer.fill(ORIGINAL_DRAFT);
        await pending.getByRole("button", { name: "More pending message actions" }).click();
        await page.getByRole("menuitem", { name: "Cancel and edit" }).click();
        await expect(composer).toHaveValue(QUEUED_INPUT);
        await expect(page.getByText(EDIT_NOTICE, { exact: true })).toBeVisible();
        await expect
          .poll(async () =>
            (await client.session.inbox.list({ sessionID: session.id })).some(
              (input) => input.id === queued.id,
            ),
          )
          .toBe(false);
        await composer.fill(EDITED_INPUT);

        await switchTask(page, other.id, "Workflow queued edit secondary task");
        await expect(composer).toHaveValue("");
        await expect(page.getByText(EDIT_NOTICE, { exact: true })).toHaveCount(0);
        await composer.fill(OTHER_DRAFT);
        await switchTask(page, session.id, "Palot E2E: composer-pending-edit-switch");
        await expect(composer).toHaveValue(EDITED_INPUT);
        await expect(page.getByText(EDIT_NOTICE, { exact: true })).toBeVisible();
        await page
          .getByRole("button", { name: "Queue message after current turn", exact: true })
          .click();

        await expect(composer).toHaveValue(ORIGINAL_DRAFT);
        await expect(page.getByText(EDIT_NOTICE, { exact: true })).toHaveCount(0);
        await expect
          .poll(async () =>
            (await client.session.inbox.list({ sessionID: session.id }))
              .filter((input) => input.type === "user")
              .map((input) => ({ text: input.payload.text, delivery: input.delivery })),
          )
          .toEqual([{ text: EDITED_INPUT, delivery: "queue" }]);
        await switchTask(page, other.id, "Workflow queued edit secondary task");
        await expect(composer).toHaveValue(OTHER_DRAFT);
        await switchTask(page, session.id, "Palot E2E: composer-pending-edit-switch");
        await expect(composer).toHaveValue(ORIGINAL_DRAFT);
      } finally {
        await writeFile(join(projectDirectory, ".workflow-queue-release"), "release\n");
      }
      await client.session.wait({ sessionID: session.id });
    },
    async assert(page, { client, session }) {
      await expect(
        page.getByText("The edited queued workflow input is complete.", { exact: true }),
      ).toBeVisible();
      await expect(page.getByRole("textbox", { name: "Message Palot" })).toHaveValue(
        ORIGINAL_DRAFT,
      );
      const messages = (await client.message.list({ sessionID: session.id })).data;
      const userTexts = messages
        .filter((message) => message.type === "user")
        .map((message) => message.text);
      expect(userTexts.filter((text) => text === EDITED_INPUT)).toHaveLength(1);
      expect(userTexts).not.toContain(ORIGINAL_DRAFT);
      expect(await client.session.inbox.list({ sessionID: session.id })).toHaveLength(0);
    },
  },
  "model-provider-identity": {
    description: "select and hide same-ID models independently across two configured providers",
    prompt: "",
    expectedModelCalls: 0,
    arrange() {},
    async prepare(home) {
      const directory = join(home, ".config", "opencode");
      await mkdir(directory, { recursive: true });
      await writeFile(
        join(directory, "opencode.json"),
        JSON.stringify({
          providers: Object.fromEntries(
            ["alpha", "beta"].map((name) => [
              `workflow-${name}`,
              {
                name: name === "alpha" ? "Workflow Alpha" : "Workflow Beta",
                package: "@opencode/ai/providers/openai-compatible",
                // Selection does not invoke a model. Keep accidental calls on loopback.
                settings: { apiKey: "workflow-test-key", baseURL: "http://127.0.0.1:1/v1" },
                models: {
                  "workflow-shared": {
                    name: SHARED_MODEL,
                    limit: { context: 100_000, output: 10_000 },
                  },
                },
              },
            ]),
          ),
        }),
        { mode: 0o600 },
      );
    },
    async seed(client, { projectDirectory }) {
      const location = { directory: projectDirectory };
      // Configured providers are registered during location activation, not session creation.
      await client.plugin.awaitActivation({ location });
      const models = await client.model.list({ location });
      expect(
        models.data
          .filter((model) => model.id === "workflow-shared")
          .map((model) => model.providerID)
          .sort(),
      ).toEqual(["workflow-alpha", "workflow-beta"]);
    },
    async run(page, { client, session }) {
      for (const provider of ["Alpha", "Beta"]) {
        await page.getByRole("button", { name: /^Model:/ }).click();
        await page
          .getByRole("combobox", { name: "Choose model", exact: true })
          .fill("workflow-shared");
        const suggestions = page.getByRole("listbox", { name: "Suggestions", exact: true });
        await expect(suggestions.getByRole("option")).toHaveCount(2);
        await suggestions
          .getByRole("option", { name: new RegExp(`${SHARED_MODEL}.*Workflow ${provider}`) })
          .click();
        await expect
          .poll(async () => (await client.session.get({ sessionID: session.id })).model)
          .toMatchObject({
            id: "workflow-shared",
            providerID: `workflow-${provider.toLowerCase()}`,
          });
      }
      await openSettings(page);
      await page.getByRole("button", { name: "Models", exact: true }).click();
      await page.getByRole("heading", { name: "Models", level: 1 }).waitFor();
      const search = page.getByRole("searchbox", { name: "Search models" });
      await search.fill("workflow-alpha");
      await page.getByRole("switch", { name: `Disable ${SHARED_MODEL}`, exact: true }).click();
      await expect(
        page.getByRole("switch", { name: `Enable ${SHARED_MODEL}`, exact: true }),
      ).not.toBeChecked();
      await search.fill("workflow-beta");
      await expect(
        page.getByRole("switch", { name: `Disable ${SHARED_MODEL}`, exact: true }),
      ).toBeChecked();
      await switchTask(page, session.id, "Palot E2E: model-provider-identity");
    },
    async assert(page, { client, session, llm }) {
      await page.getByRole("button", { name: /^Model:/ }).click();
      await page
        .getByRole("combobox", { name: "Choose model", exact: true })
        .fill("workflow-shared");
      const suggestions = page.getByRole("listbox", { name: "Suggestions", exact: true });
      await expect(
        suggestions.getByRole("option", { name: new RegExp(`${SHARED_MODEL}.*Workflow Alpha`) }),
      ).toHaveCount(0);
      await expect(
        suggestions.getByRole("option", { name: new RegExp(`${SHARED_MODEL}.*Workflow Beta`) }),
      ).toBeVisible();
      expect((await client.session.get({ sessionID: session.id })).model).toMatchObject({
        id: "workflow-shared",
        providerID: "workflow-beta",
      });
      expect(llm.requests).toHaveLength(0);
    },
  },
};

async function openSettings(page: Page): Promise<void> {
  await page.keyboard.press(process.platform === "darwin" ? "Meta+K" : "Control+K");
  await page.getByRole("combobox", { name: "Search tasks and commands" }).fill("Settings");
  await page.getByRole("option", { name: /^Settings/ }).click();
  await page.getByRole("heading", { name: "General", level: 1 }).waitFor();
}

async function switchTask(page: Page, sessionID: string, title: string): Promise<void> {
  await page.keyboard.press(process.platform === "darwin" ? "Meta+K" : "Control+K");
  await page.getByRole("combobox", { name: "Search tasks and commands" }).fill(title);
  await page.getByRole("option", { name: new RegExp(title) }).click();
  await expect.poll(() => new URL(page.url()).hash.split("?")[0]).toBe(`#/sessions/${sessionID}`);
  await expect(page.getByRole("textbox", { name: "Message Palot" })).toBeVisible();
}
