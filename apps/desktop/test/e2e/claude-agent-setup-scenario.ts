import { expect, type Locator, type Page } from "@playwright/test";
import { accessSync, constants } from "node:fs";
import { chmod, copyFile, mkdir, writeFile } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { SUPPORTED_OPENCODE_VERSION } from "../../src/main/opencode-version.ts";
import type { Scenario } from "./scenarios.ts";

const INTEGRATION_ID = "claude-agent";
const BIN = "claude-bin";
const FIXTURE = "claude-fixture";
// The server's check allows 30 seconds for `claude` to start; the fixture answers at once.
const CHECK_TIMEOUT = 30_000;
/** The isolated home, kept from `prepare` so `run` can change the fixture. */
let fixtureHome = "";

/**
 * A stand-in `claude` for OpenCode's Claude Agent login check. The check never sends a
 * prompt: the SDK asks `claude` to initialize and reads its account and model list.
 * This answers that one request from a state file, with no network or credentials.
 * Version 2.1.250 meets OpenCode's minimum and skips context-window discovery.
 */
const FAKE_CLAUDE = `#!/bin/sh
dir=$(dirname "$0")
state=$(cat "$dir/state" 2>/dev/null)
if [ "$state" = "signed-in" ]; then
  account='{"tokenSource":"claude.ai","apiProvider":"firstParty","subscriptionType":"max"}'
else
  account='{"tokenSource":"none","apiProvider":"firstParty"}'
fi
models='[{"value":"default","displayName":"Default (recommended)","description":"Fixture default","resolvedModel":"claude-opus-fixture"},{"value":"opus","displayName":"Opus","description":"Fixture","supportedEffortLevels":["low","high"],"resolvedModel":"claude-opus-fixture"},{"value":"haiku","displayName":"Haiku","description":"Fixture","resolvedModel":"claude-haiku-fixture"}]'
while IFS= read -r line; do
  case "$line" in
    *'"subtype":"initialize"'*)
      id=$(printf '%s\\n' "$line" | sed -n 's/.*"request_id":"\\([^"]*\\)".*/\\1/p')
      printf '{"type":"control_response","response":{"subtype":"success","request_id":"%s","response":{"commands":[],"agents":[],"output_style":"default","available_output_styles":["default"],"models":%s,"account":%s,"pid":%s,"claude_code_version":"2.1.250"}}}\\n' "$id" "$models" "$account" "$$"
      ;;
  esac
done
`;

function executable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function installFakeClaude(home: string, state: "signed-out" | "signed-in") {
  const bin = join(home, BIN);
  await writeFile(join(bin, "state"), state, { mode: 0o600 });
  await copyFile(join(home, FIXTURE, "claude"), join(bin, "claude"));
  await chmod(join(bin, "claude"), 0o700);
}

async function setFakeState(home: string, state: "signed-out" | "signed-in") {
  await writeFile(join(home, BIN, "state"), state, { mode: 0o600 });
}

async function openSetup(page: Page): Promise<Locator> {
  const dialog = page.getByRole("dialog", { name: "Set up Claude Agent", exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}

export const claudeAgentSetupScenario: Scenario = {
  description:
    "set up OpenCode's Claude Agent provider through Palot's guided flow: not installed, signed out, then ready, with Needs sign-in recovery on the provider card (fake claude, no login)",
  prompt: "",
  expectedModelCalls: 0,
  arrange() {},
  async prepare(home) {
    fixtureHome = home;
    await mkdir(join(home, BIN), { recursive: true });
    await mkdir(join(home, FIXTURE), { recursive: true });
    await writeFile(join(home, FIXTURE, "claude"), FAKE_CLAUDE, { mode: 0o700 });
  },
  serviceEnvironment(home) {
    // Hide every real `claude` so the first check finds none, then put the fixture first.
    const path = (process.env.PATH ?? "")
      .split(delimiter)
      .filter((directory) => directory && !executable(join(directory, "claude")));
    return { PATH: [join(home, BIN), ...path].join(delimiter), OPENCODE_CLAUDE_PATH: "" };
  },
  async seed(client, { projectDirectory }) {
    expect((await client.server.info()).version).toBe(SUPPORTED_OPENCODE_VERSION);
    const input = { integrationID: INTEGRATION_ID, location: { directory: projectDirectory } };
    await expect
      .poll(async () => (await client.integration.get(input).catch(() => null))?.data ?? null, {
        timeout: 30_000,
        message: "Wait for OpenCode's Claude Agent integration",
      })
      .toMatchObject({
        name: "Claude Agent",
        methods: [expect.objectContaining({ id: "claude-login", type: "external" })],
        connections: [],
      });
  },
  async run(page, { client, projectDirectory, runRoot, visible }) {
    const home = fixtureHome;
    const pageErrors: string[] = [];
    const onPageError = (error: Error) => pageErrors.push(error.message);
    page.on("pageerror", onPageError);
    const input = { integrationID: INTEGRATION_ID, location: { directory: projectDirectory } };
    const connections = async () => (await client.integration.get(input)).data.connections;
    const shot = async (name: string) => {
      if (visible) await page.screenshot({ path: join(runRoot, `claude-agent-${name}.png`) });
    };
    try {
      await page.evaluate(() => {
        location.hash = "#/settings/providers";
      });
      await expect(page.getByRole("heading", { name: "Providers", level: 1 })).toBeVisible();
      // Claude Agent is a popular provider, so it is listed without searching.
      const row = page
        .getByRole("list", { name: "Popular providers" })
        .getByRole("listitem", { name: "Claude Agent", exact: true });
      await expect(row).toContainText("Use your Claude plan or another Claude Code login.");
      await row.getByRole("button", { name: "Connect", exact: true }).click();

      let dialog = await openSetup(page);
      const install = dialog.getByRole("listitem", { name: "Install Claude Code" });
      const signIn = dialog.getByRole("listitem", { name: "Sign in to Claude Code" });
      await expect(install).toContainText("curl -fsSL https://claude.ai/install.sh | bash");
      await expect(signIn).toContainText("claude auth login");
      expect(await connections()).toEqual([]);
      await shot("guide");

      // 1. Not installed: OpenCode finds no `claude` on its PATH.
      await dialog.getByRole("button", { name: "Check connection", exact: true }).click();
      await expect(dialog.getByRole("alert")).toContainText("Claude Code isn't installed", {
        timeout: CHECK_TIMEOUT,
      });
      await expect(install.getByText("Not found", { exact: true })).toBeVisible();
      const missing = await connections();
      expect(missing).toMatchObject([
        {
          type: "credential",
          method: "external",
          status: { status: "needs_auth", message: expect.stringContaining("not installed") },
        },
      ]);
      await shot("not-installed");

      // 2. Installed but signed out: `claude` answers with no login.
      await installFakeClaude(home, "signed-out");
      await dialog.getByRole("button", { name: "Check again", exact: true }).click();
      await expect(dialog.getByRole("alert")).toContainText("Claude Code isn't signed in", {
        timeout: CHECK_TIMEOUT,
      });
      await expect(install.getByText("Installed", { exact: true })).toBeVisible();
      await expect(signIn.getByText("Not signed in", { exact: true })).toBeVisible();
      // Each check replaces the previous connection instead of piling them up.
      await expect.poll(async () => (await connections()).length).toBe(1);
      const signedOut = await connections();
      expect(signedOut[0]).toMatchObject({
        label: "Claude Code",
        status: { message: expect.stringContaining("not logged in") },
      });
      expect(signedOut[0]?.type === "credential" && signedOut[0].id).not.toBe(
        missing[0]?.type === "credential" && missing[0].id,
      );
      await shot("signed-out");

      // 3. Signed in: the model list is unchanged, so the check passes after its settle delay.
      await setFakeState(home, "signed-in");
      await dialog.getByRole("button", { name: "Check again", exact: true }).click();
      await expect(dialog.getByText("Claude Agent is ready", { exact: true })).toBeVisible({
        timeout: CHECK_TIMEOUT,
      });
      await expect(signIn.getByText("Signed in", { exact: true })).toBeVisible();
      await expect
        .poll(connections)
        .toEqual([expect.not.objectContaining({ status: expect.anything() })]);
      await shot("ready");
      await dialog.getByRole("button", { name: "Done", exact: true }).click();
      await expect(dialog).toHaveCount(0);

      const card = page.getByRole("article", { name: "Claude Agent connections", exact: true });
      await expect(card.getByText("Claude Code login", { exact: true })).toBeVisible();
      await expect(card.getByText("Needs sign-in", { exact: true })).toHaveCount(0);
      await expect(card.getByRole("button", { name: /models shown/ })).toBeVisible();

      // 4. Signing out later: the card reports it and leads back to the setup.
      await setFakeState(home, "signed-out");
      await card.getByRole("button", { name: "Check Claude Code", exact: true }).click();
      dialog = await openSetup(page);
      await dialog.getByRole("button", { name: "Check again", exact: true }).click();
      await expect(dialog.getByRole("alert")).toContainText("Claude Code isn't signed in", {
        timeout: CHECK_TIMEOUT,
      });
      await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(dialog).toHaveCount(0);
      const problem = card.getByRole("alert");
      await expect(problem).toContainText("Claude Agent needs sign-in");
      await expect(problem).toContainText("claude auth login");
      await shot("needs-sign-in");
      await problem.getByRole("button", { name: "Fix Claude Code setup", exact: true }).click();
      await openSetup(page);
      expect(pageErrors).toEqual([]);
      await writeFile(
        join(runRoot, "claude-agent-setup.json"),
        JSON.stringify(
          { server: await client.server.info(), connections: await connections() },
          null,
          2,
        ),
        { mode: 0o600 },
      );
    } finally {
      page.off("pageerror", onPageError);
    }
  },
  async assert(_page, { llm }) {
    expect(llm.requests).toHaveLength(0);
  },
};
