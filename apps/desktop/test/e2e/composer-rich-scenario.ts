import { expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Scenario } from "./scenarios.ts";
import { isTitleRequest } from "./test-llm-server.ts";

const MARKDOWN =
  "# Heading\n**bold** _italic_ `code`\n- first\n1. second\n> quote\n```ts\nconst answer = 42;\n```\nhttps://github.com/acme/repo/pull/42\n";
const TERMINAL = "> Terminal output\n>\n> ```text\n> exact stderr\n> ```\n\n";

export const composerRichScenario: Scenario = {
  description: "round-trip rich Markdown and atomic context, then compare independent model tasks",
  prompt: "",
  expectedModelCalls: 3,
  arrange(llm) {
    llm.text("Rich prompt received.");
    llm.text("Comparison reply one.");
    llm.text("Comparison reply two.");
  },
  async prepare(home) {
    const directory = join(home, ".config", "opencode");
    await mkdir(directory, { recursive: true });
    await writeFile(
      join(directory, "opencode.json"),
      JSON.stringify({
        providers: {
          test: {
            models: {
              "compare-model": {
                name: "Compare Model",
                limit: { context: 100_000, output: 10_000 },
              },
            },
          },
        },
      }),
    );
  },
  async prepareProject({ projectDirectory }) {
    await writeFile(join(projectDirectory, "fixture.txt"), "Rich file reference content.\n");
    const exec = promisify(execFile);
    await exec("git", ["add", "fixture.txt"], { cwd: projectDirectory });
    await exec(
      "git",
      [
        "-c",
        "user.name=Palot E2E",
        "-c",
        "user.email=palot-e2e@example.invalid",
        "-c",
        "commit.gpgsign=false",
        "commit",
        "--quiet",
        "-m",
        "Seed rich composer",
      ],
      { cwd: projectDirectory },
    );
  },
  async run(page, { session, client, runRoot, projectDirectory, llm }) {
    await page.evaluate(() => {
      location.hash = "#/settings/general";
    });
    const beta = page.getByRole("switch", { name: "Rich composer (beta)", exact: true });
    await expect(beta).not.toBeChecked();
    await beta.click();
    await page.evaluate((id) => {
      location.hash = `#/sessions/${id}`;
    }, session.id);
    const input = page.getByRole("textbox", { name: "Message Palot", exact: true });
    await expect(input).toHaveAttribute("contenteditable", "true");
    await input.fill(MARKDOWN + TERMINAL);
    await expect(page.locator('[data-composer-chip="pull request"]')).toHaveText("PR #42");
    await expect(page.locator('[data-composer-chip="terminal"]')).toHaveText("Terminal output");
    await expect(input.locator(".font-semibold").first()).toBeVisible();
    await input.press("ControlOrMeta+End");
    await input.pressSequentially("@fixture");
    await page.getByRole("option").filter({ hasText: "fixture.txt" }).first().click();
    await expect(input.locator('[data-composer-chip="file"]')).toHaveText("@fixture.txt");
    await input.press("ControlOrMeta+a");
    const copied = await input.evaluate((element) => {
      const clipboardData = new DataTransfer();
      element.dispatchEvent(
        new ClipboardEvent("cut", { clipboardData, bubbles: true, cancelable: true }),
      );
      element.dispatchEvent(
        new ClipboardEvent("paste", { clipboardData, bubbles: true, cancelable: true }),
      );
      return clipboardData.getData("text/plain");
    });
    expect(copied).toBe(MARKDOWN + TERMINAL + "@fixture.txt ");
    await expect(input.locator('[data-composer-chip="file"]')).toHaveCount(1);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(input.locator('[data-composer-chip="file"]')).toHaveText("@fixture.txt");
    await input.press("ControlOrMeta+End");
    await input.pressSequentially("undo probe");
    await expect(input).toContainText("undo probe");
    await input.press("ControlOrMeta+z");
    await expect(input).not.toContainText("undo probe");
    await expect(input.locator('[data-composer-chip="file"]')).toHaveCount(1);
    await input.press("ControlOrMeta+Shift+z");
    await expect(input).toContainText("undo probe");
    await input.press("ControlOrMeta+z");
    for (const width of [1440, 920]) {
      await page.setViewportSize({ width, height: width === 920 ? 640 : 900 });
      for (const colorScheme of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme });
        await page.screenshot({ path: join(runRoot, `composer-rich-${width}-${colorScheme}.png`) });
      }
    }
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    await expect(page.getByText("Rich prompt received.", { exact: true })).toBeVisible();
    const messages = (await client.message.list({ sessionID: session.id })).data;
    const user = messages.find((message) => message.type === "user")!;
    expect(user.text).toBe(MARKDOWN + TERMINAL + "@fixture.txt ");
    expect(JSON.stringify(user)).toContain("fixture.txt");
    expect(
      JSON.stringify(llm.requests.filter(({ body }) => !isTitleRequest(body))[0]!.body),
    ).toContain("Rich file reference content.");

    // Large text goes through the native staging/upload path, without touching the draft.
    await input.evaluate((element) => {
      const clipboardData = new DataTransfer();
      clipboardData.setData("text/plain", "large pasted text\n".repeat(2100));
      element.dispatchEvent(
        new ClipboardEvent("paste", { clipboardData, bubbles: true, cancelable: true }),
      );
    });
    await expect(page.getByRole("group", { name: "Attachments", exact: true })).toContainText(
      "pasted-text-",
    );
    await expect(input).toHaveText("");
    await input.evaluate(async (element, location) => {
      const { profileID } = await window.palot.runtimeStatus();
      const dataTransfer = new DataTransfer();
      dataTransfer.setData("text/plain", "fixture.txt");
      dataTransfer.setData(
        "application/x-palot-workspace-file",
        JSON.stringify({ profileID, ...location, path: "fixture.txt" }),
      );
      const box = element.getBoundingClientRect();
      element.dispatchEvent(
        new DragEvent("drop", {
          dataTransfer,
          clientX: box.x + 20,
          clientY: box.y + 20,
          bubbles: true,
          cancelable: true,
        }),
      );
    }, session.location);
    await expect(input.locator('[data-composer-chip="file"]')).toHaveText("@fixture.txt");
    await expect(input).toHaveText("@fixture.txt ");

    const projects = await client.project.list();
    const project = projects.find((entry) => entry.canonical === projectDirectory)!;
    await page.evaluate((projectID) => {
      location.hash = `#/new?project=${encodeURIComponent(projectID)}`;
    }, project.id);
    await page.getByRole("main", { name: "New task", exact: true }).waitFor();
    // Leave New worktree selected: every sibling must get a different directory.
    await expect(page.getByRole("button", { name: /^Work in:/ })).toHaveText("New worktree");
    await input.fill("Compare this exact prompt.");
    await input.press("ControlOrMeta+End");
    await input.pressSequentially(" @fixture");
    await page.getByRole("option").filter({ hasText: "fixture.txt" }).first().click();
    await page.getByRole("button", { name: "More send options", exact: true }).click();
    await page.getByRole("menuitem", { name: "Send to several models…", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("checkbox", { name: /Test Model/ }).click();
    await dialog.getByRole("checkbox", { name: /Compare Model/ }).click();
    await dialog.getByRole("button", { name: "Send to 2 models", exact: true }).click();
    await expect(dialog.getByRole("heading", { name: "Compare models", exact: true })).toBeVisible({
      timeout: 60_000,
    });
    await expect(dialog.getByText("Comparison reply one.", { exact: true })).toBeVisible({
      timeout: 30_000,
    });
    await expect(dialog.getByText("Comparison reply two.", { exact: true })).toBeVisible({
      timeout: 30_000,
    });
    await page.screenshot({ path: join(runRoot, "composer-model-comparison.png") });
    const tasks = (await client.session.list()).data.filter((task) =>
      task.title?.startsWith("Compare "),
    );
    expect(tasks).toHaveLength(2);
    expect(new Set(tasks.map((task) => task.location.directory)).size).toBe(2);
    expect(tasks.every((task) => task.location.directory !== projectDirectory)).toBe(true);
    expect(new Set(tasks.map((task) => task.model?.id))).toEqual(
      new Set(["test-model", "compare-model"]),
    );
    expect(tasks[0]!.title!.split(" · ").slice(0, 2)).toEqual(
      tasks[1]!.title!.split(" · ").slice(0, 2),
    );
    for (const task of tasks)
      expect(
        (await client.message.list({ sessionID: task.id })).data
          .filter((message) => message.type === "user")
          .map((message) => message.text),
      ).toEqual(["Compare this exact prompt. @fixture.txt "]);
    const modelRequests = llm.requests.filter(({ body }) => !isTitleRequest(body));
    expect(modelRequests).toHaveLength(3);
    for (const request of modelRequests.slice(1))
      expect(JSON.stringify(request.body)).toContain("Rich file reference content.");
    await writeFile(
      join(runRoot, "composer-rich.json"),
      JSON.stringify(
        {
          tasks: tasks.map(({ id, title, model, location }) => ({ id, title, model, location })),
          sourceText: user.text,
        },
        null,
        2,
      ),
    );
  },
  async assert() {},
};
