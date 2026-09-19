import { expect, type Page } from "@playwright/test";
import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type { Scenario } from "./scenarios.ts";

const execFileAsync = promisify(execFile);
const FEATURE_FILE = "review-feature.txt";
const RELEASE_FILE = "review-release.txt";
async function git(directory: string, ...args: string[]) {
  return execFileAsync(
    "git",
    [
      "-c",
      "user.name=Palot E2E",
      "-c",
      "user.email=palot-e2e@example.invalid",
      "-c",
      "commit.gpgsign=false",
      ...args,
    ],
    { cwd: directory },
  );
}

export const reviewBaseScenario: Scenario = {
  description:
    "review real inferred and explicit Git bases, persist the scoped choice, and handle null inference",
  prompt: "",
  expectedModelCalls: 0,
  arrange() {},
  async prepareProject({ projectDirectory, runRoot }) {
    await git(projectDirectory, "checkout", "-B", "main");
    await git(projectDirectory, "config", "init.defaultBranch", "main");
    await writeFile(join(projectDirectory, "review-root.txt"), "Shared ancestor\n");
    await git(projectDirectory, "add", ".");
    await git(projectDirectory, "commit", "-m", "Review root");
    await git(projectDirectory, "update-ref", "refs/remotes/origin/main", "HEAD");
    await git(
      projectDirectory,
      "symbolic-ref",
      "refs/remotes/origin/HEAD",
      "refs/remotes/origin/main",
    );
    await git(projectDirectory, "checkout", "-b", "release", "main");
    await writeFile(join(projectDirectory, RELEASE_FILE), "Release-only change\n");
    await git(projectDirectory, "add", ".");
    await git(projectDirectory, "commit", "-m", "Release change");
    await git(projectDirectory, "checkout", "-b", "feature/review", "release");
    await writeFile(join(projectDirectory, FEATURE_FILE), "Feature-only change\n");
    await git(projectDirectory, "add", ".");
    await git(projectDirectory, "commit", "-m", "Feature change");
    const emptyDirectory = join(runRoot, "review-unborn");
    await mkdir(emptyDirectory, { recursive: true });
    await git(emptyDirectory, "init", "--quiet");
  },
  async run(page, { client, session, projectDirectory, runRoot }) {
    const location = { directory: projectDirectory };
    const inferred = (await client.vcs.base({ location })).data;
    expect(inferred, "Fixture must have an official inferred base").not.toBeNull();
    const inferredDiffs = (await client.vcs.diff({ location, mode: "branch", base: inferred!.ref }))
      .data;
    const inferredFiles = inferredDiffs.map((file) => file.file).sort();
    expect(inferredFiles).toContain(FEATURE_FILE);
    // Whether OpenCode selects the reflog base or repository default, choose the
    // other real branch so the rendered file set must visibly change.
    const manual = inferredFiles.includes(RELEASE_FILE) ? "release" : "main";
    const manualDiffs = (await client.vcs.diff({ location, mode: "branch", base: manual })).data;
    const manualFiles = manualDiffs.map((file) => file.file).sort();
    expect(manualFiles).not.toEqual(inferredFiles);

    await openBranchReview(page);
    await expect(
      page.getByRole("button", { name: `Review base: ${inferred!.name}`, exact: true }),
    ).toBeVisible();
    await assertFiles(page, inferredFiles);
    await chooseBase(page, manual);
    await assertFiles(page, manualFiles);
    // A file tab must use the same scoped base, not silently fall back to default.
    await page.getByRole("button", { name: `Open ${FEATURE_FILE} in a tab`, exact: true }).click();
    await expect(
      page.getByRole("button", { name: `Review base: ${manual}`, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByLabel(`Diff contents for ${FEATURE_FILE}`, { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: `Close ${FEATURE_FILE}`, exact: true }).click();
    await assertFiles(page, manualFiles);
    await captureSizes(page, runRoot);

    // Reload the real renderer to prove disk-backed selection, not just hook state.
    await page.reload();
    await openBranchReview(page);
    await expect(
      page.getByRole("button", { name: `Review base: ${manual}`, exact: true }),
    ).toBeVisible();
    await assertFiles(page, manualFiles);

    const emptyDirectory = join(runRoot, "review-unborn");
    expect((await client.vcs.base({ location: { directory: emptyDirectory } })).data).toBeNull();
    const emptySession = await client.session.create({ location: { directory: emptyDirectory } });
    await client.session.update({
      sessionID: emptySession.id,
      title: "Review base isolated checkout",
    });
    await navigateSession(page, emptySession.id);
    await openBranchReview(page);
    await expect(
      page.getByRole("button", { name: "Review base: Choose base", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "No unambiguous base" })).toBeVisible();
    await expect(page.getByText("Loading branch changes", { exact: true })).toHaveCount(0);
    await page.screenshot({ path: join(runRoot, "review-base-null.png") });

    await navigateSession(page, session.id);
    await openBranchReview(page);
    await expect(
      page.getByRole("button", { name: `Review base: ${manual}`, exact: true }),
    ).toBeVisible();
    await assertFiles(page, manualFiles);
    await page.getByRole("button", { name: /^Review base:/ }).click();
    await page.getByRole("button", { name: "Use inferred base", exact: true }).click();
    await assertFiles(page, inferredFiles);
  },
  async assert(page) {
    await expect(page.getByRole("button", { name: "Branch", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.getByRole("button", { name: /^Review base:/ })).toBeVisible();
  },
};

async function navigateSession(page: Page, sessionID: string) {
  await page.evaluate((id) => {
    window.location.hash = `/sessions/${id}`;
  }, sessionID);
  // Await fresh hydration instead of observing the previous session's still-mounted pane.
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Message Palot" })).toBeVisible();
}

async function openBranchReview(page: Page) {
  const branch = page.getByRole("button", { name: "Branch", exact: true });
  const showChanges = page.getByRole("button", { name: "Show changes", exact: true });
  await expect(branch.or(showChanges).first()).toBeVisible();
  if (!(await branch.isVisible())) await showChanges.click();
  await branch.click();
}

async function chooseBase(page: Page, ref: string) {
  await page.getByRole("button", { name: /^Review base:/ }).click();
  await page
    .getByRole("textbox", { name: "Search branches or enter a ref", exact: true })
    .fill(ref);
  await page.getByRole("button", { name: `Use ref: ${ref}`, exact: true }).click();
}

async function assertFiles(page: Page, files: string[]) {
  await expect
    .poll(async () =>
      page
        .locator("[data-palot-diff-header]")
        .evaluateAll((nodes) =>
          nodes.map((node) => node.getAttribute("data-palot-diff-header")).sort(),
        ),
    )
    .toEqual(files);
}

async function captureSizes(page: Page, runRoot: string) {
  const normal = page.viewportSize() ?? { width: 1280, height: 900 };
  try {
    await page.screenshot({
      path: join(runRoot, "review-base-default.png"),
      animations: "disabled",
    });
    await page.setViewportSize({ width: 920, height: 640 });
    const trigger = page.getByRole("button", { name: /^Review base:/ });
    await expect(trigger).toBeVisible();
    const bounds = await trigger.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(921);
    await trigger.click();
    const popup = page
      .locator('[data-slot="popover-content"]')
      .filter({ has: page.getByRole("heading", { name: "Review base", exact: true }) });
    await expect(popup).toBeVisible();
    const popupBounds = await popup.boundingBox();
    expect(popupBounds!.x).toBeGreaterThanOrEqual(0);
    expect(popupBounds!.x + popupBounds!.width).toBeLessThanOrEqual(921);
    await page.screenshot({
      path: join(runRoot, "review-base-920x640.png"),
      animations: "disabled",
    });
    await page.keyboard.press("Escape");
  } finally {
    await page.setViewportSize(normal);
  }
}
