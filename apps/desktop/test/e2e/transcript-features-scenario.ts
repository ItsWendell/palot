import type { SessionMessageInfo } from "@opencode/client";
import { expect } from "@playwright/test";
import { access, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Scenario } from "./scenarios.ts";
import type { PalotApi } from "../../src/shared/opencode-contract";

const PROMPT = "Show the transcript feature fixtures.";
const COMMAND = "printf 'not run until Enter' > terminal-action.txt";
const IMAGE = `data:image/svg+xml;base64,${Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="teal"/></svg>',
).toString("base64")}`;
const RESPONSE = [
  "## Transcript fixtures",
  "```bash",
  COMMAND,
  "```",
  "```html",
  "<h1>Sandboxed preview</h1><style>h1 { color: teal; }</style>",
  '<script>document.body.dataset.scriptRan = "unsafe"; parent.document.body.dataset.agentHtml = "unsafe"</script>',
  '<img src="https://example.invalid/tracker.png">',
  "```",
  "- [ ] Incomplete fixture",
  "- [x] Completed fixture",
  `![Native clipboard fixture](${IMAGE})`,
].join("\n");

export const transcriptFeaturesScenario: Scenario = {
  description:
    "wrap and safely paste reply code, preview isolated HTML, and rewind a user message into the composer",
  prompt: "",
  expectedModelCalls: 2,
  arrange(llm) {
    llm.tool("shell", { command: "printf 'edited by agent\\n' > tasks.md" });
    llm.text(RESPONSE);
  },
  async prepareProject({ projectDirectory }) {
    await writeFile(join(projectDirectory, "tasks.md"), "- [ ] File checkbox\n");
  },
  async seed(client, { projectDirectory, runRoot }) {
    const base = await client.session.create({ location: { directory: projectDirectory } });
    const start = Date.now() - 30_000;
    const messages: SessionMessageInfo[] = [
      { id: "msg_unread_seen_user", type: "user", text: "Seen prompt", time: { created: start } },
      {
        id: "msg_unread_seen_reply",
        type: "assistant",
        agent: "build",
        model: { providerID: "test", id: "test-model" },
        finish: "stop",
        content: [{ type: "text", text: "Seen reply" }],
        time: { created: start + 1, completed: start + 2 },
      },
      {
        id: "msg_unread_new_user",
        type: "user",
        text: "Unseen prompt",
        time: { created: start + 10 },
      },
      {
        id: "msg_unread_new_reply",
        type: "assistant",
        agent: "build",
        model: { providerID: "test", id: "test-model" },
        finish: "stop",
        content: [{ type: "text", text: "Unseen reply" }],
        time: { created: start + 11, completed: start + 12 },
      },
    ];
    const unread = await client.experimental.session.import({
      info: {
        ...base,
        id: `${base.id}_unread`,
        title: "Unread transcript fixture",
        time: { ...base.time, viewed: start + 5, idle: start + 20 },
      },
      messages,
      location: base.location,
    });
    await writeFile(join(runRoot, "unread-session.txt"), unread.id);
    await client.session.remove({ sessionID: base.id });
  },
  async run(page, { client, session, projectDirectory, runRoot }) {
    const unreadID = await readFile(join(runRoot, "unread-session.txt"), "utf8");
    await page.evaluate((id) => {
      location.hash = `#/sessions/${id}`;
    }, unreadID);
    await expect(page.locator("[data-palot-unread]")).toBeVisible();
    await expect(
      page.locator('[data-message-id="msg_unread_new_user"] [data-palot-unread]'),
    ).toBeVisible();
    await page.screenshot({ path: join(runRoot, "transcript-unread.png") });
    await page.evaluate((id) => {
      location.hash = `#/sessions/${id}`;
    }, session.id);
    await expect(page.getByRole("textbox", { name: "Message Palot" })).toBeVisible();
    await client.session.prompt({ sessionID: session.id, text: PROMPT });
    await client.experimental.session.wait({ sessionID: session.id });
    expect(await readFile(join(projectDirectory, "tasks.md"), "utf8")).toBe("edited by agent\n");
    const run = page.getByRole("button", { name: "Run in terminal", exact: true });
    await expect(run).toBeVisible();
    const block = page.locator(".group\\/markdown-code").filter({ has: run });
    await block.getByRole("button", { name: "Wrap code", exact: true }).click();
    await expect(block.getByRole("button", { name: "Unwrap code", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(block).toHaveAttribute("data-code-wrap", "true");
    await expect(block.locator("pre")).toHaveAttribute("style", /white-space: pre-wrap/);
    await page.evaluate(async () => {
      const api = (globalThis as unknown as { palot: PalotApi }).palot;
      await api.writeClipboardText("transcript clipboard baseline");
    });
    await page
      .getByRole("img", { name: "Native clipboard fixture", exact: true })
      .click({ button: "right" });
    await page.getByRole("menuitem", { name: "Copy image", exact: true }).click();
    await expect
      .poll(() =>
        page.evaluate(async () => {
          const api = (globalThis as unknown as { palot: PalotApi }).palot;
          const runtime = await api.runtimeStatus();
          const copied = await api.attachClipboardImages([], runtime.connectionID);
          if (copied.errors.length) return copied.errors;
          return copied.files.map((file) => file.mime);
        }),
      )
      .toEqual(["image/png"]);
    await run.click();
    const terminal = page.locator("[data-workbench-terminal]");
    await expect(terminal).toBeVisible();
    await expect(
      page.getByText("Waiting for safe shell paste support…", { exact: true }),
    ).toHaveCount(0, { timeout: 20_000 });
    const ptyID = await terminal.getAttribute("data-workbench-terminal");
    expect(ptyID).toBeTruthy();
    await expect
      .poll(async () => (await client.experimental.persistentPty.snapshot({ ptyID: ptyID! })).text)
      .toContain(COMMAND);
    await writeFile(
      join(runRoot, "terminal-before-enter.txt"),
      (await client.experimental.persistentPty.snapshot({ ptyID: ptyID! })).text,
    );
    // A command is in the shell editor, not executed by the action.
    await expect
      .poll(async () =>
        access(join(projectDirectory, "terminal-action.txt")).then(
          () => true,
          () => false,
        ),
      )
      .toBe(false);
    await page.screenshot({ path: join(runRoot, "transcript-terminal-paste.png") });
    await terminal.click();
    await page.keyboard.press("Enter");
    await expect
      .poll(() => readFile(join(projectDirectory, "terminal-action.txt"), "utf8").catch(() => ""))
      .toBe("not run until Enter");

    const remoteRequests: string[] = [];
    page.on("request", (request) => {
      if (request.url().startsWith("https://example.invalid")) remoteRequests.push(request.url());
    });
    await page.getByRole("button", { name: "Preview HTML", exact: true }).click();
    const frame = page.locator('iframe[title="HTML preview"]');
    await expect(frame).toBeVisible();
    await expect(frame).toHaveAttribute("sandbox", "");
    await expect(page.getByText("Scripts are disabled in previews", { exact: true })).toBeVisible();
    await expect(
      page
        .frameLocator('iframe[title="HTML preview"]')
        .getByRole("heading", { name: "Sandboxed preview" }),
    ).toBeVisible();
    expect(await page.locator("body").getAttribute("data-agent-html")).toBeNull();
    expect(
      await page
        .frameLocator('iframe[title="HTML preview"]')
        .locator("body")
        .getAttribute("data-script-ran"),
    ).toBeNull();
    expect(remoteRequests).toEqual([]);
    const previewFrame = await frame
      .contentFrame()
      .locator("body")
      .evaluate(() => {
        try {
          void parent.document.body;
          return false;
        } catch {
          return true;
        }
      });
    expect(previewFrame).toBe(true);
    await page.screenshot({ path: join(runRoot, "transcript-html-preview.png") });
    // The exact response wrapper varies with projection; transcript task inputs are read-only.
    for (const checkbox of await page
      .locator('[data-palot-task-view] .markdown input[type="checkbox"]')
      .all())
      await expect(checkbox).toBeDisabled();

    const edit = page.getByRole("button", { name: "Edit from here", exact: true }).first();
    page.once("dialog", (dialog) => dialog.accept());
    await edit.click();
    await expect(page.getByRole("textbox", { name: "Message Palot" })).toHaveValue(PROMPT);
    await expect
      .poll(async () => (await client.session.get({ sessionID: session.id })).revert?.messageID)
      .toBeTruthy();
    await expect(page.getByRole("button", { name: "Run in terminal", exact: true })).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "Transcript fixtures", exact: true }),
    ).toHaveCount(0);
    expect(await readFile(join(projectDirectory, "tasks.md"), "utf8")).toBe(
      "- [ ] File checkbox\n",
    );
    await page.screenshot({ path: join(runRoot, "transcript-edit-from-here.png") });
  },
  async assert(page, { llm }) {
    await expect(page.getByRole("textbox", { name: "Message Palot" })).toHaveValue(PROMPT);
    expect(llm.scriptedCalls()).toBe(2);
  },
};
