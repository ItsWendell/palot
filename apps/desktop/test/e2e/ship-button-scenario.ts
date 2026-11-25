import { expect } from "@playwright/test";
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { Scenario } from "./scenarios.ts";

const exec = promisify(execFile);
const MESSAGE = "feat: add the fixture feature";
const TITLE = "Add fixture feature";
const BODY = "## Summary\n- Add the fixture feature.";

/**
 * The task header's ship button against a local bare remote and the fake GitHub host the
 * git-pr scenario uses: Commit, then Push & create PR, then View PR; then a failing check
 * offers Fix failing checks, which puts a PR context chip in the composer.
 */
export const shipButtonScenario: Scenario = {
  description:
    "ship button: commit with a generated message, push & create a fake GitHub PR, view it, then add a failing-check repair chip",
  prompt: "",
  expectedModelCalls: 3,
  arrange(llm) {
    llm.text(MESSAGE);
    llm.text(JSON.stringify({ title: TITLE, body: BODY }));
    llm.text("Reading the failing check.");
  },
  async prepareProject({ projectDirectory, runRoot }) {
    const git = (...args: string[]) => exec("git", ["-C", projectDirectory, ...args]);
    const remote = join(runRoot, "remote.git");
    await exec("git", ["init", "--bare", "--initial-branch=main", remote]);
    await git("config", "user.name", "Palot Fixture");
    await git("config", "user.email", "fixture@palot.invalid");
    await git("config", "core.hooksPath", "/dev/null");
    await git("symbolic-ref", "HEAD", "refs/heads/main");
    await writeFile(join(projectDirectory, "README.md"), "Fixture base\n");
    await git("add", "README.md");
    await git("commit", "-m", "Base fixture");
    await git("remote", "add", "origin", "git@github.com:palot-e2e/fixture.git");
    await git("remote", "set-url", "--push", "origin", remote);
    // Even an incidental Git fetch/ls-remote uses a local pack process, never ssh/network.
    const ssh = join(runRoot, "fixture-ssh.sh");
    await writeFile(ssh, `#!/bin/sh\nexec git-upload-pack '${remote.replaceAll("'", "'\\''")}'\n`, {
      mode: 0o700,
    });
    await git("config", "core.sshCommand", ssh);
    await git("push", "-u", "origin", "main");
    await git("symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
    await git("checkout", "-b", "feature");
    await writeFile(join(projectDirectory, "feature.txt"), "Fixture feature\n");
    const state = join(runRoot, "github-state.json");
    await writeFile(state, JSON.stringify({ created: false }), { mode: 0o600 });
    process.env.PALOT_TEST_GITHUB_STATE = state;
    process.env.GH_TOKEN = "palot-e2e-dummy-token";
    process.env.GITHUB_TOKEN = "palot-e2e-dummy-token";
    process.env.GH_HOST = "github.com";
    const fixture = fileURLToPath(new globalThis.URL("./fixtures/github.cjs", import.meta.url));
    process.env.NODE_OPTIONS = `${process.env.NODE_OPTIONS ?? ""} --require=${JSON.stringify(fixture)}`;
  },
  async run(page, { projectDirectory, runRoot }) {
    const shots = process.env.PALOT_E2E_SCREENSHOTS ?? runRoot;
    await mkdir(shots, { recursive: true });
    const header = page.locator("header").filter({ has: page.locator("[data-ship-button]") });

    // OpenCode applies the configured test model about a second after it starts; until then
    // it has no default, and text generation without a model would pick another one.
    await expect(page.getByRole("button", { name: /^Model: Test Model/ })).toBeVisible({
      timeout: 20_000,
    });

    // An unpublished branch with changes: commit first.
    const commit = page.getByRole("button", { name: "Commit", exact: true });
    await expect(commit).toBeVisible({ timeout: 20_000 });
    await header.screenshot({ path: join(shots, "ship-button-commit.png") });
    await commit.click();
    const form = page.getByRole("form", { name: "Commit", exact: true });
    const message = form.getByRole("textbox", { name: "Commit message", exact: true });
    await expect(message).toHaveValue(MESSAGE);
    await expect(form).toContainText("Stages and commits the changed file");
    await page.screenshot({ path: join(shots, "ship-button-confirm.png") });
    await message.press("Enter");
    const stages = page.getByRole("list", { name: "Stages" });
    await expect(stages).toContainText(`Committed`);
    await expect(stages).toContainText(MESSAGE);
    const log = await exec("git", ["-C", projectDirectory, "log", "-1", "--format=%s"]);
    expect(log.stdout.trim()).toBe(MESSAGE);
    await page.getByRole("button", { name: "Close", exact: true }).click();

    // Nothing was pushed by the commit; the next step publishes it with a PR.
    const ship = page.getByRole("button", { name: "Push & create PR", exact: true });
    await expect(ship).toBeVisible();
    await header.screenshot({ path: join(shots, "ship-button-push-create-pr.png") });
    await ship.click();
    const dialog = page.getByRole("dialog", { name: "Create pull request", exact: true });
    await expect(
      dialog.getByRole("textbox", { name: "Pull request title", exact: true }),
    ).toHaveValue(TITLE);
    const remoteHead = await exec("git", [
      "--git-dir",
      join(runRoot, "remote.git"),
      "rev-parse",
      "refs/heads/feature",
    ]);
    const localHead = await exec("git", ["-C", projectDirectory, "rev-parse", "HEAD"]);
    expect(remoteHead.stdout).toBe(localHead.stdout);
    await expect(
      dialog.getByRole("checkbox", { name: "Watch pull request", exact: true }),
    ).toBeChecked();
    await dialog.getByRole("button", { name: "Create pull request", exact: true }).click();
    const linked = page.getByRole("dialog", { name: "Pull request #7 linked", exact: true });
    await expect(linked).toBeVisible();
    // The ship chain's watch stage starts the watch; the dialog follows the live link.
    await expect(linked.getByRole("button", { name: "Watching", exact: true })).toBeVisible();
    await linked.getByRole("button", { name: "Done", exact: true }).click();
    const state = JSON.parse(await readFile(join(runRoot, "github-state.json"), "utf8"));
    expect(state).toMatchObject({ created: true, head: "feature", base: "main", title: TITLE });

    // Back in the stage list: the fifth stage watched the PR.
    const shipped = page.getByRole("list", { name: "Stages" });
    await expect(shipped.locator('[data-ship-stage="watch"]')).toHaveAttribute(
      "data-status",
      "done",
    );
    await expect(shipped).toContainText("Watching PR #7");
    await page
      .locator('[data-slot="popover-content"]')
      .filter({ has: shipped })
      .screenshot({ path: join(shots, "ship-popover-watch.png") })
      .catch(() => page.screenshot({ path: join(shots, "ship-popover-watch.png") }));
    await page.getByRole("button", { name: "Close", exact: true }).click();

    await expect(page.getByRole("button", { name: "View PR", exact: true })).toBeVisible({
      timeout: 20_000,
    });
    await header.screenshot({ path: join(shots, "ship-button-view-pr.png") });

    // Unwatched, View PR offers Watch. The rest of the scenario runs unwatched, so no wake
    // reaches the scripted agent.
    const setWatch = (watching: boolean) =>
      page.evaluate(async (watching) => {
        const { profileID } = await window.palot.runtimeStatus();
        const links = await window.palot.sourceControl.listPullRequestLinks({ profileID });
        if (!links.ok) throw new Error(links.error.message);
        for (const link of links.value)
          await window.palot.sourceControl.watchPullRequest({
            profileID,
            sessionID: link.sessionID,
            key: link.key,
            watching,
          });
      }, watching);
    await setWatch(false);
    const offer = page.getByRole("button", { name: "Watch PR #7", exact: true });
    await expect(offer).toBeVisible({ timeout: 20_000 });
    await header.screenshot({ path: join(shots, "ship-button-watch-offer.png") });
    await offer.click();
    await expect(offer).toBeHidden({ timeout: 20_000 });
    await setWatch(false);

    // A failing check offers the matching repair, which becomes a composer chip.
    await writeFile(
      join(runRoot, "github-state.json"),
      JSON.stringify({ ...state, checkStatus: "FAILURE" }),
    );
    await page.locator("[data-pull-request-control]").click();
    await page.getByRole("button", { name: "Refresh pull requests", exact: true }).click();
    const fix = page.getByRole("button", { name: "Fix failing checks", exact: true });
    await expect(fix).toBeVisible({ timeout: 20_000 });
    await fix.click();
    const chip = page.locator('[data-palot-composer-input] [data-composer-chip="pr context"]');
    await expect(chip).toHaveText("PR #7 · 1 failing check");
    await page
      .locator("[data-palot-composer-input]")
      .locator("xpath=ancestor::*[@data-focus-region][1]")
      .screenshot({ path: join(shots, "pr-repair-chip.png") })
      .catch(() => page.screenshot({ path: join(shots, "pr-repair-chip.png") }));

    // Sent, the chip stays compact and shows the exact text it supplied.
    await page.locator("[data-palot-composer-input]").press("Enter");
    await expect(page.getByText("Reading the failing check.", { exact: true })).toBeVisible();
    const sent = page.getByRole("button", {
      name: "Pull request context: PR #7 · 1 failing check. Show the text it supplied",
    });
    await sent.click();
    const supplied = page.getByLabel("Text sent to the agent", { exact: true });
    await expect(supplied).toContainText("1. Fixture CI (failed, required)");
    await expect(supplied).toContainText(
      "Details: https://github.com/palot-e2e/fixture/actions/runs/1",
    );
    // Pressing the action read the failing step's log tail through the fake Actions API.
    await expect(supplied).toContainText('Failed step "Test", last lines:');
    await expect(supplied).toContainText("FAIL fixture.test.ts > adds numbers");
    await expect(supplied).toContainText("Expected: 3, Received: 4");
    await expect(supplied).not.toContainText("Post job cleanup.");
    await page.screenshot({ path: join(shots, "pr-repair-sent.png") });
    await page.keyboard.press("Escape");

    // The PR control states readiness: what is still needed, then ready.
    const control = page.locator("[data-pull-request-control]");
    const readiness = page.locator("[data-pull-request-readiness]");
    await writeFile(
      join(runRoot, "github-state.json"),
      JSON.stringify({ ...state, reviewDecision: "REVIEW_REQUIRED", mergeStateStatus: "BEHIND" }),
    );
    await control.click();
    await page.getByRole("button", { name: "Refresh pull requests", exact: true }).click();
    await expect(readiness).toHaveText("Still needed: approval, branch behind", {
      timeout: 20_000,
    });
    await page
      .locator('[data-slot="popover-content"][aria-label="Pull request"]')
      .screenshot({ path: join(shots, "pr-control-still-needed.png") })
      .catch(() => page.screenshot({ path: join(shots, "pr-control-still-needed.png") }));
    await writeFile(
      join(runRoot, "github-state.json"),
      JSON.stringify({ ...state, mergeStateStatus: "CLEAN" }),
    );
    await page.getByRole("button", { name: "Refresh pull requests", exact: true }).click();
    await expect(readiness).toHaveText("Ready to merge", { timeout: 20_000 });
    await page
      .locator('[data-slot="popover-content"][aria-label="Pull request"]')
      .screenshot({ path: join(shots, "pr-control-ready.png") })
      .catch(() => page.screenshot({ path: join(shots, "pr-control-ready.png") }));
    await page.keyboard.press("Escape");
  },
  async assert(page) {
    await expect(page.locator("[data-pr-context-chip]")).toHaveCount(1);
  },
};
