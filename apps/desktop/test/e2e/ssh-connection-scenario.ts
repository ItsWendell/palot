import { expect } from "@playwright/test";
import { join } from "node:path";
import type { Scenario } from "./scenarios";

type PalotApi = {
  appearancePreferences: Record<string, unknown>;
  updateAppearance(input: {
    preferences: Record<string, unknown>;
    resolvedScheme: "light" | "dark";
  }): Promise<unknown>;
  listOpenCodeProfiles(): Promise<unknown>;
  getSshConnectionState(): Promise<unknown>;
};

export const sshConnectionScenario: Scenario = {
  description: "SSH settings layout and real IPC rejection without opening an SSH connection",
  prompt: "",
  expectedModelCalls: 0,
  arrange() {},
  async assert(page, { runRoot }) {
    const before = await page.evaluate(async () => {
      const bridge = (globalThis as unknown as { palot: PalotApi }).palot;
      return {
        profiles: await bridge.listOpenCodeProfiles(),
        preferences: bridge.appearancePreferences,
        resolvedScheme:
          document.documentElement.dataset.resolvedTheme === "dark"
            ? ("dark" as const)
            : ("light" as const),
      };
    });
    await page.keyboard.press(process.platform === "darwin" ? "Meta+K" : "Control+K");
    await page.getByRole("combobox", { name: "Search tasks and commands" }).fill("Settings");
    await page.getByRole("option", { name: /^Settings/ }).click();
    await page.getByRole("button", { name: "Connections", exact: true }).click();
    await page.getByRole("tab", { name: "Profiles", exact: true }).click();
    await expect(page.getByRole("button", { name: "Add HTTP server", exact: true })).toBeVisible();
    const add = page.getByRole("button", { name: "Add SSH connection", exact: true });
    await add.click();
    const dialog = page.getByRole("dialog", { name: "Add SSH connection", exact: true });
    const target = dialog.getByRole("textbox", { name: "SSH target", exact: true });
    const save = dialog.getByRole("button", { name: "Test and save", exact: true });
    await expect(dialog).toBeVisible();
    await expect(save).toBeDisabled();
    await target.focus();
    await expect(target).toBeFocused();

    // This target is rejected by normalizeSshConfig in the real IPC handler,
    // before runtime.testProfile can invoke system SSH. Never submit a valid host.
    await target.fill("invalid target");
    await save.click();
    await expect(dialog.getByRole("alert")).toContainText(
      "SSH target must be a host or user@host without whitespace or shell syntax",
    );
    await expect(save).toBeEnabled();
    const after = await page.evaluate(async () => {
      const bridge = (globalThis as unknown as { palot: PalotApi }).palot;
      return {
        profiles: await bridge.listOpenCodeProfiles(),
        operation: await bridge.getSshConnectionState(),
      };
    });
    expect(after.profiles).toEqual(before.profiles);
    expect(after.operation).toBeNull();

    const port = dialog.getByRole("textbox", { name: "Port (optional)", exact: true });
    await port.fill("65536");
    await expect(port).toHaveAttribute("aria-invalid", "true");
    await expect(save).toBeDisabled();
    await port.fill("2222");
    await dialog.getByRole("textbox", { name: "Identity file (optional)" }).fill("~/.ssh/work");
    await expect(save).toBeEnabled();

    const viewport = page.viewportSize();
    try {
      await page.setViewportSize({ width: 920, height: 640 });
      for (const scheme of ["light", "dark"] as const) {
        await page.evaluate(
          async ({ preferences, scheme }) => {
            await (globalThis as unknown as { palot: PalotApi }).palot.updateAppearance({
              preferences: { ...preferences, mode: scheme },
              resolvedScheme: scheme,
            });
          },
          { preferences: before.preferences, scheme },
        );
        await expect(page.locator("html")).toHaveAttribute("data-resolved-theme", scheme);
        await save.scrollIntoViewIfNeeded();
        await expect(save).toBeInViewport();
        const bounds = await dialog.boundingBox();
        expect(bounds).not.toBeNull();
        expect(bounds!.x).toBeGreaterThanOrEqual(0);
        expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(921);
        expect(bounds!.y).toBeGreaterThanOrEqual(0);
        expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(641);
        expect(
          await dialog.evaluate((element) => element.scrollWidth - element.clientWidth),
        ).toBeLessThanOrEqual(1);
        await page.screenshot({
          path: join(runRoot, `ssh-connection-${scheme}.png`),
          animations: "disabled",
        });
      }
    } finally {
      await page.evaluate(async ({ preferences, resolvedScheme }) => {
        await (globalThis as unknown as { palot: PalotApi }).palot.updateAppearance({
          preferences,
          resolvedScheme,
        });
      }, before);
      if (viewport) await page.setViewportSize(viewport);
    }
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await add.click();
    await expect(target).toHaveValue("");
    await expect(dialog.getByRole("alert")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  },
};
