import { expect, type Locator } from "@playwright/test";
import { join } from "node:path";
import type { Scenario } from "./scenarios";

export const composerContextScenario: Scenario = {
  description: "match new-task project and checkout control geometry at narrow and wide sizes",
  prompt: "",
  expectedModelCalls: 0,
  arrange() {},
  async run(page) {
    await page.evaluate(() => {
      location.hash = "#/new";
    });
    await page.getByRole("main", { name: "New task" }).waitFor();
  },
  async assert(page, { runRoot }) {
    const main = page.getByRole("main", { name: "New task" });
    const project = main.getByRole("combobox", { name: "Project", exact: true });
    const workspace = main.getByRole("button", { name: /^Work in:/ });
    await workspace.click();
    await page.getByRole("button", { name: /Current checkout Use the project/ }).click();
    await expect(workspace).toHaveText("Checkout");
    for (const width of [1440, 920]) {
      await page.setViewportSize({ width, height: width === 920 ? 640 : 900 });
      for (const colorScheme of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme });
        await expect(project).toBeVisible();
        await expect(workspace).toBeVisible();
        const projectMetrics = await controlMetrics(project);
        const workspaceMetrics = await controlMetrics(workspace);
        expect(projectMetrics).toEqual(workspaceMetrics);
        await main.screenshot({
          path: join(runRoot, `composer-context-${width}-${colorScheme}.png`),
        });
      }
    }
    await project.click();
    await expect(project).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.press("Escape");
    await expect(project).toBeFocused();
    await workspace.click();
    await page.getByRole("button", { name: /New worktree Start detached/ }).click();
    await expect(workspace).toHaveText("New worktree");
    expect(await controlMetrics(project)).toEqual(await controlMetrics(workspace));
    const branch = main.getByRole("button", { name: /^Source branch:/ });
    await expect(branch).toBeVisible();
    expect(await controlMetrics(branch)).toEqual(await controlMetrics(workspace));
    await main.screenshot({ path: join(runRoot, "composer-context-worktree.png") });
    await workspace.click();
    await page.getByRole("button", { name: /Current checkout Use the project/ }).click();
    await expect(workspace).toHaveText("Checkout");
  },
};

function controlMetrics(locator: Locator) {
  return locator.evaluate((element) => {
    const style = getComputedStyle(element);
    const icon = element.querySelector("svg")!.getBoundingClientRect();
    return {
      height: element.getBoundingClientRect().height,
      fontSize: style.fontSize,
      lineHeight: style.lineHeight,
      fontWeight: style.fontWeight,
      padding: style.padding,
      gap: style.gap,
      iconWidth: icon.width,
      iconHeight: icon.height,
    };
  });
}
