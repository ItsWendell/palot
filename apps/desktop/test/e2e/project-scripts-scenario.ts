import { expect } from "@playwright/test";
import { readFile, realpath } from "node:fs/promises";
import { join } from "node:path";
import type { Scenario } from "./scenarios.ts";
import { openTaskSection, showTaskColumn, taskColumn, taskRow } from "./task-list.ts";

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

    // Settle from the task's row by keyboard (E on the focused row).
    await page.evaluate((id) => {
      location.hash = `#/sessions/${id}`;
    }, session.id);
    await showTaskColumn(page);
    const navigation = taskColumn(page);
    const row = taskRow(navigation, TITLE).first();
    await row.focus();
    await expect(row).toBeFocused();
    await expect(row.getByRole("button", { name: "Settle", exact: true })).toBeVisible();
    await page.screenshot({ path: join(runRoot, "project-scripts-row-actions.png") });
    await page.keyboard.press("e");

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
    await openTaskSection(navigation, "Settled");
    await expect(row).toHaveAttribute("data-placement", "settled");
    await row.hover();
    await row.getByRole("button", { name: "Move back", exact: true }).click();
    await expect(row).not.toHaveAttribute("data-placement", "settled");
    await row.hover();
    await row.getByRole("button", { name: "Settle", exact: true }).click();
    await expect(row).toHaveAttribute("data-placement", "settled");
    await page.waitForTimeout(1_500);
    expect(await markerLines(projectDirectory)).toBe(1);
  },
  async assert(page) {
    await expect(
      page.getByRole("button", { name: "Worktrees", exact: true }).first(),
    ).toBeVisible();
  },
};
