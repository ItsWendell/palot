import type { SessionMessageInfo } from "@opencode/client";
import { expect, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Scenario } from "./scenarios.ts";
import { isTitleRequest } from "./test-llm-server.ts";

const PROMPT_COUNT = 16;
const SOURCE_DRAFT = "Keep this unsent source draft.";
const SELECTED_TEXT = "History prompt 02: revise the boundary fixture.";
// Restored prompts keep their display text; file comments come back as structured line comments.
const RESTORED_TEXT = "Revise the boundary fixture.";
const SOURCE_TITLE = "Conversation history fixture";
const FORK_REPLY = "Fork reply after the notice.";

export const conversationToolsScenario: Scenario = {
  description:
    "page prompt history, jump by stable ID, fork before a prompt without sending or losing the source draft, and show the fork notice once delivered",
  prompt: "",
  expectedModelCalls: 1,
  arrange(llm) {
    llm.text(FORK_REPLY);
  },
  async run(page, { client, session, llm, runRoot }) {
    const base = Date.now() - 120_000;
    const messages: SessionMessageInfo[] = Array.from({ length: PROMPT_COUNT }, (_, index) => {
      const number = String(index + 1).padStart(2, "0");
      return [
        {
          id: `msg_history_user_${number}`,
          type: "user" as const,
          time: { created: base + index * 2_000 },
          text:
            index === 1
              ? SELECTED_TEXT
              : `History prompt ${number}: review fixture turn ${number}.`,
          ...(index === 1
            ? {
                metadata: {
                  displayText: "Revise the boundary fixture.",
                  comments: [
                    {
                      path: "fixture.ts",
                      comment: "Keep the null guard.",
                      selection: { startLine: 2, endLine: 4, startChar: 0, endChar: 0 },
                      origin: "review",
                    },
                  ],
                },
              }
            : {}),
        },
        {
          id: `msg_history_assistant_${number}`,
          type: "assistant" as const,
          time: { created: base + index * 2_000 + 1, completed: base + index * 2_000 + 2 },
          agent: "build",
          model: { providerID: "test", id: "test-model" },
          finish: "stop" as const,
          content: [
            {
              type: "text" as const,
              text: `Completed fixture turn ${number}.\n\n${"History content for viewport navigation. ".repeat(12)}`,
            },
          ],
        },
      ];
    }).flat();
    // Official transfer API seeds settled history without provider calls or renderer injection.
    const source = await client.experimental.session.import({
      info: { ...session, id: `${session.id}_history`, title: SOURCE_TITLE },
      messages,
      location: session.location,
    });
    let forkID: string | null = null;
    try {
      await navigate(page, source.id);
      await expect(page.getByRole("textbox", { name: "Message Palot" })).toBeVisible();
      await expect(page.locator('[data-message-id="msg_history_user_16"]')).toBeVisible();
      await page.getByRole("textbox", { name: "Message Palot" }).fill(SOURCE_DRAFT);
      await page.getByRole("button", { name: "Task actions", exact: true }).click();
      await page.getByRole("menuitem", { name: "Jump to message…", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Jump to message" });
      // Earlier prompts come from OpenCode's user-message index, not transcript pages.
      await expect(dialog.getByRole("status")).toContainText("Searching all");
      await dialog.getByRole("textbox", { name: "Search prompts" }).fill("History prompt 02");
      await expect(dialog.getByRole("button", { name: new RegExp(SELECTED_TEXT) })).toBeVisible();
      await expect(page.locator('[data-message-id="msg_history_user_02"]')).toHaveCount(0);
      await dialog.getByRole("button", { name: new RegExp(SELECTED_TEXT) }).click();
      await expect(dialog).toHaveCount(0);
      const target = page.locator('[data-message-id="msg_history_user_02"]');
      await expect(target).toBeVisible();
      await expect
        .poll(async () => {
          const row = await target.boundingBox();
          const viewport = await page
            .getByRole("region", { name: "Task transcript", exact: true })
            .boundingBox();
          return row && viewport ? Math.abs(row.y - viewport.y) : Number.POSITIVE_INFINITY;
        })
        .toBeLessThan(8);
      await page.getByRole("button", { name: "Task actions", exact: true }).click();
      await page.getByRole("menuitem", { name: "Next user turn", exact: true }).click();
      await expect(page.locator('[data-message-id="msg_history_user_03"]')).toBeVisible();
      await page.getByRole("button", { name: "Task actions", exact: true }).click();
      await page.getByRole("menuitem", { name: "Previous user turn", exact: true }).click();
      await expect(target).toBeVisible();

      await page.getByRole("button", { name: "Task actions", exact: true }).click();
      await page.getByRole("menuitem", { name: "Fork from prompt…", exact: true }).click();
      const forkDialog = page.getByRole("dialog", { name: "Fork from prompt" });
      await forkDialog.getByRole("textbox", { name: "Search prompts" }).fill("History prompt 02");
      await forkDialog.getByRole("button", { name: new RegExp(SELECTED_TEXT) }).click();
      await expect(page.getByRole("textbox", { name: "Message Palot" })).toHaveJSProperty(
        "value",
        RESTORED_TEXT,
      );
      await expect(
        page
          .getByRole("group", { name: "Pending line comments" })
          .getByRole("button", { name: "Remove comment on fixture.ts line 2", exact: true }),
      ).toBeVisible();
      forkID = new URL(page.url()).hash.split("?")[0]!.slice("#/sessions/".length);
      expect(forkID).not.toBe(source.id);
      const forked = await client.session.get({ sessionID: forkID });
      expect(forked.fork).toEqual({
        sessionID: source.id,
        boundary: { type: "before", messageID: "msg_history_user_02" },
      });
      const copied = await client.experimental.session.export({ sessionID: forkID });
      // OpenCode assigns new IDs to copied messages. The selected prompt is excluded.
      expect(
        copied.messages.filter((message) => message.type === "user").map((message) => message.text),
      ).toEqual(["History prompt 01: review fixture turn 01."]);
      // OpenCode (2.3.0+) queues a synthetic fork notice for the agent's next turn. It is not the
      // user's message: no pending row, and the composer still sends rather than queues.
      expect(await client.session.inbox.list({ sessionID: forkID })).toEqual([
        expect.objectContaining({ id: `msg_fork_notice_${forkID}`, type: "synthetic" }),
      ]);
      await expect(page.getByRole("region", { name: "Pending messages" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Send message", exact: true })).toBeVisible();
      await expect(page.getByRole("status", { name: /^Forked from/ })).toHaveCount(0);
      expect(llm.scriptedCalls()).toBe(0);
      await page.screenshot({ path: join(runRoot, "conversation-fork-restored.png") });
      await navigate(page, source.id);
      await expect(page.getByRole("textbox", { name: "Message Palot" })).toHaveJSProperty(
        "value",
        SOURCE_DRAFT,
      );
      expect(
        (await client.experimental.session.export({ sessionID: source.id })).messages,
      ).toHaveLength(messages.length);

      // The first prompt in the fork delivers the notice ahead of it, shown as one quiet row.
      await navigate(page, forkID);
      await expect(page.getByRole("textbox", { name: "Message Palot" })).toHaveJSProperty(
        "value",
        RESTORED_TEXT,
      );
      // The restored comment points at fixture.ts, which this project does not have.
      await page
        .getByRole("group", { name: "Pending line comments" })
        .getByRole("button", { name: "Remove comment on fixture.ts line 2", exact: true })
        .click();
      await page.getByRole("button", { name: "Send message", exact: true }).click();
      await llm.waitForCalls(1);
      await expect(page.getByText(FORK_REPLY)).toBeVisible();
      await expect(
        page.getByRole("status", { name: `Forked from ${SOURCE_TITLE}`, exact: true }),
      ).toBeVisible();
      await expect(page.getByText("<fork-notice>")).toHaveCount(0);
      expect(await client.session.inbox.list({ sessionID: forkID })).toHaveLength(0);
      await page.screenshot({ path: join(runRoot, "conversation-fork-notice.png") });
    } finally {
      await navigate(page, session.id);
      if (forkID) await client.session.remove({ sessionID: forkID });
      await client.session.remove({ sessionID: source.id });
    }
  },
  async assert(_page, { llm }) {
    expect(llm.scriptedCalls()).toBe(1);
  },
};

const PERMISSION_AGENT = "conversation-permission-fixture";
const COMMAND = "printf 'CONVERSATION_PERMISSION_PREVIEW'";
const REASON = "Do not execute this command. Explain the read-only alternative.";
const FINAL = "Protected command was denied.";

export const conversationPermissionScenario: Scenario = {
  tier: "core",
  description:
    "preview a real protected tool and send optional denial feedback through the official permission API",
  prompt: "Run the scripted protected command.",
  expectedModelCalls: 2,
  async prepare(home) {
    const directory = join(home, ".config", "opencode");
    await mkdir(directory, { recursive: true });
    await writeFile(
      join(directory, "opencode.json"),
      JSON.stringify({
        agents: {
          [PERMISSION_AGENT]: {
            mode: "primary",
            model: "test/test-model",
            permissions: [{ action: "shell", resource: "*", effect: "ask" }],
          },
        },
      }),
      { mode: 0o600 },
    );
  },
  arrange(llm) {
    llm.tool("shell", { command: COMMAND });
    llm.text(FINAL);
  },
  async run(page, { client, session, projectDirectory, llm, runRoot }) {
    const location = { directory: projectDirectory };
    await expect
      .poll(
        async () =>
          (await client.agent.list({ location })).data.find(
            (agent) => agent.id === PERMISSION_AGENT,
          )?.permissions,
        { timeout: 30_000, message: "Wait for the protected-command agent permissions" },
      )
      .toContainEqual({ action: "shell", resource: "*", effect: "ask" });
    await client.session.switchAgent({ sessionID: session.id, agent: PERMISSION_AGENT });
    await client.session.prompt({
      sessionID: session.id,
      text: "Run the scripted protected command.",
    });
    await expect
      .poll(async () => (await client.permission.list({ sessionID: session.id })).length)
      .toBe(1);
    const request = (await client.permission.list({ sessionID: session.id }))[0]!;
    const card = page.locator(`[data-palot-request-id="${request.id}"]`);
    await expect(card).toBeVisible();
    // The tool row waiting on the request offers "Needs approval", which focuses the request.
    const awaiting = page.locator("[data-palot-awaiting-approval]");
    await expect(awaiting).toHaveCount(1);
    const focusInCard = () => card.evaluate((element) => element.contains(document.activeElement));
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    expect(await focusInCard()).toBe(false);
    await awaiting.getByRole("button", { name: "Needs approval", exact: true }).click();
    await expect.poll(focusInCard).toBe(true);
    await page.screenshot({ path: join(runRoot, "needs-approval.png") });
    await card.locator("summary").filter({ hasText: "Command" }).click();
    await expect(card.locator("pre")).toHaveText(COMMAND);
    await card.getByRole("button", { name: "Deny", exact: true }).click();
    await card.getByRole("textbox", { name: "Rejection reason (optional)" }).fill(REASON);
    await card.getByRole("button", { name: "Cancel", exact: true }).click();
    expect(
      (await client.permission.list({ sessionID: session.id })).map((entry) => entry.id),
    ).toContain(request.id);
    await card.getByRole("button", { name: "Deny", exact: true }).click();
    await page.screenshot({ path: join(runRoot, "conversation-permission-feedback.png") });
    await card.getByRole("button", { name: "Confirm denial", exact: true }).click();
    await client.experimental.session.wait({ sessionID: session.id });
    await expect(page.getByText(FINAL, { exact: true })).toBeVisible();
    await expect(awaiting).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Needs approval" })).toHaveCount(0);
    const calls = llm.requests.filter((request) => !isTitleRequest(request.body));
    expect(calls).toHaveLength(2);
    const modelMessages = calls[1]!.body.messages as Array<{ role: string; content?: unknown }>;
    const toolResults = modelMessages.filter((message) => message.role === "tool");
    expect(toolResults.length).toBeGreaterThan(0);
    // OpenCode 2.2.6 reports the denial as permission.rejected; earlier betas used tool.execution.
    expect(JSON.stringify(toolResults)).toContain("permission.rejected");
    // beta-19365 dropped the denial reason from the model's tool result; OpenCode 2.2.6
    // includes it. The renderer unit test verifies the real generated client's outgoing
    // permission-reply bytes, so this records whether the reason arrived rather than
    // asserting it.
    await writeFile(
      join(runRoot, "permission-feedback-boundary.json"),
      JSON.stringify(
        {
          boundary:
            "native denial and model continuation; reason payload covered by official-client transport unit test",
          reasonPresentInModelToolResult: JSON.stringify(toolResults).includes(REASON),
          toolResults,
          upstream:
            "e628143448512f97b2341fb0958064e150d84849:packages/core/src/tool/plugin/shell.ts:264-268",
        },
        null,
        2,
      ),
    );
  },
  async assert(_page, { client, session }) {
    expect(await client.permission.list({ sessionID: session.id })).toHaveLength(0);
  },
};

async function navigate(page: Page, sessionID: string) {
  const url = new URL(page.url());
  url.hash = `/sessions/${sessionID}`;
  await page.goto(url.href, { waitUntil: "domcontentloaded" });
}
