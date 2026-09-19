import type { OpenCodeClient, PermissionRuleset, SessionMessageInfo } from "@opencode/client";
import { expect, type Page } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Scenario } from "./scenarios.ts";

const FULL_ACCESS: PermissionRuleset = [{ action: "*", resource: "*", effect: "allow" }];
const CUSTOM: PermissionRuleset = [{ action: "shell", resource: "*", effect: "ask" }];
const FIXTURE_FILE = "composer-permissions-fixture.json";
const ASSISTANT_ID = "msg_composer_permissions_assistant";

export const composerPermissionsScenario: Scenario = {
  description:
    "confirm session Full access, preserve pending approvals, reconcile external rules and reload, and check responsive composer control groups",
  prompt: "",
  expectedModelCalls: 0,
  arrange() {},
  async prepare(home) {
    const directory = join(home, ".config", "opencode");
    await mkdir(directory, { recursive: true });
    await writeFile(
      join(directory, "opencode.json"),
      JSON.stringify({
        providers: {
          test: {
            models: {
              "test-model": {
                name: "Test Model",
                limit: { context: 100_000, output: 10_000 },
                variants: [
                  { id: "low", body: { reasoning_effort: "low" } },
                  { id: "high", body: { reasoning_effort: "high" } },
                ],
              },
            },
          },
        },
      }),
      { mode: 0o600 },
    );
  },
  async seed(client, { projectDirectory, runRoot }) {
    const location = { directory: projectDirectory };
    // Cold locations populate catalogs asynchronously; wait for this fixture, not plugin inventory.
    await expect
      .poll(
        async () => {
          const model = (await client.model.list({ location })).data.find(
            (entry) => entry.providerID === "test" && entry.id === "test-model",
          );
          return model?.variants.map((variant) => variant.id).sort();
        },
        { timeout: 30_000, message: "Wait for test/test-model reasoning variants" },
      )
      .toEqual(["high", "low"]);
    const session = await client.session.create({ location: { directory: projectDirectory } });
    const created = Date.now() - 10_000;
    const messages: SessionMessageInfo[] = [
      {
        id: "msg_composer_permissions_user",
        type: "user",
        time: { created },
        text: "Review the isolated approval settings fixture.",
      },
      {
        id: ASSISTANT_ID,
        type: "assistant",
        time: { created: created + 1, completed: created + 2 },
        agent: "build",
        model: { providerID: "test", id: "test-model" },
        finish: "stop",
        content: [{ type: "text", text: "Approval settings fixture is ready." }],
      },
    ];
    // Seed before Electron starts: live creation can race workspace refresh against hydration.
    const source = await client.session.import({
      info: {
        ...session,
        id: `${session.id}_approvals`,
        title: "Composer approvals fixture",
        model: { providerID: "test", id: "test-model", variant: "low" },
      },
      messages,
      location: session.location,
    });
    await client.session.update({ sessionID: source.id, permissions: CUSTOM });
    // The official create API evaluates a request without executing a tool or calling a model.
    const pending = await client.permission.create({
      sessionID: source.id,
      action: "shell",
      resources: ["printf 'COMPOSER_PERMISSION_FIXTURE'"],
    });
    expect(pending.effect).toBe("ask");
    await client.session.update({ sessionID: source.id, permissions: [] });
    expect(
      await client.permission.get({ sessionID: source.id, requestID: pending.id }),
    ).toMatchObject({
      id: pending.id,
    });
    await writeFile(
      join(runRoot, FIXTURE_FILE),
      JSON.stringify({ sessionID: source.id, requestID: pending.id }),
      { mode: 0o600 },
    );
    await client.session.remove({ sessionID: session.id });
  },
  async run(page, { client, runRoot }) {
    const fixture = JSON.parse(await readFile(join(runRoot, FIXTURE_FILE), "utf8")) as {
      sessionID: string;
      requestID: string;
    };
    const { sessionID, requestID } = fixture;
    await page.evaluate((id) => {
      location.hash = `#/sessions/${id}`;
    }, sessionID);
    // A composer alone may still belong to the previous route.
    await expect(page.locator(`[data-message-id="${ASSISTANT_ID}"]`)).toBeVisible();
    await expectApprovals(page, "Defaults");
    const pendingCard = page.locator(`[data-palot-request-id="${requestID}"]`);
    await expect(pendingCard).toBeVisible();
    await expectRules(client, sessionID, []);

    await openFullAccessConfirmation(page);
    const confirmation = page.getByRole("alertdialog", {
      name: "Enable Full access?",
      exact: true,
    });
    await expectRules(client, sessionID, []);
    await confirmation.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(confirmation).toHaveCount(0);
    await expectApprovals(page, "Defaults");
    await expectRules(client, sessionID, []);

    await openFullAccessConfirmation(page);
    await confirmation.getByRole("button", { name: "Enable Full access", exact: true }).click();
    await expect(confirmation).toHaveCount(0);
    await expectApprovals(page, "Full access");
    await expectRules(client, sessionID, FULL_ACCESS);
    await expectPending(client, sessionID, requestID);
    await expect(pendingCard).toBeVisible();

    // Hydration must use persisted session rules, not a local selector preference.
    await page.reload({ waitUntil: "domcontentloaded" });
    await expectApprovals(page, "Full access");
    await expect(pendingCard).toBeVisible();
    await expectPending(client, sessionID, requestID);

    await page.getByRole("button", { name: "Approvals: Full access", exact: true }).click();
    await page.getByRole("menuitemradio", { name: /^Defaults\b/ }).click();
    await expectApprovals(page, "Defaults");
    await expectRules(client, sessionID, []);
    await expect(confirmation).toHaveCount(0);

    // External official-client writes must reconcile through service events without a reload.
    await client.session.update({ sessionID, permissions: CUSTOM });
    await expectApprovals(page, "Custom");
    await page.getByRole("button", { name: "Approvals: Custom", exact: true }).click();
    await expect(page.getByRole("menuitemradio", { name: /^Defaults\b/ })).not.toBeChecked();
    await expect(page.getByRole("menuitemradio", { name: /^Full access\b/ })).not.toBeChecked();
    await page.keyboard.press("Escape");
    await expectRules(client, sessionID, CUSTOM);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expectApprovals(page, "Custom");
    await client.session.update({ sessionID, permissions: [] });
    await expectApprovals(page, "Defaults");
    await expectRules(client, sessionID, []);
    await expectPending(client, sessionID, requestID);
    await expect(pendingCard).toBeVisible();
    // Only an explicit reply settles the existing request. Then inspect the ordinary toolbar.
    await client.permission.reply({ sessionID, requestID, decision: "reject" });
    await expect(pendingCard).toHaveCount(0);
    const modelTrigger = page.getByRole("button", { name: "Model: Test Model", exact: true });
    await expect(page.getByRole("button", { name: /^Reasoning:/ })).toHaveCount(0);
    await modelTrigger.click();
    await expect(page.getByRole("combobox", { name: "Choose model", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "High", exact: true }).click();
    await expect(modelTrigger).toHaveAttribute("aria-description", "Reasoning: High");
    await expect
      .poll(async () => (await client.session.get({ sessionID })).model?.variant)
      .toBe("high");
    await client.session.update({ sessionID, permissions: FULL_ACCESS });
    await expectApprovals(page, "Full access");
    await captureLayout(page, runRoot);
    await page.emulateMedia({ colorScheme: "dark" });
    try {
      await expect
        .poll(() => page.evaluate(() => document.documentElement.style.colorScheme))
        .toBe("dark");
      await modelTrigger.click();
      await expect(page.getByRole("button", { name: "High", exact: true })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      await page.screenshot({ path: join(runRoot, "composer-model-effort-dark.png") });
      await page.keyboard.press("Escape");
      const trigger = page.getByRole("button", { name: "Approvals: Full access", exact: true });
      await trigger.click();
      await expect(page.getByRole("menuitemradio", { name: /^Full access\b/ })).toBeChecked();
      await page.screenshot({ path: join(runRoot, "composer-permissions-menu-dark.png") });
      await page.keyboard.press("Escape");
      await expect(trigger).toBeFocused();
      await client.session.update({ sessionID, permissions: [] });
      await expectApprovals(page, "Defaults");
      await openFullAccessConfirmation(page);
      await page.screenshot({ path: join(runRoot, "composer-permissions-confirm-dark.png") });
      await page.keyboard.press("Escape");
      await expect(page.getByRole("alertdialog")).toHaveCount(0);
      await expectRules(client, sessionID, []);
    } finally {
      await page.emulateMedia({ colorScheme: null });
    }
  },
  async assert(_page, { llm }) {
    expect(llm.scriptedCalls()).toBe(0);
  },
};

async function expectApprovals(page: Page, mode: "Defaults" | "Full access" | "Custom") {
  await expect(page.getByRole("button", { name: `Approvals: ${mode}`, exact: true })).toBeEnabled();
}

async function openFullAccessConfirmation(page: Page) {
  await page.getByRole("button", { name: /^Approvals:/ }).click();
  await expect(page.getByRole("menuitemradio", { name: /^Defaults\b/ })).toBeChecked();
  await page.getByRole("menuitemradio", { name: /^Full access\b/ }).click();
  await expect(
    page.getByRole("alertdialog", { name: "Enable Full access?", exact: true }),
  ).toBeVisible();
}

async function expectRules(
  client: OpenCodeClient,
  sessionID: string,
  permissions: PermissionRuleset,
) {
  await expect
    .poll(async () => (await client.session.get({ sessionID })).permissions)
    .toEqual(permissions);
}

async function expectPending(client: OpenCodeClient, sessionID: string, requestID: string) {
  expect((await client.permission.list({ sessionID })).map((request) => request.id)).toEqual([
    requestID,
  ]);
}

async function captureLayout(page: Page, runRoot: string) {
  const viewport = page.viewportSize();
  try {
    for (const size of [
      { width: 1440, height: 900 },
      { width: 920, height: 640 },
    ]) {
      await page.setViewportSize(size);
      const names = [/^Agent:/, /^Approvals:/, /^Model:/, /^Open Context/, /^Send message$/];
      for (const name of names) await expect(page.getByRole("button", { name })).toBeInViewport();
      // One DOM snapshot avoids comparing bounds from different layout/animation frames.
      await expect
        .poll(() =>
          page.getByRole("button").evaluateAll((buttons) => {
            const prefixes = ["Agent:", "Approvals:", "Model:", "Open Context", "Send message"];
            const boxes = prefixes.map((prefix) =>
              buttons
                .find((button) => button.getAttribute("aria-label")?.startsWith(prefix))
                ?.getBoundingClientRect(),
            );
            if (boxes.some((box) => !box || box.width <= 0 || box.height <= 0)) return false;
            const [agent, approvals, model, context, send] = boxes as DOMRect[];
            if (!agent || !approvals || !model || !context || !send) return false;
            const disjoint = boxes.every((a, index) =>
              boxes
                .slice(index + 1)
                .every(
                  (b) =>
                    a &&
                    b &&
                    (a.right <= b.left + 1 ||
                      b.right <= a.left + 1 ||
                      a.bottom <= b.top + 1 ||
                      b.bottom <= a.top + 1),
                ),
            );
            const aligned = (a: DOMRect, b: DOMRect) =>
              Math.abs((a.top + a.bottom) / 2 - (b.top + b.bottom) / 2) <= 2;
            // Left options may wrap above the right controls at the minimum viewport.
            // The single model/effort trigger stays immediately before Context and Send.
            const separateGroups =
              approvals.right <= model.left + 1 ||
              Math.max(agent.bottom, approvals.bottom) <= model.top + 1;
            return (
              disjoint &&
              separateGroups &&
              agent.right <= approvals.left + 1 &&
              aligned(agent, approvals) &&
              model.right <= context.left + 1 &&
              context.left - model.right <= 16 &&
              context.right <= send.left + 1 &&
              aligned(model, context) &&
              aligned(context, send)
            );
          }),
        )
        .toBe(true);
      await page.screenshot({
        path: join(runRoot, `composer-permissions-${size.width}x${size.height}.png`),
      });
    }
  } finally {
    if (viewport) await page.setViewportSize(viewport);
  }
}
