import type { OpenCodeClient, PermissionRuleset, SessionMessageInfo } from "@opencode/client";
import { expect, type Page } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PALOT_TOOL_PERMISSIONS } from "../../src/shared/palot-tools-contract.ts";
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
    const source = await client.experimental.session.import({
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
    await expect(page.locator(`[data-palot-response-message="${ASSISTANT_ID}"]`)).toBeVisible();
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
    // Full access allows Palot's own tools too; only Defaults adds rules for them.
    await expectRules(client, sessionID, FULL_ACCESS);
    await expectPending(client, sessionID, requestID);
    await expect(pendingCard).toBeVisible();

    // Hydration must use persisted session rules, not a local selector preference.
    await page.reload({ waitUntil: "domcontentloaded" });
    await expectApprovals(page, "Full access");
    await expect(pendingCard).toBeVisible();
    await expectPending(client, sessionID, requestID);

    // The chip opens the launcher on Approvals; Defaults applies at once and closes it.
    await page.getByRole("button", { name: "Approvals: Full access", exact: true }).click();
    await expect(approvalsPreset(page, "Full access")).toHaveAttribute("aria-current", "true");
    await approvalsPreset(page, "Defaults").click();
    await expectApprovals(page, "Defaults");
    await expect(launcher(page)).toHaveCount(0);
    await expectRules(client, sessionID, PALOT_TOOL_PERMISSIONS);
    await expect(confirmation).toHaveCount(0);

    // External official-client writes must reconcile through service events without a reload.
    await client.session.update({ sessionID, permissions: CUSTOM });
    await expectApprovals(page, "Custom");
    await page.getByRole("button", { name: "Approvals: Custom", exact: true }).click();
    // Custom rules match neither preset: neither is current, and a notice says a preset
    // replaces them.
    await expect(
      launcher(page).getByText("Custom session rules are active. Choosing a preset replaces them."),
    ).toBeVisible();
    await expect(approvalsPreset(page, "Defaults")).not.toHaveAttribute("aria-current", "true");
    await expect(approvalsPreset(page, "Full access")).not.toHaveAttribute("aria-current", "true");
    // Escape steps back to the launcher's root, then closes it.
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await expect(launcher(page)).toHaveCount(0);
    await expectRules(client, sessionID, CUSTOM);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expectApprovals(page, "Custom");
    await client.session.update({ sessionID, permissions: [] });
    await expectApprovals(page, "Defaults");
    await expectRules(client, sessionID, []);
    await expectPending(client, sessionID, requestID);
    await expect(pendingCard).toBeVisible();
    // Only an explicit reply settles the existing request. Then inspect the ordinary row.
    await client.permission.reply({ sessionID, requestID, decision: "reject" });
    await expect(pendingCard).toHaveCount(0);
    const message = page.getByRole("textbox", { name: "Message Palot" });
    // Defaults show no chip; model and effort share one popover.
    await expect(page.getByRole("button", { name: /^Approvals:/ })).toHaveCount(0);
    const modelTrigger = page.getByRole("button", { name: /^Model: Test Model, effort / });
    await modelTrigger.click();
    await expect(page.getByRole("combobox", { name: "Choose model", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(message).toBeFocused();
    // Effort sits beside the model list because Test Model offers variants.
    await modelTrigger.click();
    await page.getByRole("option", { name: /^High\b/ }).click();
    const effortTrigger = page.getByRole("button", {
      name: "Model: Test Model, effort High",
      exact: true,
    });
    await expect(effortTrigger).toBeEnabled();
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
      await effortTrigger.click();
      await expect(page.getByRole("option", { name: /^High\b/ })).toHaveAttribute(
        "aria-selected",
        "true",
      );
      await page.screenshot({ path: join(runRoot, "composer-model-effort-dark.png") });
      await page.keyboard.press("Escape");
      await expect(page.getByRole("combobox", { name: "Choose model" })).toHaveCount(0);
      // The chip opens the launcher on Approvals; the text field keeps focus.
      await page.getByRole("button", { name: "Approvals: Full access", exact: true }).click();
      await expect(approvalsPreset(page, "Full access")).toHaveAttribute("aria-current", "true");
      await expect(message).toBeFocused();
      await page.screenshot({ path: join(runRoot, "composer-permissions-menu-dark.png") });
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");
      await expect(launcher(page)).toHaveCount(0);
      await expect(message).toBeFocused();
      await client.session.update({ sessionID, permissions: [] });
      await expect(page.getByRole("button", { name: /^Approvals:/ })).toHaveCount(0);
      await openApprovals(page);
      // Moving the highlight onto Full access arms nothing; Enter picks it and asks first.
      await page.keyboard.press("ArrowDown");
      await expect(approvalsPreset(page, "Full access")).toHaveAttribute("aria-selected", "true");
      await expect(page.getByRole("alertdialog")).toHaveCount(0);
      await expectRules(client, sessionID, []);
      await page.keyboard.press("Enter");
      await expect(
        page.getByRole("alertdialog", { name: "Enable Full access?", exact: true }),
      ).toBeVisible();
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

/** The row shows an approvals chip only when they are not Defaults. */
async function expectApprovals(page: Page, mode: "Defaults" | "Full access" | "Custom") {
  if (mode === "Defaults") {
    await expect(page.getByRole("button", { name: /^Model:/ })).toBeEnabled();
    await expect(page.getByRole("button", { name: /^Approvals:/ })).toHaveCount(0);
    return;
  }
  await expect(page.getByRole("button", { name: `Approvals: ${mode}`, exact: true })).toBeEnabled();
}

function launcher(page: Page) {
  return page.getByRole("region", { name: "Add to message", exact: true });
}

/** A preset under the launcher's Approvals entry. */
function approvalsPreset(page: Page, name: "Defaults" | "Full access") {
  return page
    .getByRole("listbox", { name: "Approvals", exact: true })
    .getByRole("option", { name: new RegExp(`^${name}`) });
}

/** `+`, then the Approvals entry, which names the current mode. */
async function openApprovals(page: Page) {
  await page.getByRole("button", { name: "Add files, commands and more", exact: true }).click();
  const entry = launcher(page).getByRole("option", { name: /^Approvals/ });
  await expect(entry).toContainText("Defaults");
  await entry.click();
  await expect(approvalsPreset(page, "Defaults")).toHaveAttribute("aria-current", "true");
}

async function openFullAccessConfirmation(page: Page) {
  await openApprovals(page);
  await approvalsPreset(page, "Full access").click();
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
      const names = [/^Agent:/, /^Approvals:/, /^Model:/, /^Context window/, /^Send message$/];
      for (const name of names) await expect(page.getByRole("button", { name })).toBeInViewport();
      // One DOM snapshot avoids comparing bounds from different layout/animation frames.
      await expect
        .poll(() =>
          page.getByRole("button").evaluateAll((buttons) => {
            const prefixes = ["Agent:", "Approvals:", "Model:", "Context window", "Send message"];
            const boxes = prefixes.map((prefix) =>
              buttons
                .find((button) => button.getAttribute("aria-label")?.startsWith(prefix))
                ?.getBoundingClientRect(),
            );
            if (boxes.some((box) => !box || box.width <= 0 || box.height <= 0)) return false;
            const [agent, approvals, model, context, send] = boxes as DOMRect[];
            if (!agent || !approvals || !model || !context || !send) return false;
            const aligned = (a: DOMRect, b: DOMRect) =>
              Math.abs((a.top + a.bottom) / 2 - (b.top + b.bottom) / 2) <= 2;
            // The row never wraps: everything sits on one line, in order, without overlap.
            return (
              boxes.every((box) => aligned(box!, send)) &&
              agent.right <= approvals.left + 1 &&
              approvals.right <= model.left + 1 &&
              model.right <= context.left + 1 &&
              context.left - model.right <= 16 &&
              context.right <= send.left + 1
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
