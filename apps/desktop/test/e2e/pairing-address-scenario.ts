import { expect, type Locator, type Page } from "@playwright/test";
import { join } from "node:path";
import type { Scenario } from "./scenarios.ts";

type PalotApi = {
  appearancePreferences: Record<string, unknown>;
  updateAppearance(input: {
    preferences: Record<string, unknown>;
    resolvedScheme: "light" | "dark";
  }): Promise<unknown>;
};

export const pairingAddressScenario: Scenario = {
  description:
    "generate one-time pairing details explicitly, respect QR reachability, and review multi-address imports with fresh HTTP consent",
  prompt: "",
  expectedModelCalls: 0,
  arrange() {},
  async assert(page, { runRoot }) {
    await page.keyboard.press(process.platform === "darwin" ? "Meta+K" : "Control+K");
    await page.getByRole("combobox", { name: "Search tasks and commands" }).fill("Settings");
    await page.getByRole("option", { name: /^Settings/ }).click();
    await page.getByRole("button", { name: "Connections", exact: true }).click();
    await page.getByRole("tab", { name: "Web access", exact: true }).click();
    await page.getByRole("button", { name: "Pair device", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Pair device", exact: true });
    const qr = dialog.getByRole("img", { name: "OpenCode one-time pairing QR code" });
    await expect(qr).toHaveCount(0);
    await expect(dialog.locator("code")).toHaveCount(0);
    await expect(dialog.getByRole("button", { name: "Copy one-time link" })).toHaveCount(0);
    await dialog.getByRole("button", { name: "Generate pairing details", exact: true }).click();
    try {
      const copy = dialog.getByRole("button", { name: "Copy one-time link", exact: true });
      await expect(copy).toBeEnabled();
      await expect(dialog.getByText(/This one-time link and QR expire/)).toBeVisible();
      await expect(dialog.getByText(/^Expires .*after generation\./)).toBeVisible();
      await expect(dialog.getByText("Username", { exact: true })).toHaveCount(0);
      await expect(dialog.getByText("Password", { exact: true })).toHaveCount(0);
      await expect(qr).toHaveCount(0);
      const address = dialog.getByRole("textbox", { name: "Address for pairing", exact: true });
      await address.fill("http://pairing-proxy.example.invalid");
      await expect(dialog.getByRole("alert")).toHaveText(
        "Use HTTPS for a custom pairing address to protect pairing secrets.",
      );
      await expect(dialog.getByRole("button", { name: "Show QR", exact: true })).toBeDisabled();
      await expect(copy).toBeDisabled();
      await dialog.getByRole("button", { name: "Use service addresses", exact: true }).click();
      await expect(address).toHaveValue("");
      await expect(copy).toBeEnabled();

      const unavailable = dialog
        .getByRole("status")
        .filter({ hasText: "Only local addresses are available." });
      if (await unavailable.count()) {
        // The isolated loopback service is not reachable from a scanning device.
        // Do not invent an HTTPS proxy or enable OpenTunnel to manufacture a QR.
        await expect(unavailable).toBeVisible();
        await expect(
          unavailable.getByText("opencode pair --remote", { exact: true }),
        ).toBeVisible();
        await expect(dialog.getByRole("button", { name: "Show QR", exact: true })).toBeDisabled();
        await expect(qr).toHaveCount(0);
      } else {
        await dialog.getByRole("button", { name: "Show QR", exact: true }).click();
        await expect(qr).toBeVisible();
      }
      await assertCompactDialog(page, dialog, runRoot, "pairing-address", [
        qr,
        dialog.locator("code"),
      ]);
      if (await qr.count()) {
        await dialog.getByRole("button", { name: "Hide QR", exact: true }).click();
        await expect(qr).toHaveCount(0);
      }
    } finally {
      // Dismiss generated secrets before the harness captures failure evidence.
      await page.keyboard.press("Escape");
    }
    await expect(dialog).toHaveCount(0);
    await page.getByRole("button", { name: "Pair device", exact: true }).click();
    await expect(
      dialog.getByRole("button", { name: "Generate pairing details", exact: true }),
    ).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Copy one-time link" })).toHaveCount(0);
    await expect(dialog.locator("code")).toHaveCount(0);
    await expect(qr).toHaveCount(0);
    await page.keyboard.press("Escape");

    await page.getByRole("tab", { name: "Profiles", exact: true }).click();
    await page.getByRole("button", { name: "Add paired server", exact: true }).click();
    const importer = page.getByRole("dialog", { name: "Add paired server", exact: true });
    const draft = importer.getByRole("textbox", {
      name: "Pairing link or legacy JSON",
      exact: true,
    });
    const submit = importer.getByRole("button", { name: "Probe and import", exact: true });
    const httpAddress = "http://pairing-http.example.invalid:4096";
    const httpsAddress = "https://pairing-https.example.invalid";
    // This is a non-redeemable draft. Never press Probe and import or send it to
    // either advertised address; selection and consent are local UI operations.
    const payload = JSON.stringify({
      code: "palot-e2e-pairing-draft",
      urls: [httpAddress, httpsAddress],
    });
    await expect(submit).toBeDisabled();
    await draft.fill(payload);
    const target = importer.getByRole("combobox", { name: "Redeem at this address", exact: true });
    const consent = importer.getByRole("checkbox", { name: /^Allow plain HTTP\./ });
    await expect(target).toHaveValue(httpsAddress);
    await expect(target.locator("option")).toHaveCount(2);
    await expect(
      importer.getByText(
        "Only this address receives the one-time code. Other addresses are not tried automatically.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(consent).toHaveCount(0);
    await expect(submit).toBeEnabled();
    await target.selectOption(httpAddress);
    await expect(consent).not.toBeChecked();
    await expect(submit).toBeDisabled();
    await consent.check();
    await expect(submit).toBeEnabled();
    await target.selectOption(httpsAddress);
    await expect(consent).toHaveCount(0);
    await target.selectOption(httpAddress);
    await expect(consent).not.toBeChecked();
    await expect(submit).toBeDisabled();
    await consent.check();
    await draft.fill(`${payload}\n`);
    await expect(target).toHaveValue(httpsAddress);
    await target.selectOption(httpAddress);
    await expect(consent).not.toBeChecked();
    await expect(submit).toBeDisabled();
    await target.selectOption(httpsAddress);
    await assertCompactDialog(page, importer, runRoot, "pairing-import", [draft]);
    await importer.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.getByRole("button", { name: "Add paired server", exact: true }).click();
    await expect(draft).toHaveValue("");
    await expect(target).toHaveCount(0);
    await expect(consent).toHaveCount(0);
    await expect(submit).toBeDisabled();
    await importer.getByRole("button", { name: "Cancel", exact: true }).click();
  },
};

async function assertCompactDialog(
  page: Page,
  dialog: Locator,
  runRoot: string,
  artifact: string,
  mask: Locator[],
) {
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
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(921);
      expect(bounds!.y).toBeGreaterThanOrEqual(0);
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(641);
      expect(
        await dialog.evaluate((element) => element.scrollWidth - element.clientWidth),
      ).toBeLessThanOrEqual(1);
      // One-time links, reusable credentials, and QR payloads are all sensitive.
      await page.screenshot({
        path: join(runRoot, `${artifact}-${scheme}.png`),
        mask,
        animations: "disabled",
      });
    }
  } finally {
    await page.evaluate(async (input) => {
      await (globalThis as unknown as { palot: PalotApi }).palot.updateAppearance(input);
    }, previous);
    if (viewport) await page.setViewportSize(viewport);
  }
}
