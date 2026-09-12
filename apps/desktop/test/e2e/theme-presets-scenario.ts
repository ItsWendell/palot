import { expect } from "@playwright/test";
import { join } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import type { Scenario } from "./scenarios";

export const themePresetsScenario: Scenario = {
  description: "hydrate saved Codex preferences and retain built-in themes across renderer reloads",
  prompt: "",
  expectedModelCalls: 0,
  arrange() {},
  async prepare(home) {
    await writeFile(
      join(home, "../palot-user-data/appearance.json"),
      JSON.stringify({
        preferences: {
          version: 3,
          source: "palot",
          mode: "dark",
          lightTheme: "codex",
          darkTheme: "codex",
        },
      }),
    );
  },
  async run(page) {
    await page.evaluate(() => {
      location.hash = "#/settings/appearance";
    });
  },
  async assert(page, { runRoot }) {
    const theme = page.getByRole("combobox", { name: "Theme", exact: true });
    await expect(theme).toContainText("Codex");
    const html = page.locator("html");
    for (const mode of ["Light", "Dark"] as const) {
      await page.getByRole("button", { name: mode, exact: true }).click();
      await expect(html).toHaveAttribute("data-resolved-theme", mode.toLowerCase());
      for (const [name, id] of [
        ["Absolutely", "absolutely"],
        ["OpenCode", "opencode"],
        ["TanStack", "tanstack"],
        ["macOS", "macos"],
        ["Codex", "codex"],
      ] as const) {
        await theme.scrollIntoViewIfNeeded();
        await theme.click();
        await page.getByRole("option", { name, exact: true }).click();
        await expect(theme).toContainText(name);
        await expect(html).toHaveAttribute("data-theme", id);
        await expect(page.locator(".markdown-highlight code")).toContainText("compileTheme");
        // Native persistence follows asynchronous syntax preparation. Wait for
        // acknowledgement rather than treating optimistic DOM state as durable.
        await expect
          .poll(async () => {
            const saved = JSON.parse(
              await readFile(join(runRoot, "palot-user-data/appearance.json"), "utf8"),
            );
            return saved.preferences[mode === "Light" ? "lightTheme" : "darkTheme"];
          })
          .toBe(id);
        // Reload only the renderer: BrowserWindow startup arguments are unchanged.
        await page.reload();
        await expect(theme).toContainText(name);
        await expect(html).toHaveAttribute("data-resolved-theme", mode.toLowerCase());
        await expect(html).toHaveAttribute("data-theme", id);
        await expect(page.locator(".markdown-highlight code")).toContainText("compileTheme");
      }
      await expect(html).toHaveAttribute("data-code-theme", `codex-${mode.toLowerCase()}`);
      await page.getByText("appearance/theme.ts", { exact: true }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: join(runRoot, `theme-codex-${mode.toLowerCase()}.png`) });
    }
    await expect(theme).toContainText("Codex");
    await expect(html).toHaveAttribute("data-theme", "codex");
    await expect(html).toHaveAttribute("data-code-theme", "codex-dark");
  },
};
