import { expect } from "@playwright/test";
import { join } from "node:path";
import type { Scenario } from "./scenarios";

type PalotApi = {
  appearancePreferences: Record<string, unknown>;
  updateAppearance(input: {
    preferences: Record<string, unknown>;
    resolvedScheme: "light" | "dark";
  }): Promise<unknown>;
};

export const pairingAddressScenario: Scenario = {
  description: "pair through an HTTPS proxy address without exposing credentials by default",
  prompt: "",
  expectedModelCalls: 0,
  arrange() {},
  async assert(page, { runRoot }) {
    await page.keyboard.press(process.platform === "darwin" ? "Meta+K" : "Control+K");
    await page.getByRole("combobox", { name: "Search tasks and commands" }).fill("Settings");
    await page.getByRole("option", { name: /^Settings/ }).click();
    await page.getByRole("button", { name: "Connections", exact: true }).click();
    await page.getByRole("tab", { name: "Web access", exact: true }).click();
    await page.getByRole("button", { name: "Show login credentials", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Pair device", exact: true });
    const qr = dialog.getByRole("img", { name: "OpenCode pairing QR code" });
    await expect(qr).toHaveCount(0);
    await dialog.getByRole("button", { name: "Reveal pairing credentials" }).click();
    const address = dialog.getByRole("textbox", { name: "Address for pairing" });
    await address.fill("http://proxy.example");
    await expect(dialog.getByRole("button", { name: "Show QR" })).toBeDisabled();
    await expect(dialog.getByRole("button", { name: "Copy pairing JSON" })).toBeDisabled();
    await address.fill("https://proxy.example");
    await dialog.getByRole("button", { name: "Show QR" }).click();
    await expect(qr).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Show password" })).toBeVisible();

    const viewport = page.viewportSize();
    const previous = await page.evaluate(() => {
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
      for (const scheme of ["light", "dark"] as const) {
        await page.evaluate(
          async ({ preferences, scheme }) => {
            await (globalThis as unknown as { palot: PalotApi }).palot.updateAppearance({
              preferences: { ...preferences, mode: scheme },
              resolvedScheme: scheme,
            });
          },
          { preferences: previous.preferences, scheme },
        );
        await expect(page.locator("html")).toHaveAttribute("data-resolved-theme", scheme);
        await page.setViewportSize({ width: 920, height: 640 });
        const bounds = await dialog.boundingBox();
        expect(bounds).not.toBeNull();
        expect(bounds!.y).toBeGreaterThanOrEqual(0);
        expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(641);
        expect(
          await dialog.evaluate((element) => element.scrollWidth - element.clientWidth),
        ).toBeLessThanOrEqual(1);
        // Even isolated service credentials do not belong in visual evidence.
        await page.screenshot({
          path: join(runRoot, `pairing-address-${scheme}.png`),
          mask: [qr],
          animations: "disabled",
        });
      }
    } finally {
      await page.evaluate(async (input) => {
        await (globalThis as unknown as { palot: PalotApi }).palot.updateAppearance(input);
      }, previous);
      if (viewport) await page.setViewportSize(viewport);
    }
    await dialog.getByRole("button", { name: "Use service addresses" }).click();
    await expect(qr).toHaveCount(0);
    await expect(address).toHaveValue("");
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Show login credentials", exact: true }).click();
    await expect(dialog.getByRole("button", { name: "Reveal pairing credentials" })).toBeVisible();
    await expect(qr).toHaveCount(0);
  },
};
