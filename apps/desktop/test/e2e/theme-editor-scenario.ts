import { expect } from "@playwright/test";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import type { Scenario } from "./scenarios";

export const themeEditorScenario: Scenario = {
  description: "import, edit, persist, export and delete a custom VS Code theme",
  prompt: "",
  expectedModelCalls: 0,
  arrange() {},
  async run(page) {
    await page.evaluate(() => {
      location.hash = "#/settings/appearance";
    });
  },
  async assert(page, { runRoot }) {
    await page.getByRole("button", { name: "Import theme", exact: true }).click();
    await page.getByRole("textbox", { name: "Theme JSON", exact: true }).fill(`{
      // Small self-contained VS Code fixture
      "name":"Ocean test", "type":"dark",
      "colors":{"editor.background":"#102030", "editor.foreground":"#e0e8f0", "sideBar.background":"#15283b", "button.background":"#55aaff", "errorForeground":"#ff6677",},
      "tokenColors":[{"scope":"keyword", "settings":{"foreground":"#ffcc66"}}],
    }`);
    await page.getByRole("button", { name: "Review imported theme" }).click();
    await expect(page.getByRole("region", { name: "Theme live preview" })).toBeVisible();
    await expect(page.getByRole("dialog").locator('[aria-invalid="true"]')).toHaveCount(0);
    await page.getByRole("textbox", { name: "Background color", exact: true }).fill("#122334");
    await page.screenshot({ path: join(runRoot, "theme-editor-preview.png") });
    await page.getByRole("button", { name: "Save and apply theme" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-resolved-theme", "dark");
    await expect(page.locator("html")).toHaveAttribute("data-theme", /^custom:/);
    await expect
      .poll(async () => {
        const data = JSON.parse(
          await readFile(join(runRoot, "palot-user-data/appearance.json"), "utf8"),
        );
        return data.preferences.customThemes?.[0]?.colors.background;
      })
      .toBe("#122334");
    await page.reload();
    await expect(page.getByRole("combobox", { name: "Theme", exact: true })).toContainText(
      "Ocean test",
    );
    await expect(page.locator("html")).toHaveAttribute("data-code-theme", /^palot-custom-/);
    await page
      .getByRole("button", { name: "Export Ocean test", exact: true })
      .scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(runRoot, "theme-editor-applied.png") });
    await page.getByRole("button", { name: "Export Ocean test", exact: true }).click();
    const exported = JSON.parse(
      await page.getByRole("textbox", { name: "Exported theme JSON" }).inputValue(),
    );
    expect(exported.theme.tokenColors[0].settings.foreground).toBe("#ffcc66");
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Delete Ocean test", exact: true }).click();
    await page.getByRole("button", { name: "Confirm delete Ocean test", exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "palot");

    await page.getByRole("button", { name: "Light", exact: true }).click();
    await page.getByRole("button", { name: "Create theme", exact: true }).click();
    await page.getByRole("textbox", { name: "Theme name", exact: true }).fill("Day copy");
    await expect(page.getByRole("dialog").locator('[aria-invalid="true"]')).toHaveCount(0);
    await page.setViewportSize({ width: 920, height: 640 });
    await page.screenshot({ path: join(runRoot, "theme-editor-light-compact.png") });
    await page.getByRole("button", { name: "Save and apply theme" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-resolved-theme", "light");
    await expect(page.getByRole("combobox", { name: "Theme", exact: true })).toContainText(
      "Day copy",
    );
    await page.getByRole("button", { name: "Edit Day copy", exact: true }).click();
    await page.getByRole("textbox", { name: "Background color", exact: true }).fill("#ff0000");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.getByRole("button", { name: "Edit Day copy", exact: true }).click();
    await expect(
      page.getByRole("textbox", { name: "Background color", exact: true }),
    ).not.toHaveValue("#ff0000");
    await page.keyboard.press("Escape");
  },
};
