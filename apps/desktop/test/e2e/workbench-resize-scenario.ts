import { expect } from "@playwright/test";
import { join } from "node:path";
import type { Scenario } from "./scenarios.ts";

export const workbenchResizeScenario: Scenario = {
  description: "resize the right workbench without grabbing the transcript scrollbar",
  prompt: "Return a long response for the resizable workbench fixture.",
  expectedModelCalls: 1,
  arrange(llm) {
    llm.text(
      Array.from(
        { length: 120 },
        (_, index) => `Transcript line ${index + 1}: ${"content ".repeat(5)}`,
      ).join("\n\n"),
    );
  },
  async assert(page, { runRoot, client, session }) {
    await page.setViewportSize({ width: 1440, height: 850 });
    await page.getByText("Transcript line 120:", { exact: false }).waitFor();
    await page.getByRole("button", { name: "Show changes", exact: true }).click();
    const pane = page.getByRole("region", { name: "Right workbench", exact: true });
    await expect(pane).toBeVisible();
    await expect
      .poll(() =>
        page
          .locator('[data-shell-panel="bottom-workbench"]')
          .evaluate((element) => element.previousElementSibling?.getBoundingClientRect().height),
      )
      .toBe(0);

    const transcript = page.getByLabel("Task transcript", { exact: true });
    await expect
      .poll(() => transcript.evaluate((element) => element.scrollHeight - element.clientHeight))
      .toBeGreaterThan(100);
    const transcriptBounds = await transcript.boundingBox();
    if (!transcriptBounds) throw new Error("Transcript is not visible");
    await page.mouse.move(
      transcriptBounds.x + transcriptBounds.width / 2,
      transcriptBounds.y + transcriptBounds.height / 2,
    );
    await page.mouse.wheel(0, -1200);
    await expect(transcript).toHaveAttribute("data-bottom-locked", "false");
    await transcript.evaluate((element) => {
      element.scrollTop = (element.scrollHeight - element.clientHeight) / 2;
    });
    const panel = page.locator('[data-shell-panel="right-workbench"]');
    const separator = page.locator('[data-shell-panel="center"] + [data-slot="resizable-handle"]');
    const bounds = await separator.boundingBox();
    if (!bounds) throw new Error("Right workbench separator is not visible");

    // A few pixels to the transcript side of the line must still belong to the
    // divider, not the adjacent scrollport or its overlaid scrollbar.
    const x = bounds.x + bounds.width / 2 - 3;
    const y = bounds.y + bounds.height / 2;
    const hitSeparator = await separator.evaluate(
      (element, point) => element === document.elementFromPoint(point.x, point.y),
      { x, y },
    );
    await page.screenshot({ path: join(runRoot, "workbench-resize-before.png") });
    const width = (await panel.boundingBox())!.width;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x - 100, y, { steps: 8 });
    await page.mouse.up();
    expect(hitSeparator).toBe(true);
    await expect.poll(async () => (await panel.boundingBox())!.width).toBeGreaterThan(width + 60);
    await transcript.evaluate((viewport) => {
      viewport.scrollTop = viewport.scrollHeight;
    });
    await expect(transcript.getByText("Transcript line 120:", { exact: false })).toBeInViewport();
    await page.screenshot({ path: join(runRoot, "workbench-resize-after.png") });
    const wider = (await separator.boundingBox())!;
    await page.mouse.move(wider.x + wider.width / 2 + 3, y);
    await page.mouse.down();
    await page.mouse.move(wider.x + wider.width / 2 + 93, y, { steps: 8 });
    await page.mouse.up();
    await expect.poll(async () => (await panel.boundingBox())!.width).toBeLessThan(width + 40);

    await page.setViewportSize({ width: 1040, height: 850 });
    await expect
      .poll(() => panel.evaluate((element) => element.getBoundingClientRect().width))
      .toBe(0);
    await expect(page.locator('[data-shell-panel="right-workbench-sheet"]')).toHaveCount(0);
    await page.getByRole("button", { name: "Show changes" }).click();
    await expect(pane).toBeVisible();
    await expect
      .poll(() => panel.evaluate((element) => element.getBoundingClientRect().width))
      .toBeGreaterThan(290);

    const center = page.locator('[data-shell-panel="center"]');
    const navigation = page.locator('[data-shell-panel="navigation"]');
    const navigationWidth = await navigation.evaluate(
      (element) => element.getBoundingClientRect().width,
    );
    await page.getByRole("button", { name: "Expand right workbench" }).click();
    await expect(page.getByRole("button", { name: "Hide navigation" })).toBeVisible();
    await expect
      .poll(() => center.evaluate((element) => element.getBoundingClientRect().width))
      .toBe(0);
    await expect
      .poll(async () => (await navigation.boundingBox())!.width)
      .toBeCloseTo(navigationWidth, 0);
    await expect
      .poll(() => panel.evaluate((element) => element.getBoundingClientRect().width))
      .toBeGreaterThan(1040 - navigationWidth - 16);
    await page.screenshot({ path: join(runRoot, "workbench-fullscreen.png") });

    await page.getByRole("button", { name: "Hide navigation" }).click();
    await expect(page.getByRole("button", { name: "Show navigation" })).toBeVisible();
    await expect
      .poll(() => center.evaluate((element) => element.getBoundingClientRect().width))
      .toBe(0);
    await page.getByRole("button", { name: "Show navigation" }).click();
    await expect(page.getByRole("button", { name: "Hide navigation" })).toBeVisible();
    await expect
      .poll(() => center.evaluate((element) => element.getBoundingClientRect().width))
      .toBe(0);

    await page.getByRole("button", { name: "Restore right workbench" }).click();
    await expect
      .poll(() => center.evaluate((element) => element.getBoundingClientRect().width))
      .toBeGreaterThanOrEqual(360);
    await expect(pane).toBeVisible();
    await page.setViewportSize({ width: 1440, height: 850 });
    await page.setViewportSize({ width: 1040, height: 850 });
    await expect
      .poll(() => panel.evaluate((element) => element.getBoundingClientRect().width))
      .toBe(0);

    // Fullscreen belongs to the current task. A different task that was open at
    // wide width must still auto-close when first visited at narrow width.
    const other = await client.session.create({ location: session.location });
    await client.session.update({ sessionID: other.id, title: "Other right pane" });
    await page.setViewportSize({ width: 1440, height: 850 });
    await page.evaluate((id) => {
      location.hash = `#/sessions/${id}`;
    }, other.id);
    await expect(page.locator(".thread-header")).toContainText("Other right pane");
    await page.getByRole("button", { name: "Show changes" }).click();
    await expect
      .poll(() => panel.evaluate((element) => element.getBoundingClientRect().width))
      .toBeGreaterThan(290);
    await page.evaluate((id) => {
      location.hash = `#/sessions/${id}`;
    }, session.id);
    await expect(page.locator(".thread-header")).toContainText("Palot E2E: workbench-resize");
    await page.setViewportSize({ width: 1040, height: 850 });
    await page.getByRole("button", { name: "Show changes" }).click();
    await page.getByRole("button", { name: "Expand right workbench" }).click();
    await expect
      .poll(() => center.evaluate((element) => element.getBoundingClientRect().width))
      .toBe(0);
    await page.evaluate((id) => {
      location.hash = `#/sessions/${id}`;
    }, other.id);
    await expect(page.locator(".thread-header")).toContainText("Other right pane");
    await expect
      .poll(() => panel.evaluate((element) => element.getBoundingClientRect().width))
      .toBe(0);
    await expect
      .poll(() => center.evaluate((element) => element.getBoundingClientRect().width))
      .toBeGreaterThanOrEqual(360);
  },
};
