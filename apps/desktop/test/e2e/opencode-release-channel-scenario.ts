import { expect, type Locator, type Page } from "@playwright/test";
import { readFile, realpath } from "node:fs/promises";
import { join } from "node:path";
import type { PalotApi } from "../../src/shared/opencode-contract";
import type { Scenario } from "./scenarios.ts";

export const openCodeReleaseChannelScenario: Scenario = {
  description:
    "prefer the installed CLI and persist runtime/channel choices without updating or replacing the service",
  prompt: "",
  expectedModelCalls: 0,
  arrange() {},
  // This scenario only manages settings. Skip the harness's default prompt.
  async run() {},
  async assert(page, { client, llm, runRoot, session, visible }) {
    await expect(page.getByRole("textbox", { name: "Message Palot" })).toBeVisible();
    const original = await client.server.info();
    expect(original.pid).toBeGreaterThan(0);

    async function unchangedService() {
      // Read the real service, not just a cached renderer connection indicator.
      const info = await client.server.info();
      expect(info).toMatchObject({
        pid: original.pid,
        version: original.version,
      });
      const runtime = await page.evaluate(() =>
        (globalThis as unknown as { palot: PalotApi }).palot.runtimeStatus(),
      );
      expect(runtime).toMatchObject({
        connected: true,
        pid: original.pid,
        version: original.version,
      });
    }

    await unchangedService();
    await page.evaluate(() => {
      location.hash = "#/settings/connections/local-service";
    });
    const installation = page
      .getByRole("heading", { name: "Local OpenCode runtime", exact: true })
      .locator("xpath=ancestor::section[1]");
    const runtimeSource = installation.getByRole("combobox", {
      name: "Runtime source",
      exact: true,
    });
    const installedVersion = installation.locator("dl > div").filter({
      has: page.getByText("Installed CLI version", { exact: true }),
    });
    const installedPath = installation.locator("dl > div").filter({
      has: page.getByText("Installed CLI path", { exact: true }),
    });
    const installationStatus = () =>
      page.evaluate(() =>
        (globalThis as unknown as { palot: PalotApi }).palot.openCodeInstallationStatus(),
      );
    // Mount performs only bounded local --version inspection, never a feed check
    // or package-manager invocation. Host candidates may exist: never upgrade any.
    await expect(runtimeSource).toBeVisible({ timeout: 60_000 });
    await expect(runtimeSource).toBeEnabled();
    await expect(runtimeSource).toContainText("Installed OpenCode (recommended)");
    const installations = await installationStatus();
    expect(installations.preference).toBe("installed");
    const fixturePath = process.env.OPENCODE_BIN ? await realpath(process.env.OPENCODE_BIN) : null;
    const fixture = installations.installations.find((item) =>
      fixturePath
        ? item.path === fixturePath
        : item.compatible && item.version === original.version,
    );
    expect(
      fixture,
      "The real harness CLI must be discovered as an installed OpenCode",
    ).toBeDefined();
    expect(fixture!.compatible).toBe(true);
    expect(fixture!.version).toBe(original.version);
    await expect(installedVersion.locator("dd")).toHaveText(fixture!.version);
    await expect(installedPath.locator("dd")).toHaveText(fixture!.path);

    // Persist a discovered opaque ID through public IPC, never pass executable paths
    // or select unrelated host installations. This also covers single-installation UIs.
    const selected = await page.evaluate(
      (id) => (globalThis as unknown as { palot: PalotApi }).palot.selectOpenCodeInstallation(id),
      fixture!.id,
    );
    expect(selected.selectedID).toBe(fixture!.id);
    await unchangedService();
    await page.reload();
    await expect(runtimeSource).toContainText("Installed OpenCode (recommended)");
    await expect(runtimeSource).toBeEnabled();

    const release = page
      .getByRole("heading", { name: "OpenCode release", exact: true })
      .locator("xpath=ancestor::section[1]");
    const channel = release.getByRole("combobox", { name: "Preferred channel", exact: true });
    const check = release.getByRole("button", { name: "Check for release", exact: true });
    const reset = release.getByRole("button", { name: /^Reset (to bundled |prepared runtime$)/ });
    const actual = release.locator("dl > div").filter({
      has: page.getByText("Currently running service version", { exact: true }),
    });
    const prepared = release.locator("dl > div").filter({
      has: page.getByText("Prepared Palot runtime", { exact: true }),
    });

    const status = () =>
      page.evaluate(() =>
        (globalThis as unknown as { palot: PalotApi }).palot.openCodeReleaseStatus(),
      );
    await expect(channel).toContainText("Stable");
    await expect(channel).toBeEnabled();
    const initial = await status();
    expect(initial).toMatchObject({
      channel: "stable",
      preparedVersion: null,
      checkedAt: null,
      offer: null,
    });
    const preparedLabel = initial.bundledVersion
      ? `${initial.bundledVersion} (bundled)`
      : "Not downloaded";
    await expect(actual.locator("dd")).toHaveText(original.version);
    await expect(prepared.locator("dd")).toHaveText(preparedLabel);
    await expect(reset).toBeDisabled();
    await expect(check).toBeEnabled();

    async function savedRuntimePreference(preference: "installed" | "palot") {
      await expect.poll(installationStatus).toMatchObject({ preference, selectedID: fixture!.id });
      await expect
        .poll(async () =>
          JSON.parse(
            await readFile(join(runRoot, "palot-user-data/opencode-installation.json"), "utf8"),
          ),
        )
        .toMatchObject({ installation: { preference, selectedID: fixture!.id } });
      await expect(installedVersion.locator("dd")).toHaveText(fixture!.version);
      await expect(installedPath.locator("dd")).toHaveText(fixture!.path);
      await expect(actual.locator("dd")).toHaveText(original.version);
      await expect(prepared.locator("dd")).toHaveText(preparedLabel);
      expect(await status()).toEqual(initial);
      await unchangedService();
    }

    await savedRuntimePreference("installed");
    await tabTo(page, runtimeSource);
    await page.keyboard.press("Enter");
    await expect(page.getByRole("option", { name: "Palot runtime", exact: true })).toBeVisible();
    // The popup can be visible before its initial focus has settled, especially
    // in a hidden native window. Exercise navigation only after keyboard ownership.
    await expect(
      page.getByRole("option", { name: "Installed OpenCode (recommended)", exact: true }),
    ).toBeFocused();
    await page.keyboard.press("End");
    await expect(page.getByRole("option", { name: "Palot runtime", exact: true })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(runtimeSource).toContainText("Palot runtime");
    await expect(runtimeSource).toBeFocused();
    await savedRuntimePreference("palot");
    await page.reload();
    await expect(runtimeSource).toContainText("Palot runtime");
    await expect(runtimeSource).toBeEnabled();
    await savedRuntimePreference("palot");
    await tabTo(page, runtimeSource);
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("option", { name: "Installed OpenCode (recommended)", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("option", { name: "Palot runtime", exact: true })).toBeFocused();
    await page.keyboard.press("Home");
    await expect(
      page.getByRole("option", { name: "Installed OpenCode (recommended)", exact: true }),
    ).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(runtimeSource).toContainText("Installed OpenCode (recommended)");
    await expect(runtimeSource).toBeFocused();
    await savedRuntimePreference("installed");
    await page.reload();
    await expect(runtimeSource).toContainText("Installed OpenCode (recommended)");
    await expect(runtimeSource).toBeEnabled();
    await savedRuntimePreference("installed");
    // A deterministic local-only run has no update offer. Do not fabricate one to
    // open confirmation or activate Check for updates; cancellation is covered by
    // the installation component tests, not by changing any host CLI in this run.
    await expect(
      installation.getByRole("button", { name: /^Update installed OpenCode to / }),
    ).toHaveCount(0);
    await expect(page.getByRole("alertdialog")).toHaveCount(0);

    async function savedChannel(value: "stable" | "beta") {
      await expect.poll(status).toEqual({ ...initial, channel: value });
      // Main-process acknowledgement plus the native store prove durable preference,
      // rather than treating an optimistic selected label as persistence.
      await expect
        .poll(async () =>
          JSON.parse(
            await readFile(join(runRoot, "palot-user-data/opencode-release.json"), "utf8"),
          ),
        )
        .toMatchObject({ release: { channel: value, prepared: null } });
      await unchangedService();
      await expect(actual.locator("dd")).toHaveText(original.version);
      await expect(prepared.locator("dd")).toHaveText(preparedLabel);
    }

    await tabTo(page, channel);
    await page.keyboard.press("Enter");
    await expect(page.getByRole("option", { name: "Beta", exact: true })).toBeVisible();
    await expect(page.getByRole("option", { name: "Stable", exact: true })).toBeFocused();
    await page.keyboard.press("End");
    await expect(page.getByRole("option", { name: "Beta", exact: true })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(channel).toContainText("Beta");
    await expect(channel).toBeFocused();
    await savedChannel("beta");
    await page.reload();
    await expect(channel).toContainText("Beta");
    await savedChannel("beta");

    // No prepared runtime exists in this fixture, so the UI correctly disables
    // reset. Exercise the public reset IPC's idempotent no-download path instead.
    const resetStatus = await page.evaluate(() =>
      (globalThis as unknown as { palot: PalotApi }).palot.resetOpenCodeRelease(),
    );
    expect(resetStatus).toEqual({ ...initial, channel: "beta" });
    await savedChannel("beta");

    // Cross the real preload/IPC boundary with invalid renderer arguments. Never
    // check the release feed or submit a valid offer: those are explicit network actions.
    const denied = await page.evaluate(async () => {
      const bridge = (globalThis as unknown as { palot: PalotApi }).palot;
      const setChannel = bridge.setOpenCodeReleaseChannel as (input: unknown) => Promise<unknown>;
      const prepare = bridge.prepareOpenCodeRelease as (input: unknown) => Promise<unknown>;
      const preference = bridge.setOpenCodeRuntimePreference as (
        input: unknown,
      ) => Promise<unknown>;
      const select = bridge.selectOpenCodeInstallation as (input: unknown) => Promise<unknown>;
      const upgrade = bridge.upgradeOpenCodeInstallation as (input: unknown) => Promise<unknown>;
      const attempts = [
        () => setChannel("../../beta"),
        () => setChannel({ channel: "beta" }),
        () => prepare(null),
        () => prepare({ version: "../../opencode", allowUntested: true }),
        () => prepare({ version: "2.0.2", allowUntested: "true" }),
        () => prepare({ version: "2.0.2", url: "https://invalid.example/opencode" }),
        () => preference("global"),
        () => select("/arbitrary/opencode"),
        // Unknown IDs keep even an erroneously accepted method from targeting a
        // real executable. No valid upgrade request is issued by this scenario.
        () =>
          upgrade({
            id: "0".repeat(64),
            currentVersion: "2.0.1",
            version: "2.0.2",
            method: "brew",
          }),
        () =>
          upgrade({
            id: "0".repeat(64),
            currentVersion: "2.0.1",
            version: "2.0.2",
            method: "auto",
          }),
      ];
      const results: boolean[] = [];
      for (const attempt of attempts) {
        try {
          await attempt();
          results.push(false);
        } catch {
          results.push(true);
        }
      }
      return {
        prepareAvailable: typeof bridge.prepareOpenCodeRelease === "function",
        checkAvailable: typeof bridge.checkOpenCodeRelease === "function",
        inspectAvailable: typeof bridge.inspectOpenCodeInstallations === "function",
        upgradeAvailable: typeof bridge.upgradeOpenCodeInstallation === "function",
        results,
      };
    });
    expect(denied).toEqual({
      prepareAvailable: true,
      checkAvailable: true,
      inspectAvailable: true,
      upgradeAvailable: true,
      results: [true, true, true, true, true, true, true, true, true, true],
    });
    await savedChannel("beta");
    expect(await installationStatus()).toMatchObject({
      preference: "installed",
      selectedID: fixture!.id,
    });
    // Re-probe with the native read-only control so an unchanged cached version
    // alone cannot hide a modification to the actual fixture executable.
    const refreshInstallations = installation.getByRole("button", {
      name: "Refresh installations",
      exact: true,
    });
    await refreshInstallations.click();
    await expect(refreshInstallations).toBeEnabled({ timeout: 60_000 });
    expect((await installationStatus()).installations).toContainEqual(fixture);
    await unchangedService();

    const viewport = page.viewportSize();
    const appearance = await page.evaluate(() => {
      const bridge = (globalThis as unknown as { palot: PalotApi }).palot;
      return {
        preferences: bridge.appearancePreferences,
        resolvedScheme:
          document.documentElement.dataset.resolvedTheme === "dark"
            ? ("dark" as const)
            : ("light" as const),
      };
    });
    try {
      for (const width of [1440, 920]) {
        await page.setViewportSize({ width, height: width === 920 ? 640 : 900 });
        for (const scheme of ["light", "dark"] as const) {
          await page.evaluate(
            async ({ preferences, scheme }) => {
              await (globalThis as unknown as { palot: PalotApi }).palot.updateAppearance({
                preferences: { ...preferences, mode: scheme },
                resolvedScheme: scheme,
              });
            },
            { preferences: appearance.preferences, scheme },
          );
          await expect(page.locator("html")).toHaveAttribute("data-resolved-theme", scheme);
          await runtimeSource.scrollIntoViewIfNeeded();
          await tabTo(page, runtimeSource);
          await page.keyboard.press("Enter");
          await expect(
            page.getByRole("option", { name: "Palot runtime", exact: true }),
          ).toBeVisible();
          await page.keyboard.press("Escape");
          await expect(runtimeSource).toBeFocused();
          await expect(runtimeSource).toContainText("Installed OpenCode (recommended)");
          await expect(installedVersion.locator("dd")).toHaveText(fixture!.version);
          await expect(installedPath.locator("dd")).toHaveText(fixture!.path);
          expect(
            await installation.evaluate((element) => element.scrollWidth - element.clientWidth),
          ).toBeLessThanOrEqual(1);
          // Hidden native windows need not produce compositor frames. Keep all
          // interaction/layout assertions; opt into screenshot QA with --visible.
          if (visible) {
            await installation.screenshot({
              path: join(runRoot, `opencode-installed-runtime-${width}-${scheme}.png`),
              animations: "disabled",
            });
          }
          await channel.scrollIntoViewIfNeeded();
          await tabTo(page, channel);
          await page.keyboard.press("Enter");
          await expect(page.getByRole("option", { name: "Stable", exact: true })).toBeVisible();
          await page.keyboard.press("Escape");
          await expect(channel).toBeFocused();
          await expect(channel).toContainText("Beta");
          await expect(actual.locator("dd")).toBeVisible();
          await expect(prepared.locator("dd")).toBeVisible();
          await expect(reset).toBeDisabled();
          expect(
            await release.evaluate((element) => element.scrollWidth - element.clientWidth),
          ).toBeLessThanOrEqual(1);
          if (visible) {
            await page.screenshot({
              path: join(runRoot, `opencode-release-channel-${width}-${scheme}.png`),
              animations: "disabled",
            });
          }
          // Check is keyboard reachable, but activating it would leave the deterministic path.
          await page.keyboard.press("Tab");
          await expect(check).toBeFocused();
        }
      }
    } finally {
      await page.evaluate(async (input) => {
        await (globalThis as unknown as { palot: PalotApi }).palot.updateAppearance(input);
      }, appearance);
      if (viewport) await page.setViewportSize(viewport);
    }

    await channel.click();
    await page.getByRole("option", { name: "Stable", exact: true }).click();
    await expect(channel).toContainText("Stable");
    await savedChannel("stable");
    expect(await installationStatus()).toMatchObject({
      preference: "installed",
      selectedID: fixture!.id,
    });
    await page.reload();
    await expect(channel).toContainText("Stable");
    await savedChannel("stable");
    await page.evaluate((id) => {
      location.hash = `#/sessions/${id}`;
    }, session.id);
    await expect(page.getByRole("textbox", { name: "Message Palot" })).toBeVisible();
    await unchangedService();
    expect(llm.scriptedCalls()).toBe(0);
  },
};

async function tabTo(page: Page, target: Locator) {
  for (let index = 0; index < 80; index++) {
    if (await target.evaluate((element) => element === document.activeElement)) return;
    await page.keyboard.press("Tab");
  }
  throw new Error("Keyboard focus did not reach the OpenCode runtime settings control");
}
