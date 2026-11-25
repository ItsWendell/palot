import { expect, type Locator, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { PalotApi as PalotBridge } from "../../src/shared/opencode-contract";
import type { Scenario } from "./scenarios.ts";

type PalotApi = PalotBridge & {
  appearancePreferences: Record<string, unknown>;
  updateAppearance(input: {
    preferences: Record<string, unknown>;
    resolvedScheme: "light" | "dark";
  }): Promise<unknown>;
};

/** A fresh one-time code from the isolated service, as pairing JSON for its own loopback address. */
async function loopbackPairing(page: Page, name?: string): Promise<string> {
  return page.evaluate(async (label) => {
    const api = (globalThis as unknown as { palot: PalotApi }).palot;
    const info = await api.openCodePairingInfo();
    if (info.mode !== "link") throw new Error("The isolated service has no one-time pairing");
    const loopback = info.urls.find((value) =>
      ["127.0.0.1", "localhost", "[::1]"].includes(new URL(value).hostname),
    );
    if (!loopback) throw new Error("The isolated service has no loopback address");
    return JSON.stringify(
      label
        ? { code: info.code, urls: [loopback], name: label }
        : { code: info.code, urls: [loopback] },
    );
  }, name);
}

export const pairingAddressScenario: Scenario = {
  description:
    "share a named one-time code, connect to it by name, renew, report failed steps, and rename, test and remove from one row",
  prompt: "",
  expectedModelCalls: 0,
  arrange() {},
  async assert(page, { runRoot }) {
    const shots = process.env.PALOT_PAIRING_SCREENSHOTS || runRoot;
    mkdirSync(shots, { recursive: true });
    const shot = (name: string, mask: Locator[] = []) =>
      page.screenshot({ path: join(shots, `${name}.png`), mask, animations: "disabled" });

    await page.keyboard.press(process.platform === "darwin" ? "Meta+K" : "Control+K");
    await page.getByRole("combobox", { name: "Search tasks and commands" }).fill("Settings");
    await page.getByRole("option", { name: /^Settings/ }).click();
    await page.getByRole("button", { name: "Connections", exact: true }).click();
    await expect(page.getByRole("button", { name: "Connect to another computer" })).toBeVisible();
    await shot("01-servers");

    // Sharing: nothing secret exists until the code is created on purpose.
    await page.getByRole("button", { name: "Share this computer", exact: true }).click();
    const share = page.getByRole("dialog", { name: "Share this computer", exact: true });
    const qr = share.getByRole("img", { name: "OpenCode one-time pairing QR code" });
    await expect(qr).toHaveCount(0);
    await expect(share.getByRole("button", { name: "Copy pairing code" })).toHaveCount(0);
    await shot("02-share-start");
    await share.getByRole("button", { name: "Create pairing code", exact: true }).click();
    try {
      await expect(share.getByText(/^Expires in \d:\d\d$/)).toBeVisible();
      await expect(share.getByRole("button", { name: "Copy pairing code" })).toBeEnabled();
      await share.getByRole("textbox", { name: "Name on the other device" }).fill("E2E Studio");
      // The isolated service only listens on loopback: no QR, and the way out is explained.
      await expect(share.getByText("Other devices can’t reach this computer yet")).toBeVisible();
      await expect(share.getByText("opencode pair --remote", { exact: true })).toBeVisible();
      await expect(qr).toHaveCount(0);
      await shot("03-share-unreachable");
      await share.getByRole("button", { name: "Use a different address…" }).click();
      const address = share.getByRole("textbox", { name: "Address for pairing", exact: true });
      await address.fill("http://pairing-proxy.example.invalid");
      await expect(share.getByRole("alert")).toHaveText(
        "Use HTTPS for a custom pairing address to protect pairing secrets.",
      );
      await expect(share.getByRole("button", { name: "Copy pairing code" })).toBeDisabled();
      // A proxy address is reachable, so the QR appears, carrying the name.
      await address.fill("https://pairing-proxy.example.invalid");
      await expect(qr).toBeVisible();
      // The code is only in the QR image and the clipboard, never printed.
      expect(await share.textContent()).not.toContain("/auth/connect/");
      await assertCompactDialog(page, share, shots, "04-share-qr", [qr]);
      await share.getByRole("button", { name: "Use service addresses", exact: true }).click();
      await expect(qr).toHaveCount(0);
    } finally {
      await page.keyboard.press("Escape");
    }
    await expect(share).toHaveCount(0);
    await page.getByRole("button", { name: "Share this computer", exact: true }).click();
    await expect(share.getByRole("button", { name: "Create pairing code" })).toBeVisible();
    await expect(qr).toHaveCount(0);
    await page.keyboard.press("Escape");

    // Connecting: a draft that is never redeemed checks target choice and HTTP consent.
    const connect = page.getByRole("dialog", { name: "Connect to another computer", exact: true });
    const draft = connect.getByRole("textbox", { name: "Pairing code or link", exact: true });
    const submit = connect.getByRole("button", { name: "Connect", exact: true });
    const nameField = connect.getByRole("textbox", { name: "Name in Palot", exact: true });
    await page.getByRole("button", { name: "Connect to another computer" }).click();
    await expect(submit).toBeDisabled();
    const httpAddress = "http://pairing-http.example.invalid:4096";
    const httpsAddress = "https://pairing-https.example.invalid";
    await draft.fill(
      JSON.stringify({
        code: "palot-e2e-pairing-draft",
        urls: [httpAddress, httpsAddress],
        name: "Draft Box",
      }),
    );
    await expect(draft).toHaveCount(0);
    await expect(nameField).toHaveValue("Draft Box");
    const target = connect.getByRole("combobox", { name: "Redeem at this address", exact: true });
    const consent = connect.getByRole("checkbox", { name: /^Allow plain HTTP\./ });
    await expect(target).toHaveValue(httpsAddress);
    await expect(consent).toHaveCount(0);
    await expect(submit).toBeEnabled();
    await target.selectOption(httpAddress);
    await expect(submit).toBeDisabled();
    await consent.check();
    await expect(submit).toBeEnabled();
    await target.selectOption(httpsAddress);
    await target.selectOption(httpAddress);
    await expect(consent).not.toBeChecked();
    await target.selectOption(httpsAddress);
    await assertCompactDialog(page, connect, shots, "05-connect-review", []);
    await connect.getByRole("button", { name: "Paste a different code" }).click();
    await expect(draft).toHaveValue("");

    // A real, named code from the isolated service.
    const first = await loopbackPairing(page, "E2E Studio");
    await draft.fill(first);
    await expect(nameField).toHaveValue("E2E Studio");
    await expect(connect.getByText("Named by the other computer.")).toBeVisible();
    await submit.click();
    await expect(connect.getByText("Connected to E2E Studio")).toBeVisible({ timeout: 30_000 });
    await expect(connect.getByText(/^\d+\.\d+\.\d+/)).toBeVisible();
    await shot("06-connect-success");
    await connect.getByRole("button", { name: "Done", exact: true }).click();
    const row = page.getByRole("group", { name: "E2E Studio", exact: true });
    await expect(row.getByText("Connected", { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(row.getByText(/OpenCode \d+\.\d+\.\d+/)).toBeVisible();
    await shot("07-server-row");

    const profileCount = () =>
      page.evaluate(async () => {
        const api = (globalThis as unknown as { palot: PalotApi }).palot;
        return (await api.listOpenCodeProfiles()).profiles.length;
      });
    const before = await profileCount();

    // A used code fails at the code step and is dropped.
    await page.getByRole("button", { name: "Connect to another computer" }).click();
    await draft.fill(first);
    await submit.click();
    await expect(connect.getByText("Failed at: Pairing code")).toBeVisible({ timeout: 30_000 });
    await expect(draft).toHaveValue("");
    await shot("08-connect-code-used");

    // An address nobody listens on fails at the address step and keeps the code for a retry.
    await draft.fill(
      JSON.stringify({ code: "palot-e2e-unreachable-code", urls: ["http://127.0.0.1:2"] }),
    );
    await submit.click();
    await expect(connect.getByText("Failed at: Reaching the address")).toBeVisible({
      timeout: 30_000,
    });
    await expect(connect.getByText("Nothing answered at 127.0.0.1:2.")).toBeVisible();
    await expect(connect.getByRole("button", { name: "Try again" })).toBeEnabled();
    await shot("09-connect-unreachable");
    await connect.getByRole("button", { name: "Paste a different code" }).click();

    // Pairing the same server again renews it instead of adding a copy.
    await draft.fill(await loopbackPairing(page));
    await expect(connect.getByText("You’ve connected to this server as E2E Studio")).toBeVisible();
    await expect(nameField).toHaveValue("E2E Studio");
    await submit.click();
    await expect(connect.getByText("Renewed the sign-in for E2E Studio")).toBeVisible({
      timeout: 30_000,
    });
    await connect.getByRole("button", { name: "Done", exact: true }).click();
    expect(await profileCount()).toBe(before);

    // Test, rename and remove from the row's menu.
    await row.getByRole("button", { name: "Manage E2E Studio" }).click();
    await page.getByRole("menuitem", { name: "Test connection" }).click();
    await expect(row.getByText("Reached E2E Studio")).toBeVisible({ timeout: 30_000 });
    await shot("10-row-tested");
    await row.getByRole("button", { name: "Manage E2E Studio" }).click();
    await page.getByRole("menuitem", { name: "Rename…" }).click();
    const rename = page.getByRole("dialog", { name: "Rename E2E Studio" });
    await rename.getByRole("textbox", { name: "Name" }).fill("E2E Box");
    await rename.getByRole("button", { name: "Rename", exact: true }).click();
    const renamed = page.getByRole("group", { name: "E2E Box", exact: true });
    await expect(renamed).toBeVisible();
    await renamed.getByRole("button", { name: "Manage E2E Box" }).click();
    await page.getByRole("menuitem", { name: "Remove…" }).click();
    await page.getByRole("button", { name: "Remove connection" }).click();
    await expect(renamed).toHaveCount(0);
    expect(await profileCount()).toBe(before - 1);
  },
};

async function assertCompactDialog(
  page: Page,
  dialog: Locator,
  shots: string,
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
      // QR payloads carry the one-time code, so they are masked.
      await page.screenshot({
        path: join(shots, `${artifact}-${scheme}.png`),
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
