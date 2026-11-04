import type { Page } from "@playwright/test";

/**
 * Closes a terminal's workbench tab, leaving its process running. The tab is named after the
 * terminal's automatic title, which the host's shell sets, so it is found through its panel.
 */
export async function closeTerminalTab(page: Page, ptyID?: string): Promise<void> {
  const terminal = ptyID ? `[data-workbench-terminal="${ptyID}"]` : "[data-workbench-terminal]";
  const tabID = await page
    .locator(`[role="tabpanel"]:has(${terminal})`)
    .getAttribute("aria-labelledby");
  if (!tabID) throw new Error("Terminal panel has no tab");
  await page
    .locator(`[id="${tabID}"]`)
    .locator("..")
    .getByRole("button", { name: /^Close / })
    .click();
}
