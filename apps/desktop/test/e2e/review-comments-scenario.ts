import { expect, type Locator, type Page } from "@playwright/test";
import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type { Scenario } from "./scenarios.ts";

const execFileAsync = promisify(execFile);
const FILE = "review-comments.txt";
const OLD = "first line\noriginal line\nlast line\n";
const NEW = "first line\nrevised line\nlast line\n";
const EDIT_PROMPT = "Make the scripted review fixture edit.";
const FIRST_COMMENT = "Check the revised wording.";
const DRAFT_COMMENT = "This comment will be removed.";
const FINAL_COMMENT = "Keep the revised wording.";

export const reviewCommentsScenario: Scenario = {
  description:
    "select a real diff line, edit/remove review drafts, send a comment-only prompt, and inspect persisted metadata and turn changes",
  prompt: "",
  expectedModelCalls: 3,
  arrange(llm) {
    llm.tool("shell", { command: `printf 'first line\\nrevised line\\nlast line\\n' > ${FILE}` });
    llm.text("The review fixture edit is complete.");
    llm.text("The line review was received.");
  },
  async prepareProject({ projectDirectory }) {
    await writeFile(join(projectDirectory, FILE), OLD);
    await execFileAsync("git", ["add", FILE], { cwd: projectDirectory });
    await execFileAsync(
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
        "Review fixture",
      ],
      { cwd: projectDirectory },
    );
  },
  async run(page, { client, session, projectDirectory }) {
    await client.session.prompt({ sessionID: session.id, text: EDIT_PROMPT });
    await client.session.wait({ sessionID: session.id });
    await expect(
      page.getByText("The review fixture edit is complete.", { exact: true }),
    ).toBeVisible();
    expect(await readFile(join(projectDirectory, FILE), "utf8")).toBe(NEW);

    const messages = (await client.message.list({ sessionID: session.id, order: "asc" })).data;
    const editMessage = messages.find((message) => message.type === "user");
    expect(editMessage).toBeDefined();
    const turnDiffs = await client.session.diff({ sessionID: session.id, from: editMessage!.id });
    expect(turnDiffs.map((diff) => diff.file)).toContain(FILE);
    await page.getByRole("button", { name: "View turn changes" }).click();
    const turnTab = page.locator('[data-workbench-pane="right"]').getByRole("tabpanel", {
      name: "Turn changes",
    });
    await expect(turnTab.getByRole("region", { name: "Turn diff review" })).toBeVisible();
    await expect(turnTab.getByText(FILE).first()).toBeVisible();

    await openWorkingReview(page);
    await expect(page.locator(`[data-palot-diff-header="${FILE}"]`)).toBeVisible();
    await page.getByRole("button", { name: `Open ${FILE} in a tab`, exact: true }).click();
    const diff = page.getByLabel(`Diff contents for ${FILE}`, { exact: true });
    await expect(diff).toBeVisible();
    await addLineComment(page, diff, FIRST_COMMENT);
    const pending = page.getByRole("region", { name: "Pending line comments" });
    await expect(pending).toContainText(FIRST_COMMENT);
    await pending.getByRole("button", { name: `Edit comment on ${FILE} line 2` }).click();
    await pending.getByRole("textbox", { name: `Comment on ${FILE} line 2` }).fill(FINAL_COMMENT);
    await pending.getByRole("button", { name: "Save" }).click();
    await expect(pending).toContainText(FINAL_COMMENT);
    await expect(pending).not.toContainText(FIRST_COMMENT);

    await addLineComment(page, diff, DRAFT_COMMENT);
    await expect(pending).toContainText(DRAFT_COMMENT);
    await pending
      .getByRole("button", { name: `Remove comment on ${FILE} line 2` })
      .last()
      .click();
    await expect(pending).not.toContainText(DRAFT_COMMENT);
    await expect(pending).toContainText(FINAL_COMMENT);
    const composer = page.getByRole("textbox", { name: "Message Palot" });
    await expect(composer).toHaveValue("");
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    await client.session.wait({ sessionID: session.id });
    await expect(page.getByText("The line review was received.", { exact: true })).toBeVisible();

    const saved = (await client.message.list({ sessionID: session.id, order: "asc" })).data.filter(
      (message) => message.type === "user",
    );
    expect(saved).toHaveLength(2);
    const sent = saved[1]!;
    expect(sent.text).toBe(
      `The user made the following comment regarding line 2 of ${FILE}: ${FINAL_COMMENT}`,
    );
    expect(sent.metadata).toMatchObject({
      displayText: "",
      comments: [
        {
          path: FILE,
          comment: FINAL_COMMENT,
          origin: "review",
          selection: { startLine: 2, startChar: 0, endLine: 2, endChar: 0 },
        },
      ],
    });
    expect(sent.metadata?.comments).toHaveLength(1);
    await expect(pending).toHaveCount(0);
    await expect(composer).toHaveValue("");
  },
  async assert(page) {
    await expect(page.getByText("The line review was received.", { exact: true })).toBeVisible();
  },
};

async function openWorkingReview(page: Page) {
  const working = page.getByRole("button", { name: "Working", exact: true });
  const showChanges = page.getByRole("button", { name: "Show changes", exact: true });
  if (!(await working.isVisible()) && (await showChanges.isVisible())) await showChanges.click();
  if (!(await working.isVisible())) {
    await page.getByRole("button", { name: "Open workbench surface" }).click();
    await page.getByRole("menuitem", { name: "Changes" }).click();
  }
  await working.click();
}

async function addLineComment(page: Page, diff: Locator, comment: string) {
  // Pierre's actual gutter pointer handler selects the line; do not inject selection state.
  const gutter = diff.locator(
    'diffs-container [data-column-number="2"][data-line-type="change-addition"]',
  );
  await expect(gutter).toBeVisible();
  await gutter.click();
  const editor = page.getByRole("form", { name: `Comment on ${FILE}` });
  await expect(editor).toBeVisible();
  await expect(editor).toContainText("line 2");
  await editor.getByRole("textbox", { name: "Line comment" }).fill(comment);
  await editor.getByRole("button", { name: "Add comment" }).click();
  await expect(editor).toHaveCount(0);
}
