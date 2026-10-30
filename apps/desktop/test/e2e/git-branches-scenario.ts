import { expect, type Locator, type Page } from "@playwright/test";
import { execFile } from "node:child_process";
import { access, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { gitPrScenario } from "./git-pr-scenario.ts";
import type { Scenario } from "./scenarios.ts";

const exec = promisify(execFile);

async function narrowScreenshot(page: Page, runRoot: string, name: string, control: Locator) {
  const viewport = page.viewportSize();
  const appearance = await page.evaluate(() => ({
    preferences: window.palot.appearancePreferences,
    resolvedScheme:
      document.documentElement.dataset.resolvedTheme === "dark"
        ? ("dark" as const)
        : ("light" as const),
  }));
  await page.setViewportSize({ width: 920, height: 640 });
  await page.evaluate(async (preferences) => {
    await window.palot.updateAppearance({
      preferences: { ...preferences, mode: "dark", darkContrast: 100, uiFontSize: 18 },
      resolvedScheme: "dark",
    });
  }, appearance.preferences);
  await expect(page.locator("html")).toHaveAttribute("data-resolved-theme", "dark");
  await expect(control).toBeInViewport();
  await page.screenshot({ path: join(runRoot, `git-branches-${name}-narrow-dark.png`) });
  await page.evaluate(async (appearance) => {
    await window.palot.updateAppearance(appearance);
  }, appearance);
  if (viewport) await page.setViewportSize(viewport);
}

export const gitBranchesScenario: Scenario = {
  description:
    "create/switch branches, edit a PR and toggle auto-merge against fake GitHub, safely retire a merged managed worktree",
  prompt: "",
  expectedModelCalls: 0,
  arrange() {},
  async prepareProject(context) {
    await gitPrScenario.prepareProject!(context);
    const git = (...args: string[]) => exec("git", ["-C", context.projectDirectory, ...args]);
    await git("add", "feature.txt");
    await git("commit", "-m", "Fixture feature");
    await git("push", "-u", "origin", "feature");
    const { stdout } = await git("rev-parse", "HEAD");
    await writeFile(
      join(context.runRoot, "github-state.json"),
      JSON.stringify({ created: true, oid: stdout.trim() }),
    );
  },
  async run(page, { client, session, projectDirectory, runRoot }) {
    const picker = page
      .locator(".thread-header")
      .getByRole("button", { name: "Change branch", exact: true });
    await picker.click();
    await page.getByRole("button", { name: "Create branch…", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Create branch", exact: true });
    await dialog
      .getByRole("textbox", { name: "Branch name", exact: true })
      .fill("palot/branch-test");
    await dialog.getByRole("button", { name: "Create branch", exact: true }).click();
    await expect(picker).toContainText("palot/branch-test");
    await page.screenshot({ path: join(runRoot, "git-branches-created.png") });
    await narrowScreenshot(page, runRoot, "created", picker);
    await picker.click();
    await page.getByRole("option", { name: "feature", exact: true }).click();
    await expect(picker).toContainText("feature");
    await page.evaluate(() => {
      location.hash = "/pull-requests?pr=github.com/palot-e2e/fixture/7";
    });
    await page.getByRole("button", { name: "Edit title and description", exact: true }).click();
    const edit = page.getByRole("dialog", { name: "Edit pull request", exact: true });
    await edit
      .getByRole("textbox", { name: "Pull request title", exact: true })
      .fill("Edited fixture title");
    await edit
      .getByRole("textbox", { name: "Pull request description", exact: true })
      .fill("Edited fixture description");
    await edit.getByRole("button", { name: "Save pull request", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Edited fixture title #7", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Enable auto-merge", exact: true }).click();
    await page.getByRole("button", { name: "Confirm enable auto-merge", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Disable auto-merge", exact: true }),
    ).toBeVisible();
    await page.screenshot({ path: join(runRoot, "git-branches-pr.png") });
    await narrowScreenshot(
      page,
      runRoot,
      "pr",
      page.getByRole("button", { name: "Edit title and description", exact: true }),
    );
    await page.getByRole("button", { name: "Disable auto-merge", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Enable auto-merge", exact: true }),
    ).toBeVisible();
    const statePath = join(runRoot, "github-state.json");
    const state = JSON.parse(await readFile(statePath, "utf8"));
    expect(state).toMatchObject({
      title: "Edited fixture title",
      body: "Edited fixture description",
      autoMerge: null,
    });
    // Official OpenCode owns worktree inventory/removal; Git only attaches its existing branch.
    const project = (await client.location.get({ location: { directory: projectDirectory } }))
      .project;
    await exec("git", ["-C", projectDirectory, "switch", "main"]);
    const worktree = await client.worktree.create({
      projectID: project.id,
      from: projectDirectory,
      branch: "feature",
    });
    await exec("git", ["-C", worktree.directory, "switch", "feature"]);
    const task = await client.session.create({
      location: { directory: worktree.directory },
      title: "Merged cleanup fixture",
    });
    await page.evaluate(async (sessionID) => {
      const { profileID } = await window.palot.runtimeStatus();
      const result = await window.palot.sourceControl.linkPullRequest({
        profileID,
        sessionID,
        url: "https://github.com/palot-e2e/fixture/pull/7",
      });
      if (!result.ok) throw new Error(result.error.message);
    }, task.id);
    await writeFile(
      statePath,
      JSON.stringify({ ...JSON.parse(await readFile(statePath, "utf8")), merged: true }),
    );
    await page.evaluate((projectID) => {
      location.hash = `/worktrees?projectID=${encodeURIComponent(projectID)}`;
    }, project.id);
    await expect(
      page.getByRole("checkbox", { name: "Automatically retire merged worktrees", exact: true }),
    ).not.toBeChecked();
    await page.getByRole("button", { name: "Run cleanup now", exact: true }).click();
    await page.getByRole("button", { name: "Confirm cleanup now", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Retired 1 worktrees" })).toBeVisible();
    expect(
      await access(worktree.directory).then(
        () => true,
        () => false,
      ),
    ).toBe(false);
    expect(
      await access(projectDirectory).then(
        () => true,
        () => false,
      ),
    ).toBe(true);
    expect((await client.session.get({ sessionID: task.id })).title).toBe("Merged cleanup fixture");
    await page.getByText("Cleanup log (1)", { exact: true }).click();
    await page.screenshot({ path: join(runRoot, "git-branches-cleanup.png") });
    await narrowScreenshot(
      page,
      runRoot,
      "cleanup",
      page.getByRole("button", { name: "Run cleanup now", exact: true }),
    );
    await writeFile(
      join(runRoot, "git-branches-result.json"),
      JSON.stringify({
        taskID: task.id,
        originalTaskID: session.id,
        removedDirectory: worktree.directory,
        mainKept: true,
      }),
    );
  },
  async assert(page) {
    await expect(page.getByText("Cleanup log (1)", { exact: true })).toBeVisible();
  },
};
