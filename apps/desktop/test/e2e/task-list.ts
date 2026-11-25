import { expect, type Locator, type Page } from "@playwright/test";

/** A row in the task column (and its peek or compact sheet). */
export const TASK_ROW = "[data-palot-task-row]";

/** The row of a task by its title; in a compact window, the sheet's copy comes last. */
export function taskRow(scope: Page | Locator, title: string | RegExp): Locator {
  return scope.locator(TASK_ROW).filter({ hasText: title });
}

/** The row of a task by its OpenCode session id. */
export function taskRowBySession(scope: Page | Locator, sessionID: string): Locator {
  return scope.locator(`${TASK_ROW}[data-session-id="${sessionID}"]`);
}

/** The task column, when it is shown. */
export function taskColumn(page: Page): Locator {
  return page.locator('[data-sidebar-presentation="column"][aria-hidden="false"]');
}

/** The rail's Tasks button. */
export function tasksRailButton(page: Page): Locator {
  return page.getByRole("button", { name: /^Show tasks/ });
}

/** Shows the task column when it is hidden. */
export async function showTaskColumn(page: Page): Promise<void> {
  const button = tasksRailButton(page);
  await expect(button).toBeVisible();
  if ((await button.getAttribute("aria-pressed")) !== "true") await button.click();
  await expect(button).toHaveAttribute("aria-pressed", "true");
}

/** Opens a closed section of the list (Working, Snoozed, Settled). */
export async function openTaskSection(
  scope: Page | Locator,
  name: "Working" | "Snoozed" | "Settled",
): Promise<void> {
  const section = scope.getByRole("treeitem", { name: new RegExp(`^${name}, \\d+$`) }).first();
  await section.waitFor();
  if ((await section.getAttribute("aria-expanded")) !== "true") await section.click();
  await expect(section).toHaveAttribute("aria-expanded", "true");
}

/** Opens the View menu and returns it. */
export async function openViewMenu(scope: Page | Locator, page: Page): Promise<Locator> {
  await scope.getByRole("button", { name: /^View/ }).first().click();
  const menu = page.getByRole("menu").last();
  await menu.waitFor();
  return menu;
}

/** Where a box's centre is. */
async function centre(locator: Locator): Promise<{ x: number; y: number }> {
  const box = await locator.boundingBox();
  if (!box) throw new Error("No box for the menu item");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Moves the pointer in a straight line, one frame at a time, the way a hand does. */
async function glide(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  const steps = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / 8));
  for (let step = 1; step <= steps; step++) {
    await page.mouse.move(
      from.x + ((to.x - from.x) * step) / steps,
      from.y + ((to.y - from.y) * step) / steps,
    );
    await page.waitForTimeout(16);
  }
}

/**
 * Chooses an entry of the View menu's "Projects and import" submenu with a real pointer path:
 * from the item above "Settle idle tasks", down across it to "Projects and import", then on a
 * diagonal into the submenu. Crossing "Settle idle tasks" must not leave its submenu open.
 */
export async function chooseProjectsMenuItem(
  scope: Page | Locator,
  page: Page,
  name: "Add project folder…" | "Import task…" | "Manage worktrees",
): Promise<void> {
  await openViewMenu(scope, page);
  // The View menu itself, not whichever menu opened last.
  const menu = page
    .getByRole("menu")
    .filter({ has: page.getByRole("menuitem", { name: "Projects and import", exact: true }) });
  const settle = menu.getByRole("menuitem", { name: "Settle idle tasks", exact: true });
  const trigger = menu.getByRole("menuitem", { name: "Projects and import", exact: true });
  const above = menu.getByRole("menuitem", { name: "Mark all as read", exact: true });
  // A short window scrolls the menu; bring the three rows into view first.
  await trigger.scrollIntoViewIfNeeded();
  await above.scrollIntoViewIfNeeded();
  const start = await centre(above);
  await page.mouse.move(start.x, start.y);
  const end = await centre(trigger);
  await glide(page, start, end);
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  await expect(settle).toHaveAttribute("aria-expanded", "false");
  const item = page
    .getByRole("menu")
    .filter({ hasNot: page.getByRole("menuitem", { name: "Projects and import", exact: true }) })
    .getByRole("menuitem", { name, exact: true });
  await glide(page, end, await centre(item));
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  await expect(settle).toHaveAttribute("aria-expanded", "false");
  await item.click();
}
