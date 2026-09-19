import { expect } from "@playwright/test";
import { join } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Scenario } from "./scenarios.ts";

export const compactWindowsScenario: Scenario = {
  description: "compact composer, overflow tabs, and independent native chat windows",
  prompt: "Return the compact workspace verification response.",
  expectedModelCalls: 1,
  arrange(llm) {
    llm.text("Compact workspace ready.");
  },
  async prepare(home) {
    await writeFile(
      join(home, "../palot-user-data/appearance.json"),
      JSON.stringify({
        preferences: { linuxBackgroundOpacity: 85 },
      }),
    );
  },
  async assert(page, { runRoot, session, client }) {
    await expect(page.getByText("Compact workspace ready.", { exact: true })).toBeVisible();
    const sessionURL = page.url();
    await page.evaluate(() => {
      location.hash = "#/new";
    });
    await expect(page.locator("[data-palot-new-task]")).toBeVisible();
    const fits = () =>
      page.evaluate(() => {
        const composer = document.querySelector(".palot-composer-shell")!.getBoundingClientRect();
        const close = document
          .querySelector('[aria-label="Close window"]')
          ?.getBoundingClientRect();
        return (
          composer.left >= 0 &&
          composer.right <= innerWidth + 1 &&
          (!close || close.right <= innerWidth + 1)
        );
      });
    // Optional native compositor test: resize only this run's owned window, never
    // the focused window. Viewport emulation cannot catch native minimum-size clipping.
    if (process.env.PALOT_E2E_HYPRLAND_NATIVE_SIZE === "1") {
      const run = JSON.parse(await readFile(join(runRoot, "instance.json"), "utf8"));
      const pid = run.processes.find(
        (process: { name: string }) => process.name === "electron",
      )?.pid;
      if (!Number.isInteger(pid)) throw new Error("Missing owned Electron PID");
      const exec = promisify(execFile);
      const clients = async () =>
        JSON.parse((await exec("hyprctl", ["clients", "-j"])).stdout) as {
          pid: number;
          address: string;
          floating: boolean;
          size: number[];
        }[];
      const target = (await clients()).find((window) => window.pid === pid);
      if (!target) throw new Error("Owned Electron window is not visible in Hyprland");
      const selector = `address:${target.address}`;
      if (!target.floating)
        await exec("hyprctl", [
          "dispatch",
          `hl.dsp.window.float({ window = ${JSON.stringify(selector)}, action = "toggle" })`,
        ]);
      for (const width of [310, 420, 560, 632]) {
        await exec("hyprctl", [
          "dispatch",
          `hl.dsp.window.resize({ window = ${JSON.stringify(selector)}, x = ${width}, y = 720 })`,
        ]);
        await expect
          .poll(async () => {
            const native = (await clients()).find((window) => window.pid === pid)!;
            const rendered = await page.evaluate(() => innerWidth);
            return Math.max(
              Math.abs(rendered - native.size[0]!),
              Math.abs(native.size[0]! - width),
            );
          })
          .toBeLessThanOrEqual(2);
        await expect.poll(fits).toBe(true);
        await page.screenshot({ path: join(runRoot, `new-task-native-${width}.png`) });
      }
      // Restore the native surface before larger viewport/interaction tests so
      // Playwright doesn't send pointer events outside the actual window.
      await exec("hyprctl", [
        "dispatch",
        `hl.dsp.window.resize({ window = ${JSON.stringify(selector)}, x = 1280, y = 920 })`,
      ]);
      await expect.poll(() => page.evaluate(() => innerWidth)).toBeGreaterThanOrEqual(1280);
    }
    for (const width of [310, 420, 560, 632, 720]) {
      await page.setViewportSize({ width, height: 720 });
      await expect.poll(fits).toBe(true);
      await page.screenshot({ path: join(runRoot, `new-task-${width}.png`) });
    }
    await page.goto(sessionURL);
    await expect(page.getByText("Compact workspace ready.", { exact: true })).toBeVisible();
    await expect(page.locator("[data-palot-transcript-state]")).toHaveAttribute(
      "data-palot-transcript-state",
      "visible",
    );
    const input = page.getByRole("textbox", { name: "Message Palot", exact: true });
    const bounds = () =>
      page.evaluate(() => {
        const dock = document.querySelector("[data-palot-composer-dock]")!.getBoundingClientRect();
        const footer = document.querySelector(".palot-composer-context")!.getBoundingClientRect();
        const input = document.querySelector("[data-palot-composer-input]")!;
        return {
          dockTop: dock.top,
          footerBottom: footer.bottom,
          height: window.innerHeight,
          inputHeight: input.getBoundingClientRect().height,
          lineHeight: parseFloat(getComputedStyle(input).lineHeight),
        };
      });
    for (const [width, height] of [
      [310, 480],
      [640, 480],
      [960, 540],
      [1280, 720],
    ]) {
      await page.setViewportSize({ width: width!, height: height! });
      await input.fill("");
      await expect.poll(async () => (await bounds()).inputHeight).toBeLessThan(55);
      await input.fill(Array.from({ length: 30 }, (_, i) => `Draft line ${i + 1}`).join("\n"));
      await expect
        .poll(async () => {
          const box = await bounds();
          return box.footerBottom <= box.height + 1 && box.dockTop >= 44 && box.inputHeight <= 176;
        })
        .toBe(true);
      await expect(page.getByRole("button", { name: "Send message", exact: true })).toBeVisible();
      await input.fill("One compact line");
      await expect.poll(async () => (await bounds()).inputHeight).toBeLessThan(55);
      await expect(page.getByText("Compact workspace ready.", { exact: true })).toBeInViewport();
      await page.screenshot({ path: join(runRoot, `compact-${width}-${height}.png`) });
    }
    await page.setViewportSize({ width: 640, height: 480 });
    for (const mode of ["dark", "light"] as const) {
      await page.evaluate(async (mode) => {
        const api = Reflect.get(window, "palot");
        await api.updateAppearance({
          preferences: {
            ...api.appearancePreferences,
            mode,
            uiFontSize: 18,
            darkContrast: 100,
            lightContrast: 100,
          },
          resolvedScheme: mode,
        });
      }, mode);
      await input.fill("Larger interface text\nSecond line\nThird line");
      await expect
        .poll(async () => (await bounds()).footerBottom <= (await bounds()).height + 1)
        .toBe(true);
      await page.screenshot({ path: join(runRoot, `compact-${mode}-large-type.png`) });
    }
    await page.evaluate(async () => {
      const api = Reflect.get(window, "palot");
      await api.updateAppearance({
        preferences: { ...api.appearancePreferences, mode: "light", uiFontSize: 14 },
        resolvedScheme: "light",
      });
    });
    await page.setViewportSize({ width: 1280, height: 720 });
    await input.fill("");
    await expect(page.getByRole("button", { name: "Previous user turn" })).toHaveCount(0);
    await page.getByRole("button", { name: "Task actions", exact: true }).click();
    await expect(page.getByRole("menuitem", { name: "Previous user turn" })).toBeVisible();
    await page.getByRole("menuitem", { name: "Prompt timeline", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Prompt timeline", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: "Show changes", exact: true }).click();
    const pane = page.getByRole("region", { name: "Right workbench", exact: true });
    for (let i = 0; i < 4; i++) {
      await pane.getByRole("button", { name: "Open workbench surface", exact: true }).click();
      await page.getByRole("menuitem", { name: "Terminal", exact: true }).click();
      // Terminal initialization focuses its input asynchronously. Let that finish
      // before opening another menu, otherwise it dismisses the next popup.
      await expect
        .poll(() =>
          pane.evaluate((element) => {
            const active = document.activeElement?.closest("[data-workbench-terminal]");
            return Boolean(active && element.contains(active) && active.getClientRects().length);
          }),
        )
        .toBe(true);
    }
    const tabs = pane.getByRole("tablist");
    await expect.poll(() => tabs.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
    const plus = pane.getByRole("button", { name: "Open workbench surface", exact: true });
    const before = await plus.boundingBox();
    await tabs.evaluate((el) => {
      el.scrollLeft = 0;
    });
    expect((await plus.boundingBox())!.x).toBeCloseTo(before!.x, 0);
    await tabs.getByRole("tab").last().focus();
    await expect.poll(() => tabs.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
    await page.screenshot({ path: join(runRoot, "compact-overflow-tabs.png") });
    await page.getByRole("button", { name: "Hide right workbench", exact: true }).click();

    const originalURL = page.url();
    await input.fill("Shared draft before opening");
    const created = page.context().waitForEvent("page");
    await page.getByRole("button", { name: "Task actions", exact: true }).click();
    await page.getByRole("menuitem", { name: "Open in new window", exact: true }).click();
    const child = await created;
    await expect(child.getByText("Compact workspace ready.", { exact: true })).toBeVisible();
    expect(child.url()).toContain(session.id);
    expect(page.url()).toBe(originalURL);
    const childInput = child.getByRole("textbox", { name: "Message Palot", exact: true });
    await expect(childInput).toHaveValue("Shared draft before opening");
    await childInput.fill("Edited in the second window");
    await expect(input).toHaveValue("Edited in the second window");
    await input.fill("");
    await expect(childInput).toHaveValue("");
    await client.session.update({ sessionID: session.id, title: "Shared chat in two windows" });
    await expect(child.locator(".thread-header")).toContainText("Shared chat in two windows");
    await expect(page.locator(".thread-header")).toContainText("Shared chat in two windows");
    await expect(child).toHaveTitle("Shared chat in two windows");
    await expect(page).toHaveTitle("Shared chat in two windows");
    await child.screenshot({ path: join(runRoot, "separate-chat-window.png") });
    // Closing a secondary window must not quit the app or invalidate the primary's IPC.
    const closed = child.waitForEvent("close");
    if (await child.getByRole("button", { name: "Close window", exact: true }).count())
      await child.getByRole("button", { name: "Close window", exact: true }).click();
    else
      await child.evaluate(() => {
        void Reflect.get(window, "palot").closeWindow();
      });
    await closed;
    expect(
      await page.evaluate(
        async () => (await Reflect.get(window, "palot").runtimeStatus()).connected,
      ),
    ).toBe(true);
    await expect(page.getByText("Compact workspace ready.", { exact: true })).toBeVisible();
    // Also exercise closing the original main window, with another workspace remaining.
    const next = page.context().waitForEvent("page");
    await page.evaluate(
      async (id) => Reflect.get(window, "palot").openSessionWindow(id),
      session.id,
    );
    const remaining = await next;
    await expect(remaining.getByText("Compact workspace ready.", { exact: true })).toBeVisible();
    const primaryClosed = page.waitForEvent("close");
    await page.evaluate(() => {
      void Reflect.get(window, "palot").closeWindow();
    });
    await primaryClosed;
    expect(
      await remaining.evaluate(
        async () => (await Reflect.get(window, "palot").runtimeStatus()).connected,
      ),
    ).toBe(true);
    await expect(
      remaining.getByRole("textbox", { name: "Message Palot", exact: true }),
    ).toBeVisible();
    await remaining.screenshot({ path: join(runRoot, "surviving-chat-window.png") });
  },
};
