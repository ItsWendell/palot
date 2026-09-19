import { expect } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { PalotApi } from "../../src/shared/opencode-contract";
import type { OpenCodeReleaseStatus } from "../../src/shared/opencode-release-contract";
import type { Scenario } from "./scenarios.ts";

export const openCodeRuntimeAcquisitionScenario: Scenario = {
  description: "opt-in official Stable fallback download in an external-runtime package",
  prompt: "",
  expectedModelCalls: 0,
  async prepare() {
    if (process.env.PALOT_E2E_ALLOW_RUNTIME_DOWNLOAD !== "1") {
      throw new Error(
        "opencode-runtime-acquisition downloads and verifies an executable from opencode.ai. " +
          "Run explicitly with PALOT_E2E_ALLOW_RUNTIME_DOWNLOAD=1 and --executable /absolute/path/to/packaged-palot. " +
          "Use opencode-release-channel for offline runtime settings QA.",
      );
    }
  },
  arrange() {},
  async run() {},
  async assert(page, { client, llm, runRoot }) {
    await expect(page.getByRole("textbox", { name: "Message Palot" })).toBeVisible();
    const original = await client.server.info();
    expect(original.pid).toBeGreaterThan(0);
    const status = () =>
      page.evaluate(() =>
        (globalThis as unknown as { palot: PalotApi }).palot.openCodeReleaseStatus(),
      );
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

    await page.evaluate(() => {
      location.hash = "#/settings/connections/local-service";
    });
    const release = page
      .getByRole("heading", { name: "OpenCode release", exact: true })
      .locator("xpath=ancestor::section[1]");
    const channel = release.getByRole("combobox", { name: "Preferred channel", exact: true });
    const reset = release.getByRole("button", { name: "Reset prepared runtime", exact: true });
    const prepared = release.locator("dl > div").filter({
      has: page.getByText("Prepared Palot runtime", { exact: true }),
    });
    const actual = release.locator("dl > div").filter({
      has: page.getByText("Currently running service version", { exact: true }),
    });
    await expect(channel).toBeEnabled({ timeout: 60_000 });
    const initial = await status();
    expect(
      initial.preparedVersion,
      "The isolated fixture must start without a prepared runtime",
    ).toBeNull();
    expect(
      initial.bundledVersion,
      "Use --executable with a public external-runtime package, not a bundled-runtime build",
    ).toBeNull();
    expect(initial.checkedAt).toBeNull();
    expect(initial.offer).toBeNull();
    await expect(prepared.locator("dd")).toHaveText("Not downloaded");
    await expect(reset).toBeDisabled();
    await unchangedService();

    await channel.click();
    await page.getByRole("option", { name: "Stable", exact: true }).click();
    await expect(channel).toContainText("Stable");
    await expect.poll(status).toMatchObject({ channel: "stable", preparedVersion: null });

    // All mutations go through native renderer controls. IPC reads observe the
    // real manager, whose official feed checks and binary verification stay intact.
    async function waitForAction(done: (value: OpenCodeReleaseStatus) => boolean, timeout: number) {
      const error = release.getByRole("alert");
      await expect
        .poll(async () => done(await status()) || (await error.isVisible()), { timeout })
        .toBe(true);
      if (await error.isVisible()) {
        throw new Error(`Official runtime acquisition failed: ${await error.innerText()}`);
      }
    }
    await release.getByRole("button", { name: "Check for release", exact: true }).click();
    await waitForAction((value) => value.checkedAt !== null, 45_000);
    const checked = await status();
    const offer = checked.offer;
    if (
      !offer ||
      offer.channel !== "stable" ||
      !/^2\.\d+\.\d+$/.test(offer.version) ||
      offer.requiresConfirmation
    ) {
      throw new Error(
        `Official Stable feed must offer a compatible stable 2.x runtime; received ${JSON.stringify(offer)}. ` +
          "No executable was downloaded. Review upstream compatibility before retrying; this scenario never bypasses consent.",
      );
    }
    expect(checked.preparedVersion).toBeNull();
    await unchangedService();

    try {
      await release
        .getByRole("button", { name: `Download Palot fallback ${offer.version}`, exact: true })
        .click();
      // The manager bounds archive fetching to 120s; allow extraction and --version too.
      await waitForAction((value) => value.preparedVersion === offer.version, 180_000);
      await expect(page.getByRole("alertdialog")).toHaveCount(0);
      await expect(prepared.locator("dd")).toHaveText(`${offer.version} (downloaded)`);
      await expect(actual.locator("dd")).toHaveText(original.version);
      await unchangedService();
      const saved = JSON.parse(
        await readFile(join(runRoot, "palot-user-data/opencode-release.json"), "utf8"),
      );
      expect(saved).toMatchObject({
        release: { channel: "stable", prepared: { version: offer.version } },
      });
      expect(saved.release.prepared.sha256).toMatch(/^[a-f0-9]{64}$/);
      await page.reload();
      await expect(prepared.locator("dd")).toHaveText(`${offer.version} (downloaded)`);
      expect((await status()).preparedVersion).toBe(offer.version);
      await unchangedService();
      await writeFile(
        join(runRoot, "opencode-runtime-acquisition.json"),
        JSON.stringify(
          {
            offer,
            prepared: saved.release.prepared,
            service: { pid: original.pid, version: original.version },
          },
          null,
          2,
        ),
        { mode: 0o600 },
      );
    } finally {
      if ((await status()).preparedVersion !== null) {
        await reset.click();
        await expect.poll(status).toMatchObject({ preparedVersion: null, bundledVersion: null });
      }
      await unchangedService();
    }
    await expect(prepared.locator("dd")).toHaveText("Not downloaded");
    await expect(reset).toBeDisabled();
    expect(
      JSON.parse(await readFile(join(runRoot, "palot-user-data/opencode-release.json"), "utf8")),
    ).toMatchObject({ release: { prepared: null } });
    expect(llm.scriptedCalls()).toBe(0);
  },
};
