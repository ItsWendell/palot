import { expect } from "@playwright/test";
import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { Scenario } from "./scenarios.ts";

const exec = promisify(execFile);
const URL = "https://github.com/palot-e2e/fixture/pull/7";
const TITLE = "Add fixture feature";
const BODY = "## Summary\n- Add the fixture feature.\n\n## Testing\n- Fixture-only test.";

export const gitPrScenario: Scenario = {
  description:
    "commit and push to a local bare remote, generate and create a fake GitHub PR, watch it and auto-link settled shell output",
  prompt: "",
  expectedModelCalls: 3,
  arrange(llm) {
    llm.text(JSON.stringify({ title: TITLE, body: BODY }));
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
  async run(page, { client, session, llm, projectDirectory, runRoot }) {
    const showChanges = page.getByRole("button", { name: "Show changes", exact: true });
    if (await showChanges.isVisible()) await showChanges.click();
    const working = page.getByRole("button", { name: "Working", exact: true });
    if (!(await working.isVisible())) {
      // The default Changes pane may still be mounting after renderer attachment.
      await working.waitFor({ state: "visible", timeout: 10_000 }).catch(() => undefined);
    }
    if (!(await working.isVisible())) {
      await page.getByRole("button", { name: "Open workbench surface" }).click();
      await page.getByRole("menuitem", { name: /^Changes\b/ }).click();
    }
    await working.click();
    const panel = page.getByRole("region", { name: "Commit changes" });
    await panel.getByRole("button", { name: "Stage all", exact: true }).click();
    await panel
      .getByRole("textbox", { name: "Commit message", exact: true })
      .fill("Add fixture feature");
    await panel.getByRole("button", { name: "Commit & push", exact: true }).click();
    await expect(panel.getByRole("status")).toContainText("Published feature to origin");
    const remoteHead = await exec("git", [
      "--git-dir",
      join(runRoot, "remote.git"),
      "rev-parse",
      "refs/heads/feature",
    ]);
    const localHead = await exec("git", ["-C", projectDirectory, "rev-parse", "HEAD"]);
    expect(remoteHead.stdout).toBe(localHead.stdout);
    await panel.getByRole("button", { name: "Create pull request", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Create pull request", exact: true });
    await expect(
      dialog.getByRole("textbox", { name: "Pull request title", exact: true }),
    ).toHaveValue(TITLE);
    await expect(
      dialog.getByRole("textbox", { name: "Pull request description", exact: true }),
    ).toHaveValue(BODY);
    await expect(dialog.getByLabel("Base branch", { exact: true })).toHaveValue("main");
    await dialog.getByRole("checkbox", { name: "Draft pull request", exact: true }).check();
    await page.screenshot({ path: join(runRoot, "git-pr-draft.png") });
    await dialog.getByRole("button", { name: "Create pull request", exact: true }).click();
    const linked = page.getByRole("dialog", { name: "Pull request #7 linked", exact: true });
    await expect(linked).toBeVisible();
    await linked.getByRole("button", { name: "Watch pull request", exact: true }).click();
    await expect(linked.getByRole("button", { name: "Watching", exact: true })).toBeVisible();
    await page.screenshot({ path: join(runRoot, "git-pr-linked.png") });
    await linked.getByRole("button", { name: "Done", exact: true }).click();
    const state = JSON.parse(await readFile(join(runRoot, "github-state.json"), "utf8"));
    expect(state).toMatchObject({
      created: true,
      head: "feature",
      base: "main",
      title: TITLE,
      body: BODY,
      draft: true,
    });
    // Remove the direct creation link, then prove a real settled tool result re-links it.
    await page.evaluate(async (sessionID) => {
      const { profileID } = await window.palot.runtimeStatus();
      const links = await window.palot.sourceControl.listPullRequestLinks({ profileID, sessionID });
      if (!links.ok) throw new Error(links.error.message);
      for (const link of links.value)
        await window.palot.sourceControl.unlinkPullRequest({ profileID, sessionID, key: link.key });
    }, session.id);
    llm.tool("shell", { command: `printf '%s\\n' '${URL}'` });
    llm.text("Fixture pull request created.");
    await client.session.update({
      sessionID: session.id,
      permissions: [{ action: "*", resource: "*", effect: "allow" }],
    });
    await client.session.prompt({
      sessionID: session.id,
      text: "Print the fixture pull request URL.",
    });
    await client.experimental.session.wait({ sessionID: session.id });
    await expect
      .poll(() =>
        page.evaluate(async (sessionID) => {
          const { profileID } = await window.palot.runtimeStatus();
          const links = await window.palot.sourceControl.listPullRequestLinks({
            profileID,
            sessionID,
          });
          return links.ok ? links.value.map((link) => link.pullRequest.url) : [];
        }, session.id),
      )
      .toEqual([URL]);
    await page.screenshot({ path: join(runRoot, "git-pr-auto-linked.png") });
  },
  async assert(page) {
    await expect(page.getByText("Fixture pull request created.", { exact: true })).toBeVisible();
  },
};
