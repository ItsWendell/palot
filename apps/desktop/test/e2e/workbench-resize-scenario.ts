import { expect, type Page } from "@playwright/test";
import { writeFile } from "node:fs/promises";
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
  async prepareProject({ projectDirectory }) {
    await writeFile(join(projectDirectory, "changed.ts"), "export const changed = true;\n");
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

    // The separator is the 1px line; its pointer hit area is the library's, over the
    // neighbouring panes. A few pixels to the transcript side, above the scrollport and
    // its overlaid scrollbar, must still grab the divider rather than the scrollbar.
    const x = bounds.x + bounds.width / 2 - 3;
    const y = bounds.y + bounds.height / 2;
    await page.screenshot({ path: join(runRoot, "workbench-resize-before.png") });
    const width = (await panel.boundingBox())!.width;
    await page.mouse.move(x, y);
    await expect(separator).toHaveAttribute("data-separator", "hover");
    await page.mouse.down();
    await expect(separator).toHaveAttribute("data-separator", "active");
    await page.mouse.move(x - 100, y, { steps: 8 });
    await page.mouse.up();
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

    // A second toggle during the closing animation must reverse it, not be lost.
    const rightToggle = page.getByRole("button", {
      name: /^(Show changes|Hide right workbench)$/,
    });
    await rightToggle.click();
    await rightToggle.click();
    await expect(rightToggle).toHaveAttribute("aria-pressed", "true");
    await expect(pane).toBeVisible();
    await expect
      .poll(() => panel.evaluate((element) => element.getBoundingClientRect().width))
      .toBeGreaterThan(290);

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
    const { width: navigationWidth, right: navigationRight } = await navigation.evaluate(
      (element) => element.getBoundingClientRect().toJSON() as DOMRect,
    );
    await page.getByRole("button", { name: "Expand right workbench" }).click();
    await expect(page.getByRole("button", { name: "Hide navigation" })).toBeVisible();
    await expect
      .poll(() => center.evaluate((element) => element.getBoundingClientRect().width))
      .toBe(0);
    await expect
      .poll(async () => (await navigation.boundingBox())!.width)
      .toBeCloseTo(navigationWidth, 0);
    // The navigation rail sits left of the navigation panel, so measure from its right edge.
    await expect
      .poll(() => panel.evaluate((element) => element.getBoundingClientRect().width))
      .toBeGreaterThan(1040 - navigationRight - 16);
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

    await assertWorkspaceHeaderInsets(page, runRoot);
    await assertChangesFitWithTaskList(page, runRoot);
  },
};

/**
 * At the minimum window size the task list, transcript and Changes pane all stay on screen
 * when Changes is opened with the task list showing.
 */
async function assertChangesFitWithTaskList(page: Page, runRoot: string) {
  const panel = page.locator('[data-shell-panel="right-workbench"]');
  const layout = () =>
    page.evaluate(() => {
      const box = (name: string) =>
        document.querySelector(`[data-shell-panel="${name}"]`)!.getBoundingClientRect();
      const navigation = box("navigation");
      const center = box("center");
      const right = box("right-workbench");
      return {
        innerWidth,
        navigation: navigation.width,
        center: center.width,
        centerLeft: center.left,
        navigationRight: navigation.right,
        right: right.width,
        rightEdge: right.right,
      };
    });
  for (const viewport of [
    { width: 920, height: 640 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    const navigation = page.getByRole("button", { name: /^(Show|Hide) navigation$/ });
    if ((await navigation.getAttribute("aria-pressed")) !== "true") await navigation.click();
    const changes = page.getByRole("button", { name: /^(Show changes|Hide right workbench)$/ });
    if ((await changes.getAttribute("aria-pressed")) !== "true") await changes.click();
    await expect(page.getByRole("region", { name: "Right workbench", exact: true })).toBeVisible();
    await expect
      .poll(() => panel.evaluate((element) => element.getBoundingClientRect().width))
      .toBeGreaterThan(290);
    await expect
      .poll(async () => {
        const box = await layout();
        return (
          box.navigation >= 200 &&
          box.center >= 240 &&
          box.centerLeft >= box.navigationRight - 1 &&
          box.right >= 290 &&
          box.rightEdge <= box.innerWidth + 1
        );
      })
      .toBe(true);
    await page.screenshot({ path: join(runRoot, `changes-with-task-list-${viewport.width}.png`) });
  }
}

export async function assertWorkspaceHeaderInsets(page: Page, runRoot: string) {
  const inheritedInsets = await page
    .getByLabel("Task transcript", { exact: true })
    .evaluate((element) => {
      const style = getComputedStyle(element);
      return [
        style.getPropertyValue("--thread-header-leading-inset"),
        style.getPropertyValue("--thread-header-trailing-inset"),
      ];
    });
  expect(inheritedInsets).toEqual(["", ""]);
  for (const viewport of [
    { width: 920, height: 640 },
    { width: 1440, height: 850 },
  ]) {
    await page.setViewportSize(viewport);
    for (const navigationOpen of [false, true]) {
      const toggle = page.getByRole("button", { name: /^(Show|Hide) navigation$/ });
      if ((await toggle.getAttribute("aria-pressed")) !== String(navigationOpen)) {
        await toggle.click();
      }
      await expect
        .poll(() =>
          page.locator(".thread-header").evaluate((header) => {
            const center = document.querySelector('[data-shell-panel="center"]')!;
            const chrome = document.querySelector(".window-chrome-cluster")!;
            const trailing = document.querySelector(".window-trailing-controls")!;
            const style = getComputedStyle(header);
            return Math.max(
              Math.abs(
                parseFloat(style.paddingLeft) -
                  Math.max(
                    18,
                    chrome.getBoundingClientRect().right - center.getBoundingClientRect().left + 12,
                  ),
              ),
              Math.abs(
                parseFloat(style.paddingRight) -
                  Math.max(
                    12,
                    center.getBoundingClientRect().right -
                      trailing.getBoundingClientRect().left +
                      12,
                  ),
              ),
            );
          }),
        )
        .toBeLessThan(1);
      await page.screenshot({
        path: join(runRoot, `header-${viewport.width}-${navigationOpen ? "open" : "closed"}.png`),
      });
    }
  }
}
