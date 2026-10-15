import { expect, type Page } from "@playwright/test";
import { readFile, realpath } from "node:fs/promises";
import { join } from "node:path";
import type { Scenario } from "./scenarios.ts";

const TITLE = "Palot E2E: project-scripts";
const SCRIPT = "Settle marker";
const MARKER = "settle-script-ran.txt";
const COMMAND = `printf 'settled\\n' >> ${MARKER}; echo "ran in $PWD"`;

async function markerLines(directory: string): Promise<number> {
  try {
    return (await readFile(join(directory, MARKER), "utf8")).split("\n").filter(Boolean).length;
  } catch {
    return 0;
  }
}

async function showProjects(page: Page) {
  const navigation = page.locator('[data-shell-surface="navigation"][aria-hidden="false"]');
  const toggle = page.getByRole("button", { name: /^(Show|Hide) navigation$/ });
  await expect(toggle).toBeVisible();
  if ((await toggle.getAttribute("aria-pressed")) !== "true") await toggle.click();
  // Column views live on the rail, outside the task column; the active view toggles it.
  const projects = page.getByRole("button", { name: "Show projects", exact: true });
  if ((await projects.getAttribute("aria-pressed")) !== "true") await projects.click();
  return navigation;
}

/**
 * Worktrees opens on the current task's project; a project script configured in settings runs
 * once in the task's directory when the row's Settle quick action settles it, not on replay.
 */
export const projectScriptsScenario: Scenario = {
  description:
    "default Worktrees to the task's project, then run a configured script once when a task settles from its row",
  prompt: "",
  expectedModelCalls: 0,
  arrange() {},
  async run(page, { session, projectDirectory, runRoot }) {
    // The task's own project: OpenCode identifies the git fixture by its repository, which
    // can differ from a bare directory lookup.
    const project = { id: session.projectID };

    // Worktrees from the rail opens on the open task's project instead of asking for one.
    await page.evaluate((id) => {
      location.hash = `#/sessions/${id}`;
    }, session.id);
    await page.getByRole("button", { name: "Worktrees", exact: true }).first().click();
    await expect
      .poll(() => new URL(page.url()).hash)
      .toContain(`projectID=${encodeURIComponent(project.id)}`);
    await expect(page.getByText("Main checkout", { exact: true })).toBeVisible();
    await expect(page.getByText("Select a project", { exact: true })).toHaveCount(0);

    // Configure the script; settings show the exact command.
    await page.evaluate((projectID) => {
      location.hash = `#/settings/project?projectID=${encodeURIComponent(projectID)}`;
    }, project.id);
    await page.getByRole("button", { name: "Add script", exact: true }).click();
    await page.getByLabel("Script name", { exact: true }).fill(SCRIPT);
    await page.getByLabel("Command", { exact: true }).fill(COMMAND);
    await page.getByRole("button", { name: "Save script", exact: true }).click();
    await expect(page.getByRole("group", { name: "Command" })).toContainText(COMMAND);
    await page.screenshot({ path: join(runRoot, "project-scripts-settings.png") });
    expect(await markerLines(projectDirectory)).toBe(0);

    // Settle from the project row by keyboard.
    await page.evaluate((id) => {
      location.hash = `#/sessions/${id}`;
    }, session.id);
    const navigation = await showProjects(page);
    const row = navigation.locator("[data-palot-task-row]").filter({ hasText: TITLE }).first();
    await row.getByRole("button", { name: new RegExp(TITLE) }).focus();
    await page.keyboard.press("Tab");
    const settle = row.getByRole("button", { name: "Settle task", exact: true });
    await expect(settle).toBeFocused();
    await page.screenshot({ path: join(runRoot, "project-scripts-row-actions.png") });
    await page.keyboard.press("Enter");

    await expect(page.getByText(`Ran “${SCRIPT}” after settling: passed`)).toBeVisible();
    await expect.poll(() => markerLines(projectDirectory)).toBe(1);
    await page.getByRole("button", { name: "View output", exact: true }).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByLabel("Script output")).toContainText(
      `ran in ${await realpath(projectDirectory)}`,
    );
    await page.screenshot({ path: join(runRoot, "project-scripts-output.png") });
    await page.keyboard.press("Escape");

    // Unsettle and settle again without new activity: the same settlement does not rerun.
    await expect(row).toHaveAttribute("data-palot-triage-section", "settled");
    await row.getByRole("button", { name: "Unsettle task", exact: true }).click();
    await expect(row).toHaveAttribute("data-palot-triage-section", "inbox");
    await row.hover();
    await row.getByRole("button", { name: "Settle task", exact: true }).click();
    await expect(row).toHaveAttribute("data-palot-triage-section", "settled");
    await page.waitForTimeout(1_500);
    expect(await markerLines(projectDirectory)).toBe(1);
  },
  async assert(page) {
    await expect(
      page.getByRole("button", { name: "Worktrees", exact: true }).first(),
    ).toBeVisible();
  },
};
