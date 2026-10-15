import type { IntegrationExternalMethod } from "@opencode/plugin/promise/integration";
import { expect, type Locator } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Scenario } from "./scenarios.ts";

const INTEGRATION_ID = "openai";
const INTEGRATION_NAME = "Palot External Fixture";
const METHOD_ID = "palot-e2e-profile";
const CREDENTIAL_LABEL = "External fixture work";
const ANSWER = {
  instructions: true,
  source: "palot-e2e",
  profile: "e2e-profile",
  custom: true,
  endpoint: "https://example.invalid/credentials",
};
const METHOD = {
  id: METHOD_ID,
  type: "external",
  label: "Fixture credential profile",
  form: [
    {
      key: "instructions",
      type: "external",
      title: "Fixture setup instructions",
      url: "https://example.invalid/palot-external-fixture",
    },
    { key: "source", type: "string", hidden: true, default: ANSWER.source },
    {
      key: "profile",
      type: "string",
      title: "Credential profile",
      required: true,
      pattern: "^[a-z][a-z0-9-]+$",
    },
    { key: "custom", type: "boolean", title: "Use custom endpoint", default: false },
    {
      key: "endpoint",
      type: "string",
      title: "Credential endpoint",
      format: "uri",
      required: true,
      when: [{ key: "custom", op: "eq", value: true }],
    },
  ],
} satisfies IntegrationExternalMethod;

/** The method picker is a radio group that only appears when several methods remain. */
async function chooseFixtureMethod(dialog: Locator): Promise<void> {
  const method = dialog.getByRole("radio", { name: /^Fixture credential profile/ });
  if ((await method.count()) === 0) return;
  await method.click();
  await expect(method).toHaveAttribute("aria-checked", "true");
}

export const externalCredentialsScenario: Scenario = {
  description:
    "connect a dummy external credential through native settings, verify form metadata and label on OpenCode 2.0.29, and reload hydration without provider login",
  prompt: "",
  expectedModelCalls: 0,
  arrange() {},
  async prepare(home) {
    const configDirectory = join(home, ".config", "opencode");
    const pluginDirectory = join(home, "external-credentials-plugin");
    await mkdir(configDirectory, { recursive: true });
    await mkdir(pluginDirectory, { recursive: true });
    await writeFile(
      join(pluginDirectory, "package.json"),
      JSON.stringify({
        name: "palot-e2e-external-credentials",
        type: "module",
        exports: "./index.mjs",
      }),
    );
    // Plugin.define returns this object unchanged. Use the published editor
    // contract without importing an SDK from the disposable plugin directory.
    // External methods persist a credential-source reference, not a login grant.
    await writeFile(
      join(pluginDirectory, "index.mjs"),
      [
        "export default {",
        '  id: "palot.e2e.external-credentials",',
        "  async setup(ctx) {",
        "    await ctx.integration.transform((editor) => {",
        `      editor.update(${JSON.stringify(INTEGRATION_ID)}, (integration) => {`,
        `        integration.name = ${JSON.stringify(INTEGRATION_NAME)};`,
        "      });",
        `      for (const method of editor.method.list(${JSON.stringify(INTEGRATION_ID)})) {`,
        `        editor.method.remove(${JSON.stringify(INTEGRATION_ID)}, method);`,
        "      }",
        `      editor.method.update(${JSON.stringify({ integrationID: INTEGRATION_ID, method: METHOD })});`,
        "    });",
        "  },",
        "};",
      ].join("\n"),
    );
    await writeFile(
      join(configDirectory, "opencode.json"),
      JSON.stringify({ plugins: [pluginDirectory] }),
      { mode: 0o600 },
    );
  },
  async seed(client, { projectDirectory }) {
    expect((await client.server.info()).version).toBe("2.0.29");
    const input = { integrationID: INTEGRATION_ID, location: { directory: projectDirectory } };
    await expect
      .poll(async () => (await client.integration.get(input)).data, {
        timeout: 30_000,
        message: "Wait for the dummy external integration method to activate",
      })
      .toMatchObject({
        name: INTEGRATION_NAME,
        methods: expect.arrayContaining([METHOD]),
        connections: [],
      });
    expect(
      (await client.credential.list()).filter((entry) => entry.integrationID === INTEGRATION_ID),
    ).toEqual([]);
  },
  async run(page, { client, projectDirectory, runRoot, visible }) {
    const pageErrors: string[] = [];
    const onPageError = (error: Error) => pageErrors.push(error.message);
    page.on("pageerror", onPageError);
    try {
      await page.evaluate(() => {
        location.hash = "#/settings/providers";
      });
      await expect(page.getByRole("heading", { name: "Providers", level: 1 })).toBeVisible();
      await page
        .getByRole("searchbox", { name: "Search providers", exact: true })
        .fill(INTEGRATION_NAME);
      await expect(page.getByText(INTEGRATION_NAME, { exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Connect", exact: true }).click();
      const dialog = page.getByRole("dialog", {
        name: `Add ${INTEGRATION_NAME} credential`,
        exact: true,
      });
      await expect(dialog).toBeVisible();
      await chooseFixtureMethod(dialog);
      await expect(
        dialog.getByRole("link", { name: "Fixture setup instructions", exact: true }),
      ).toHaveAttribute("href", METHOD.form[0].url);
      await expect(dialog.getByLabel("API key", { exact: true })).toHaveCount(0);
      await expect(dialog.getByLabel("source", { exact: true })).toHaveCount(0);
      const submit = dialog.getByRole("button", { name: "Add and use", exact: true });
      const acknowledgment = dialog.getByRole("checkbox", {
        name: "I completed this step: Fixture setup instructions",
        exact: true,
      });
      await expect(acknowledgment).not.toBeChecked();
      await expect(submit).toBeDisabled();
      await dialog
        .getByRole("textbox", { name: "Credential profile", exact: true })
        .fill(ANSWER.profile);
      await expect(submit).toBeDisabled();
      // The fixture step is complete locally. Acknowledge it without opening its external URL.
      await acknowledgment.check();
      await expect(submit).toBeEnabled();
      await acknowledgment.uncheck();
      await expect(submit).toBeDisabled();
      await acknowledgment.check();
      await expect(
        dialog.getByRole("textbox", { name: "Credential endpoint", exact: true }),
      ).toHaveCount(0);
      await dialog.getByRole("checkbox", { name: "Use custom endpoint", exact: true }).check();
      await expect(submit).toBeDisabled();
      await dialog
        .getByRole("textbox", { name: "Credential endpoint", exact: true })
        .fill("not a URL");
      await expect(submit).toBeDisabled();
      await dialog
        .getByRole("textbox", { name: "Credential endpoint", exact: true })
        .fill(ANSWER.endpoint);
      await dialog
        .getByRole("textbox", { name: /Credential label/ })
        .fill(`  ${CREDENTIAL_LABEL}  `);
      await expect(submit).toBeEnabled();
      if (visible) await page.screenshot({ path: join(runRoot, "external-credentials-form.png") });
      await submit.click();
      await expect(dialog).toHaveCount(0);

      const card = page.getByRole("article", {
        name: `${INTEGRATION_NAME} connections`,
        exact: true,
      });
      const connection = card.getByRole("group", {
        name: `${CREDENTIAL_LABEL} connection`,
        exact: true,
      });
      await expect(connection.getByText("In use", { exact: true })).toBeVisible();
      await expect(card.getByText("1 stored credential", { exact: true })).toBeVisible();
      await expect
        .poll(async () =>
          (await client.credential.list()).filter(
            (entry) => entry.integrationID === INTEGRATION_ID,
          ),
        )
        .toEqual([
          expect.objectContaining({
            integrationID: INTEGRATION_ID,
            label: CREDENTIAL_LABEL,
            active: true,
            value: { type: "external", methodID: METHOD_ID, metadata: ANSWER },
          }),
        ]);
      const credential = (await client.credential.list()).find(
        (entry) => entry.integrationID === INTEGRATION_ID,
      )!;
      const input = { integrationID: INTEGRATION_ID, location: { directory: projectDirectory } };
      const integration = (await client.integration.get(input)).data;
      expect(integration.connections).toHaveLength(1);
      expect(integration.connections).toMatchObject([
        { type: "credential", id: credential.id, label: CREDENTIAL_LABEL, method: "external" },
      ]);

      const serverPicker = page.getByRole("combobox", { name: "Configure server", exact: true });
      const serverName = (await serverPicker.innerText()).trim();
      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(page.getByRole("heading", { name: "Providers", level: 1 })).toBeVisible();
      // Direct settings reload has no entry task. Explicitly retain the original server owner.
      await serverPicker.click();
      await page.getByRole("option", { name: serverName, exact: true }).click();
      await expect(connection.getByText("In use", { exact: true })).toBeVisible();
      await expect(card.getByText("1 stored credential", { exact: true })).toBeVisible();
      await card.getByRole("button", { name: "Add credential", exact: true }).click();
      await chooseFixtureMethod(dialog);
      await expect(
        dialog.getByRole("textbox", { name: "Credential profile", exact: true }),
      ).toHaveValue("");
      await expect(
        dialog.getByRole("checkbox", { name: "Use custom endpoint", exact: true }),
      ).not.toBeChecked();
      await expect(acknowledgment).not.toBeChecked();
      await expect(submit).toBeDisabled();
      await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
      expect((await client.integration.get(input)).data.connections).toEqual(
        integration.connections,
      );
      expect((await client.credential.list()).find((entry) => entry.id === credential.id)).toEqual(
        credential,
      );
      expect(pageErrors).toEqual([]);
      if (visible)
        await page.screenshot({ path: join(runRoot, "external-credentials-connected.png") });
      await writeFile(
        join(runRoot, "external-credentials.json"),
        JSON.stringify(
          {
            server: await client.server.info(),
            credential,
            connections: integration.connections,
            pageErrors,
          },
          null,
          2,
        ),
        { mode: 0o600 },
      );
    } finally {
      page.off("pageerror", onPageError);
    }
  },
  async assert(page, { llm }) {
    await expect(
      page
        .getByRole("article", { name: `${INTEGRATION_NAME} connections`, exact: true })
        .getByText(CREDENTIAL_LABEL, { exact: true }),
    ).toBeVisible();
    expect(llm.requests).toHaveLength(0);
  },
};
