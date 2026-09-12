import { expect } from "@playwright/test";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Scenario } from "./scenarios.ts";

export const linuxDesktopScenario: Scenario = {
  description: "compact navigation and live Omarchy theme replacement in native Electron",
  prompt: "Return the Linux desktop verification response.",
  expectedModelCalls: 1,
  arrange(llm) {
    llm.text("Linux desktop ready.");
  },
  async prepare(home) {
    await writeFile(
      join(home, "../palot-user-data/appearance.json"),
      JSON.stringify({ preferences: { linuxBackgroundOpacity: 85 } }),
    );
    const current = join(home, ".local/state/omarchy/current");
    await mkdir(join(current, "theme"), { recursive: true });
    await writeFile(join(current, "theme.name"), "palot-test-dark\n");
    await writeFile(
      join(current, "theme/colors.toml"),
      'mode = "dark"\nbackground = "#101820"\nforeground = "#f5f5f5"\naccent = "#aaddff"\n',
    );
  },
  async assert(page, { runRoot }) {
    await expect(page.getByText("Linux desktop ready.", { exact: true })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-linux-translucent", "true");
    await expect
      .poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor))
      .toBe("rgba(0, 0, 0, 0)");
    const headerClearance = () =>
      page.evaluate(() => {
        const chrome = document.querySelector(".window-chrome-cluster")!;
        const project = document.querySelector('[aria-label="Show project details"]')!;
        return project.getBoundingClientRect().left - chrome.getBoundingClientRect().right;
      });
    await expect.poll(headerClearance).toBeGreaterThanOrEqual(11);
    for (const width of [640, 720, 960, 1280]) {
      await page.setViewportSize({ width, height: 720 });
      const composer = page.getByRole("textbox", { name: "Message" });
      // The contenteditable label differs between draft and session composers.
      const input = (await composer.count())
        ? composer
        : page.locator('[contenteditable="true"]').first();
      await expect(input).toBeVisible();
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
        .toBe(true);
      await expect.poll(headerClearance).toBeGreaterThanOrEqual(11);
      if (width === 640) {
        await page.getByRole("button", { name: "Show navigation", exact: true }).click();
        await expect(page.getByRole("dialog", { name: "Task navigation" })).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(page.getByRole("dialog", { name: "Task navigation" })).toBeHidden();
        await expect.poll(headerClearance).toBeGreaterThanOrEqual(11);
        await expect.poll(headerClearance).toBeLessThanOrEqual(13);
      }
      await page.screenshot({ path: join(runRoot, `linux-layout-${width}.png`) });
    }
    await page.evaluate(async () => {
      const api = Reflect.get(window, "palot");
      await api.updateAppearance({
        preferences: { ...api.appearancePreferences, source: "system" },
        resolvedScheme: "dark",
      });
    });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "omarchy");
    await expect(page.locator("html")).toHaveAttribute("data-resolved-theme", "dark");
    const current = join(runRoot, "home/.local/state/omarchy/current");
    const next = join(current, "next-theme");
    await mkdir(next, { recursive: true });
    await writeFile(
      join(next, "colors.toml"),
      'mode = "light"\nbackground = "#fffaf0"\nforeground = "#202020"\naccent = "#305080"\n',
    );
    await rm(join(current, "theme"), { recursive: true });
    await rename(next, join(current, "theme"));
    await writeFile(join(current, "theme.name"), "palot-test-light\n");
    await expect(page.locator("html")).toHaveAttribute("data-resolved-theme", "light");
    await expect
      .poll(() =>
        page.evaluate(() =>
          getComputedStyle(document.documentElement).getPropertyValue("--background").trim(),
        ),
      )
      .toBe("#fffaf0");
    await page.evaluate(async () => {
      await Promise.all(
        document
          .getAnimations()
          .filter((animation) => animation instanceof CSSTransition)
          .map((animation) => animation.finished.catch(() => {})),
      );
    });
    await page.screenshot({ path: join(runRoot, "linux-system-light.png") });
    await page.evaluate(() => {
      location.hash = "#/settings/appearance";
    });
    const theme = page.getByRole("combobox", { name: "Theme", exact: true });
    await expect(theme).toContainText("System");
    await expect(page.getByText("Appearance source", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Color mode", exact: true })).toHaveCount(0);
    await expect(page.getByText("Following Omarchy · Palot Test Light")).toBeVisible();
    const settingsScroll = page.locator('[data-slot="scroll-area"]').last();
    const scrollbar = settingsScroll.locator(
      '[data-slot="scroll-area-scrollbar"][data-orientation="vertical"]',
    );
    await page.mouse.move(0, 0);
    await page.evaluate(() => {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    });
    await settingsScroll.locator('[data-slot="scroll-area-viewport"]').hover();
    await page.mouse.wheel(0, 200);
    await expect
      .poll(() => scrollbar.evaluate((element) => getComputedStyle(element).opacity))
      .toBe("1");
    await expect
      .poll(() => scrollbar.evaluate((element) => getComputedStyle(element).opacity))
      .toBe("0");
    const alwaysShow = page.getByRole("switch", { name: "Always show scrollbars", exact: true });
    await alwaysShow.scrollIntoViewIfNeeded();
    await alwaysShow.click();
    await expect(page.locator("html")).toHaveAttribute("data-scrollbars", "always");
    await alwaysShow.click();
    await expect(page.locator("html")).toHaveAttribute("data-scrollbars", "auto");
    await theme.scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(runRoot, "linux-system-theme-settings.png") });
    await theme.click();
    await page.getByRole("option", { name: "macOS", exact: true }).click();
    await expect(theme).toContainText("macOS");
    await expect(page.getByRole("heading", { name: "Color mode", exact: true })).toBeVisible();
    await theme.click();
    await page.getByRole("option", { name: "System", exact: true }).click();
    await expect(theme).toContainText("System");
    await expect(page.getByRole("heading", { name: "Color mode", exact: true })).toHaveCount(0);
  },
};
