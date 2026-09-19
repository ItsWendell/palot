import { expect } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { PalotApi } from "../../src/shared/opencode-contract";
import type { Scenario } from "./scenarios.ts";

export const openCodeLoginSettingsScenario: Scenario = {
  description:
    "keep login startup unavailable in isolated native settings without registering or changing a host service",
  prompt: "",
  expectedModelCalls: 0,
  arrange() {},
  async run() {},
  async assert(page, { client, llm, runRoot, session, visible }) {
    await expect(page.getByRole("textbox", { name: "Message Palot" })).toBeVisible();
    const original = await client.server.info();
    expect(original.pid).toBeGreaterThan(0);

    async function unchangedService() {
      expect(await client.server.info()).toMatchObject({
        pid: original.pid,
        version: original.version,
      });
      expect(
        await page.evaluate(() =>
          (globalThis as unknown as { palot: PalotApi }).palot.runtimeStatus(),
        ),
      ).toMatchObject({ connected: true, pid: original.pid, version: original.version });
    }

    const status = () =>
      page.evaluate(() =>
        (globalThis as unknown as { palot: PalotApi }).palot.getOpenCodeLoginStatus(),
      );
    // A fake HOME does not isolate systemd/launchd. Require the real main-process
    // isolation guard before issuing even an idempotent disable request.
    const initial = await status();
    expect(initial).toMatchObject({
      manager: null,
      supported: false,
      enabled: false,
      owned: false,
      running: false,
      pid: null,
      binaryPath: null,
      configPath: null,
    });
    expect(initial.reason).toMatch(/isolated.*test/i);
    await unchangedService();

    await page.evaluate(() => {
      location.hash = "#/settings/connections/local-service";
    });
    const login = page
      .getByRole("heading", { name: "Start OpenCode at login", exact: true })
      .locator("xpath=ancestor::section[1]");
    const enable = login.getByRole("button", { name: "Enable login startup", exact: true });
    const refresh = login.getByRole("button", { name: "Refresh status", exact: true });

    async function unavailableCard() {
      await expect(login.getByText("Unavailable", { exact: true })).toBeVisible();
      await expect(login.getByText("Login startup unavailable", { exact: true })).toBeVisible();
      await expect(login).toContainText(initial.reason!);
      await expect(enable).toBeDisabled();
      await expect(refresh).toBeEnabled();
      await expect(page.getByRole("alertdialog")).toHaveCount(0);
      expect(await status()).toEqual(initial);
    }

    await unavailableCard();
    await refresh.click();
    await unavailableCard();
    // The one permitted control remains keyboard usable in the unavailable state.
    await refresh.focus();
    await expect(refresh).toBeFocused();
    await page.keyboard.press("Enter");
    await unavailableCard();
    await unchangedService();

    // Cross the real preload/IPC boundary, without stubbing the bridge or ever
    // supplying a real installation ID. No host executable can be registered.
    const rejected = await page.evaluate(async () => {
      const update = (globalThis as unknown as { palot: PalotApi }).palot.updateOpenCodeLogin as (
        input: unknown,
      ) => Promise<unknown>;
      const attempts = [
        { name: "null input", input: null },
        { name: "nonboolean enable", input: { enabled: "true" } },
        { name: "missing installation", input: { enabled: true } },
        {
          name: "arbitrary executable path",
          input: { enabled: true, binaryPath: "/arbitrary/opencode", version: "2.0.3" },
        },
        {
          name: "path instead of installation ID",
          input: { enabled: true, installationID: "/arbitrary/opencode", version: "2.0.3" },
        },
        {
          name: "extra executable field",
          input: {
            enabled: true,
            installationID: "0".repeat(64),
            version: "2.0.3",
            binaryPath: "/arbitrary/opencode",
          },
        },
        {
          name: "extra disable field",
          input: { enabled: false, binaryPath: "/arbitrary/opencode" },
        },
      ];
      const results = [];
      for (const { name, input } of attempts) {
        try {
          await update(input);
          results.push({ name, rejected: false });
        } catch {
          results.push({ name, rejected: true });
        }
      }
      return results;
    });
    for (const attempt of rejected) expect(attempt.rejected, attempt.name).toBe(true);
    const disabled = await page.evaluate(async () => {
      try {
        const status = await (
          globalThis as unknown as { palot: PalotApi }
        ).palot.updateOpenCodeLogin({
          enabled: false,
        });
        return { rejected: false as const, status };
      } catch {
        return { rejected: true as const };
      }
    });
    // Unsupported mutations may reject or resolve without changing anything.
    // Either policy must preserve the guarded status and the running service.
    if (!disabled.rejected) expect(disabled.status).toEqual(initial);
    expect(await status()).toEqual(initial);
    await unchangedService();
    await page.reload();
    await unavailableCard();

    const viewport = page.viewportSize();
    const appearance = await page.evaluate(() => ({
      preferences: (globalThis as unknown as { palot: PalotApi }).palot.appearancePreferences,
      resolvedScheme:
        document.documentElement.dataset.resolvedTheme === "dark"
          ? ("dark" as const)
          : ("light" as const),
    }));
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
          await login.scrollIntoViewIfNeeded();
          await unavailableCard();
          expect(
            await login.evaluate((element) => element.scrollWidth - element.clientWidth),
          ).toBeLessThanOrEqual(1);
          // Hidden native windows need not produce compositor frames. --visible
          // captures the actual unsupported card, never a fabricated enabled state.
          if (visible) {
            await login.screenshot({
              path: join(runRoot, `opencode-login-settings-${width}-${scheme}.png`),
              animations: "disabled",
            });
          }
        }
      }
    } finally {
      await page.evaluate(async (input) => {
        await (globalThis as unknown as { palot: PalotApi }).palot.updateAppearance(input);
      }, appearance);
      if (viewport) await page.setViewportSize(viewport);
    }

    await page.evaluate((id) => {
      location.hash = `#/sessions/${id}`;
    }, session.id);
    await expect(page.getByRole("textbox", { name: "Message Palot" })).toBeVisible();
    await unchangedService();
    expect(await status()).toEqual(initial);
    expect(llm.scriptedCalls()).toBe(0);
    expect(llm.requests).toHaveLength(0);
    await writeFile(
      join(runRoot, "opencode-login-settings.json"),
      JSON.stringify(
        { status: initial, rejected, service: { pid: original.pid, version: original.version } },
        null,
        2,
      ),
      { mode: 0o600 },
    );
  },
};
