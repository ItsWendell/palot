import type { SessionMessageInfo } from "@opencode/client";
import { expect } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Scenario } from "./scenarios.ts";

const PROMPT = "msg_machines_user";
const RESPONSE = "msg_machines_assistant";
const MACHINE_FILE = "devbox:/srv/app/src/app.ts";

/**
 * OpenCode's experimental machines (`experimental.machines`): Settings → Machines adds a
 * machine, shows its single-use join string and removes it again; a transcript whose calls
 * named `devbox:/…` paths shows the machine on those rows and never opens them locally.
 *
 * OpenCode 2.4.1 ships no worker that can join with the string, so no machine links here: the
 * transcript is imported, as the server would record calls that ran on a linked machine.
 */
export const machinesScenario: Scenario = {
  description:
    "add a machine in Settings, see its join string, remove it; show machine paths in tool rows",
  prompt: "",
  expectedModelCalls: 0,
  openCodeConfig: { experimental: { machines: true } },
  arrange() {},
  async seed(client, { projectDirectory, runRoot }) {
    const session = await client.session.create({ location: { directory: projectDirectory } });
    const created = Date.now() - 10_000;
    const tool = (
      id: string,
      name: string,
      input: Record<string, string>,
      text: string,
      at: number,
    ) => ({
      type: "tool" as const,
      id,
      name,
      state: {
        status: "completed" as const,
        input,
        content: [{ type: "text" as const, text }] as [{ type: "text"; text: string }],
        metadata: (name === "shell" ? { exit: 0 } : {}) as Record<string, number>,
      },
      time: { created: at, ran: at, completed: at + 200 },
    });
    const messages: SessionMessageInfo[] = [
      { id: PROMPT, type: "user", time: { created }, text: "Check the app on devbox." },
      {
        id: RESPONSE,
        type: "assistant",
        time: { created: created + 1, completed: created + 2_000 },
        agent: "build",
        model: { providerID: "test", id: "test-model" },
        finish: "stop",
        content: [
          tool(
            "call_read",
            "read",
            { path: MACHINE_FILE },
            "1: export const app = 1;",
            created + 10,
          ),
          tool(
            "call_shell",
            "shell",
            { command: "uname -a", workdir: "devbox:/srv/app" },
            "Linux devbox 6.8.0 x86_64 GNU/Linux",
            created + 400,
          ),
          {
            type: "text",
            text: `The entry point is \`${MACHINE_FILE}\` on devbox.`,
          },
        ],
      },
    ];
    const imported = await client.experimental.session.import({
      info: { ...session, id: `${session.id}_machines`, title: "Machine paths" },
      messages,
      location: session.location,
    });
    await writeFile(join(runRoot, "machines-session.txt"), imported.id);
    await client.session.remove({ sessionID: session.id });
  },
  async run(page, { runRoot }) {
    const sessionID = await readFile(join(runRoot, "machines-session.txt"), "utf8");
    await page.evaluate((id) => {
      location.hash = `#/sessions/${encodeURIComponent(id)}`;
    }, sessionID);
  },
  async assert(page, { client, runRoot }) {
    await page.setViewportSize({ width: 1280, height: 860 });

    // Transcript: calls on devbox carry its badge, and its files never open locally.
    const turnBar = page.getByRole("button", { name: /Worked for/ });
    await turnBar.waitFor({ timeout: 20_000 });
    await expect(turnBar).toContainText("on devbox");
    await turnBar.click();
    await expect(page.getByText("Ran uname -a")).toBeVisible();
    // The read row, the shell row and the inline file link each name devbox.
    await expect(page.locator('[data-machine="devbox"]')).toHaveCount(3);
    await page.screenshot({ path: join(runRoot, "machines-transcript.png") });
    await expect(page.getByRole("link", { name: "Open app.ts on devbox" })).toHaveAttribute(
      "title",
      `Open ${MACHINE_FILE}`,
    );
    await page.getByRole("link", { name: "Open /srv/app/src/app.ts on devbox" }).click();
    const notice = page.getByRole("dialog", { name: "This file is on devbox" });
    await expect(notice).toBeVisible();
    await expect(notice.getByRole("button", { name: "Copy path" })).toBeVisible();
    await expect(page.locator('[data-workbench-pane="right"] [role="tabpanel"]')).toHaveCount(0);
    await page.screenshot({ path: join(runRoot, "machines-file-notice.png") });
    await notice.hover();
    await page.getByRole("button", { name: "Close toast" }).first().click({ force: true });
    await expect(notice).toHaveCount(0);

    // Settings → Machines: add, see the join string, remove.
    await page.evaluate(() => {
      location.hash = "#/settings/machines";
    });
    const add = page.getByRole("button", { name: /^Add machine to / });
    await add.waitFor({ timeout: 20_000 });
    await expect(page.getByText(/No machines yet/)).toBeVisible();
    await add.click();
    const dialog = page.getByRole("dialog", { name: /^(Add machine|Join devbox)$/ });
    await dialog.getByLabel("Machine name").fill("devbox");
    await dialog.getByRole("button", { name: "Add machine" }).click();
    await expect(dialog.getByText("Join string")).toBeVisible();
    await expect(dialog.getByText("Waiting for devbox to connect…")).toBeVisible();
    await expect(
      dialog.getByText(/ws:\/\/.*\/api\/experimental\/machine\/link/).first(),
    ).toBeVisible();
    await dialog.screenshot({ path: join(runRoot, "machines-add-dialog.png") });
    expect(await client.experimental.machine.list()).toEqual([
      { id: "devbox", online: false, paired: false },
    ]);
    await dialog.getByRole("button", { name: "Close", exact: true }).last().click();
    await expect(dialog).toHaveCount(0);

    await expect(page.getByText("Waiting to join")).toBeVisible();
    await page.getByRole("main", { name: "Settings" }).screenshot({
      path: join(runRoot, "machines-settings.png"),
    });
    await page.getByRole("button", { name: "Remove devbox" }).click();
    await page.getByRole("button", { name: "Confirm remove devbox" }).click();
    await expect(page.getByText(/No machines yet/)).toBeVisible();
    expect(await client.experimental.machine.list()).toEqual([]);
  },
};
