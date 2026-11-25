import { expect } from "@playwright/test";
import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import type { Scenario } from "./scenarios";
import { taskRowBySession } from "./task-list.ts";

const execFileAsync = promisify(execFile);

export const projectFreeChatScenario: Scenario = {
  description:
    "start a chat without a project from the sidebar, show it as a Chat with no checkout controls, then move it into a project",
  prompt: "",
  expectedModelCalls: 0,
  arrange() {},
  async prepareProject({ projectDirectory }) {
    // A committed repository is a real project the chat can move into.
    await execFileAsync(
      "git",
      [
        "-c",
        "user.name=Palot E2E",
        "-c",
        "user.email=e2e@palot.invalid",
        "commit",
        "--allow-empty",
        "--no-gpg-sign",
        "-m",
        "Chat destination fixture",
      ],
      { cwd: projectDirectory },
    );
  },
  // The chat starts from the UI; the harness's fixture session gets no prompt.
  async run() {},
  async assert(page, { client, llm, projectDirectory, runRoot }) {
    const chatRoot = join((await client.location.get()).directory, ".palot", "chats");

    await page.getByRole("button", { name: "More ways to start", exact: true }).click();
    await page.getByRole("menuitem", { name: /^New chat without a project/ }).click();
    const main = page.getByRole("main", { name: "New chat", exact: true });
    await expect(main.getByText("What do you want to ask?")).toBeVisible();
    await expect(main.getByRole("combobox", { name: "Task destination" })).toHaveCount(0);
    await expect(main.getByRole("button", { name: /^Work in:/ })).toHaveCount(0);

    llm.text("Chat reply ready.");
    await main
      .getByRole("textbox", { name: "Message Palot", exact: true })
      .fill("Quick question without a project");
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    await expect(page.getByText("Chat reply ready.", { exact: true })).toBeVisible({
      timeout: 60_000,
    });

    // The chat lives in its own folder under the server's default folder.
    let chat: Awaited<ReturnType<typeof client.session.get>> | undefined;
    await expect
      .poll(async () => {
        chat = (await client.session.list({ limit: 50 })).data.find((session) =>
          session.location.directory.startsWith(`${chatRoot}/`),
        );
        return chat?.id;
      })
      .toBeTruthy();
    if (!chat) throw new Error("No chat session was created under .palot/chats");
    await access(join(chat.location.directory, ".palot-chat"));
    await client.experimental.session.wait({ sessionID: chat.id });

    // A chat reads as a Chat: no project name, checkout or branch.
    const chatRow = taskRowBySession(page, chat.id).first();
    await expect(chatRow).toBeVisible();
    await expect(chatRow).toHaveAttribute("aria-label", /, Chat(,|$)/);
    await expect(page.getByRole("button", { name: "Chat", exact: true })).toBeVisible();
    const composerBar = page.locator(".palot-composer-shell");
    await expect(composerBar.getByText("Checkout", { exact: true })).toHaveCount(0);
    await expect(composerBar.getByText("Worktree", { exact: true })).toHaveCount(0);
    await page.screenshot({ path: join(runRoot, "project-free-chat.png") });

    // Move it into the project: the conversation continues there as a task.
    const move = page.getByRole("button", { name: "Move to project…", exact: true });
    await move.click();
    const dialog = page.getByRole("dialog", { name: "Move to project" });
    await dialog.getByRole("combobox", { name: "Destination project" }).click();
    await page.getByRole("option", { name: basename(projectDirectory), exact: true }).click();
    await dialog.getByRole("button", { name: "Move to project", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect
      .poll(async () => (await client.session.get({ sessionID: chat!.id })).location.directory)
      .toBe(projectDirectory);
    await expect(move).toHaveCount(0);
    await expect(chatRow).toBeVisible();
    await expect(chatRow).not.toHaveAttribute("aria-label", /, Chat(,|$)/);
    await expect(composerBar.getByText("Checkout", { exact: true })).toBeVisible();
    await page.screenshot({ path: join(runRoot, "project-free-chat-moved.png") });
  },
};
