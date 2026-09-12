import { expect, type Page } from "@playwright/test";
import { join } from "node:path";
import type { Scenario } from "./scenarios";

export async function checkSourceUpdateInstructions(page: Page, runRoot: string): Promise<void> {
  await page.evaluate(() => {
    const browser = globalThis as unknown as {
      location: { hash: string };
      open(url?: string | { toString(): string }): null;
      __palotOpenedUrl?: string;
    };
    browser.location.hash = "#/settings/about";
    browser.open = (url) => {
      browser.__palotOpenedUrl = String(url);
      return null;
    };
  });
  await page.getByRole("heading", { name: "About", level: 1 }).waitFor();
  await expect(page.getByRole("link", { name: /Open/ })).toHaveCount(6);
  const instructions = page.getByRole("button", { name: "View instructions" });
  for (let index = 0; index < 80; index += 1) {
    if (await instructions.evaluate((element) => element.ownerDocument.activeElement === element)) {
      break;
    }
    await page.keyboard.press("Tab");
  }
  await expect(instructions).toBeFocused();
  await page.keyboard.press("Enter");
  await expect
    .poll(() =>
      page.evaluate(
        () => (globalThis as unknown as { __palotOpenedUrl?: string }).__palotOpenedUrl,
      ),
    )
    .toBe(
      "https://github.com/ItsWendell/palot/blob/main/docs/installation.md#updating-and-uninstalling",
    );
  await expect(page.getByRole("status")).toContainText(
    "Opened source installation and update instructions",
  );
  await page.screenshot({ path: join(runRoot, "about-source-updates.png") });
}

export const sourceUpdatesScenario: Scenario = {
  description:
    "Keyboard activation opens source update instructions, not legacy release downloads.",
  prompt: "",
  expectedModelCalls: 0,
  arrange() {},
  async run(page, { runRoot }) {
    await checkSourceUpdateInstructions(page, runRoot);
  },
  async assert(page) {
    await expect(page.getByRole("heading", { name: "About", level: 1 })).toBeVisible();
  },
};
