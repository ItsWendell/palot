import { expect } from "@playwright/test";
import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { Scenario } from "./scenarios.ts";
import { useIsolatedHttpProfile } from "./isolated-http-profile.ts";

const exec = promisify(execFile);
const title = "Add fixture feature";
export const hostsScenario: Scenario = {
  description:
    "remote-profile stage, commit and local-only push through OpenCode shell; create, watch, check pipelines and merge a fake GitLab MR",
  prompt: "",
  expectedModelCalls: 1,
  arrange(llm) {
    llm.text(JSON.stringify({ title, body: "Fixture-only change and checks." }));
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
    await git("remote", "add", "origin", "git@gitlab.example:group/sub/fixture.git");
    await git("remote", "set-url", "--push", "origin", remote);
    const ssh = join(runRoot, "fixture-ssh.sh");
    await writeFile(ssh, `#!/bin/sh\nexec git-upload-pack '${remote.replaceAll("'", "'\\''")}'\n`, {
      mode: 0o700,
    });
    await git("config", "core.sshCommand", ssh);
    await git("push", "-u", "origin", "main");
    await git("symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
    await git("checkout", "-b", "feature");
    await writeFile(join(projectDirectory, "feature.txt"), "Fixture feature\n");
    process.env.PALOT_TEST_GITLAB_STATE = join(runRoot, "gitlab-state.json");
    process.env.PALOT_TEST_GITHUB_STATE = join(runRoot, "github-state.json");
    await writeFile(process.env.PALOT_TEST_GITLAB_STATE, JSON.stringify({ created: false }), {
      mode: 0o600,
    });
    await writeFile(process.env.PALOT_TEST_GITHUB_STATE, JSON.stringify({ created: false }), {
      mode: 0o600,
    });
    process.env.GITLAB_TOKEN = "palot-e2e-gitlab-token";
    process.env.GITLAB_HOST = "gitlab.example";
    process.env.GH_HOST = "github.com";
    process.env.GH_TOKEN = "palot-e2e-dummy-token";
    const fixture = fileURLToPath(new URL("./fixtures/gitlab.cjs", import.meta.url));
    process.env.NODE_OPTIONS = `${process.env.NODE_OPTIONS ?? ""} --require=${JSON.stringify(fixture)}`;
  },
  async run(page, { projectDirectory, runRoot, session, client }) {
    const cleanup = await useIsolatedHttpProfile(page);
    const messagesBefore = await client.message.list({ sessionID: session.id });
    try {
      await page.reload();
      await page.evaluate(async (id) => {
        const { profileID } = await window.palot.runtimeStatus();
        window.location.hash = `/sessions/${id}?profileID=${profileID}`;
      }, session.id);
      await expect(page.getByRole("textbox", { name: "Message Palot", exact: true })).toBeVisible();
      const showChanges = page.getByRole("button", { name: "Show changes", exact: true });
      await expect(showChanges).toBeVisible();
      await showChanges.click();
      const working = page.getByRole("button", { name: "Working", exact: true });
      await expect(working).toBeVisible();
      await working.click();
      const panel = page.getByRole("region", { name: "Commit changes" });
      await panel.getByRole("button", { name: "Stage all", exact: true }).click();
      await panel.getByRole("textbox", { name: "Commit message", exact: true }).fill(title);
      await panel.getByRole("button", { name: "Commit & push", exact: true }).click();
      await expect(panel.getByRole("status")).toContainText("Published feature to origin", {
        timeout: 30_000,
      });
      const localHead = (
        await exec("git", ["-C", projectDirectory, "rev-parse", "HEAD"])
      ).stdout.trim();
      expect(
        (
          await exec("git", [
            "--git-dir",
            join(runRoot, "remote.git"),
            "rev-parse",
            "refs/heads/feature",
          ])
        ).stdout.trim(),
      ).toBe(localHead);
      const stateFile = join(runRoot, "gitlab-state.json");
      await writeFile(stateFile, JSON.stringify({ created: false, sha: localHead }));
      await panel.getByRole("button", { name: "Create pull request", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Create pull request", exact: true });
      await expect(
        dialog.getByRole("textbox", { name: "Pull request title", exact: true }),
      ).toHaveValue(title);
      await dialog.getByRole("button", { name: "Create pull request", exact: true }).click();
      const linked = page.getByRole("dialog", { name: "Pull request #7 linked", exact: true });
      await expect(linked).toBeVisible();
      await linked.getByRole("button", { name: "Watch pull request", exact: true }).click();
      await expect(linked.getByRole("button", { name: "Watching", exact: true })).toBeVisible();
      await linked.getByRole("button", { name: "Done", exact: true }).click();
      await page.evaluate(async () => {
        const { profileID } = await window.palot.runtimeStatus();
        window.location.hash = `/pull-requests?pr=gitlab.example/group/sub/fixture/7&profileID=${profileID}`;
      });
      const detail = page.locator(
        '[data-pull-request-detail="gitlab.example/group/sub/fixture#7"]',
      );
      await expect(detail.getByText("Pipeline #42", { exact: true })).toBeVisible();
      await expect(detail.getByRole("button", { name: "Edit labels", exact: true })).toBeDisabled();
      await page.screenshot({ path: join(runRoot, "hosts-pipeline.png"), animations: "disabled" });
      const merge = detail.getByRole("region", { name: "Merge", exact: true });
      const action = merge.getByRole("button", { name: "Create a merge commit", exact: true });
      await action.click();
      await merge.getByRole("button", { name: /^Confirm / }).click();
      await expect(detail.getByRole("status").filter({ hasText: "Merged" })).toBeVisible();
      await page.screenshot({ path: join(runRoot, "hosts-merged.png"), animations: "disabled" });
      expect(JSON.parse(await readFile(stateFile, "utf8"))).toMatchObject({
        created: true,
        merged: true,
        title,
      });
      // Git's public shell API must not add hidden user or tool messages to the task.
      expect((await client.message.list({ sessionID: session.id })).data).toEqual(
        messagesBefore.data,
      );
      expect((await client.shell.list({ location: { directory: projectDirectory } })).data).toEqual(
        [],
      );
      await page.evaluate(() => {
        window.location.hash = "/settings/source-control";
      });
      await expect(page.getByRole("textbox", { name: "Code host URL" })).toBeVisible();
      await expect(page.getByText("gitlab.example", { exact: true })).toBeVisible();
      await page.screenshot({ path: join(runRoot, "hosts-settings.png"), animations: "disabled" });
    } finally {
      await cleanup();
    }
  },
  async assert() {},
};
