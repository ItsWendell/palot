import { expect } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Scenario } from "./scenarios.ts";

export const sessionWindowDragScenario: Scenario = {
  description: "drag a sidebar session outside to open a native window, with cancellation",
  prompt: "Return the session drag verification response.",
  expectedModelCalls: 1,
  arrange(llm) {
    llm.text("Session drag ready.");
  },
  async assert(page, { session, runRoot, client }) {
    // Keep native pointer/focus evidence even when no child page is created.
    // A timeout alone cannot distinguish a cancelled gesture from IPC failure.
    await page.evaluate(() => {
      const events: object[] = [];
      Reflect.set(window, "__sessionDragEvents", events);
      for (const type of [
        "pointerdown",
        "pointermove",
        "pointerup",
        "pointercancel",
        "gotpointercapture",
        "lostpointercapture",
        "blur",
        "focus",
        "keydown",
      ]) {
        window.addEventListener(
          type,
          (event) => {
            if (events.length >= 500) return;
            const pointer = event instanceof PointerEvent ? event : undefined;
            const target = event.target instanceof Element ? event.target : undefined;
            events.push({
              type,
              time: performance.now(),
              pointerID: pointer?.pointerId,
              buttons: pointer?.buttons,
              x: pointer?.clientX,
              y: pointer?.clientY,
              key: event instanceof KeyboardEvent ? event.key : undefined,
              target: target?.getAttribute("data-session-drag-handle") ?? target?.tagName,
              captured: pointer && target?.hasPointerCapture(pointer.pointerId),
              focused: document.hasFocus(),
              hint: document.querySelector("[data-session-window-drag-hint]")?.textContent,
            });
          },
          true,
        );
      }
    });
    try {
      await expect(page.getByText("Session drag ready.", { exact: true })).toBeVisible();
      const other = await client.session.create({ location: session.location });
      await client.session.rename({ sessionID: other.id, title: "Other current task" });
      await page.evaluate((id) => {
        location.hash = `#/sessions/${id}`;
      }, other.id);
      await expect(page.locator(".thread-header")).toContainText("Other current task");
      // Compact native windows show navigation in a sheet; both layouts should work.
      const show = page.getByRole("button", { name: "Show navigation", exact: true });
      if (await show.count()) await show.click();
      const row = page.locator(`[data-session-drag-handle="${session.id}"]:visible`).first();
      const hint = page.locator("[data-session-window-drag-hint]");
      await expect(row).toBeVisible();
      const originalURL = page.url();
      const count = page.context().pages().length;
      const begin = async () => {
        const box = (await row.boundingBox())!;
        const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
        await page.mouse.move(point.x, point.y);
        await page.mouse.down();
        await page.mouse.move(point.x + 20, point.y, { steps: 3 });
        await expect(hint).toContainText("Drag outside");
        return point;
      };
      await begin();
      await page.mouse.up();
      await expect(hint).toHaveCount(0);
      expect(page.context().pages()).toHaveLength(count);
      const point = await begin();
      await page.mouse.move(-25, point.y, { steps: 5 });
      await expect(hint).toContainText("Release to open");
      await page.keyboard.press("Escape");
      await page.mouse.up();
      await expect(hint).toHaveCount(0);
      expect(page.context().pages()).toHaveLength(count);
      // Reopen a compact sheet if Escape also dismissed it.
      if (await show.count()) await show.click();
      const release = await begin();
      await page.screenshot({ path: join(runRoot, "session-drag-hint.png") });
      await page.mouse.move(-25, release.y, { steps: 5 });
      await expect(hint).toContainText("Release to open");
      const [child] = await Promise.all([page.context().waitForEvent("page"), page.mouse.up()]);
      await child.waitForLoadState("domcontentloaded");
      expect(child.url()).toContain(session.id);
      await expect(child.getByText("Session drag ready.", { exact: true })).toBeVisible();
      expect(child.url()).toContain(session.id);
      expect(page.url()).toBe(originalURL);
      await child.screenshot({ path: join(runRoot, "dragged-session-window.png") });
      const closed = child.waitForEvent("close");
      await child.evaluate(() => {
        void Reflect.get(window, "palot").closeWindow();
      });
      await closed;
      expect(page.context().pages()).toHaveLength(count);
      // The accessible, non-drag alternative must open the same session without
      // selecting it in the source window, including after a completed drag.
      if (!(await row.isVisible()) && (await show.count())) await show.click();
      await row.click({ button: "right" });
      const [menuChild] = await Promise.all([
        page.context().waitForEvent("page"),
        page.getByRole("menuitem", { name: "Open in new window", exact: true }).click(),
      ]);
      await expect(menuChild.getByText("Session drag ready.", { exact: true })).toBeVisible();
      expect(menuChild.url()).toContain(session.id);
      expect(page.url()).toBe(originalURL);
      const menuClosed = menuChild.waitForEvent("close");
      await menuChild.evaluate(() => {
        void Reflect.get(window, "palot").closeWindow();
      });
      await menuClosed;
      expect(page.context().pages()).toHaveLength(count);
    } finally {
      if (!page.isClosed()) {
        await writeFile(
          join(runRoot, "session-drag-events.json"),
          JSON.stringify(
            await page.evaluate(() => Reflect.get(window, "__sessionDragEvents")),
            null,
            2,
          ),
        );
      }
    }
  },
};
