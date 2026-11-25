import type { OpenCodeClient, SessionInfo } from "@opencode/client";
import { expect, type Locator, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Scenario } from "./scenarios.ts";
import { taskRowBySession } from "./task-list.ts";

const CHILD_TITLE = "Coordinate the decision";
const GRANDCHILD_TITLE = "Collect the decision";
const QUESTION = "Which verification should the delegated task run?";
const ANSWER = "Focused tests";
const CHILD_DONE = "CHILD RESUMED AFTER DELEGATED ANSWER";
const GRANDCHILD_DONE = "GRANDCHILD RECEIVED THE ANSWER";
const PARENT_DONE = "PARENT FINISHED AFTER DELEGATED ANSWER";
const PARENT_WAITING = "Waiting for the coordinator.";
const CHILD_WAITING = "Waiting for the collector.";
const CHILD_PROMPT = "Delegate collecting the verification decision to another general subagent.";
const GRANDCHILD_PROMPT = "Ask the user which verification to run, then report their answer.";
// Calls before the answer: parent launch, wait and first report; coordinator launch and wait;
// collector question. The answer adds the collector's, coordinator's and parent's last turns.
const CALLS_BEFORE_ANSWER = 6;
const CALLS = 9;
const REQUESTS = "[data-palot-request-session-id][data-palot-request-id]";
// The panel shows one request at a time, paged in arrival order.
const PANEL = '[data-slot="composer-panel"][aria-label="Pending request"]';
const TIMEOUT = 30_000;
// The list's 3 s order hold after a row's last change, plus a margin.
const SETTLE_TIMEOUT = 6_000;

export const subagentRequestsScenario: Scenario = {
  description:
    "answer nested subagent questions from the parent, retain simultaneous owner-scoped requests across reload, and check compact layout",
  prompt: "Delegate the verification decision and summarize the result without leaving this task.",
  expectedModelCalls: CALLS,
  async prepare(home) {
    const directory = join(home, ".config", "opencode");
    await mkdir(directory, { recursive: true });
    // General agents may deny questions by default. Explicitly enable the two
    // official tools in this isolated fixture, not in the user's configuration.
    await writeFile(
      join(directory, "opencode.json"),
      JSON.stringify({
        experimental: { subagent_depth: 2 },
        agents: {
          general: {
            permissions: [
              { action: "question", resource: "*", effect: "allow" },
              { action: "subagent", resource: "*", effect: "allow" },
            ],
          },
        },
      }),
      { mode: 0o600 },
    );
  },
  arrange(llm) {
    // Subagents run in the background, so a parent's next call races its child's first one:
    // each session answers from its own queue, keyed by its own task.
    llm.tool("subagent", { agent: "general", description: CHILD_TITLE, prompt: CHILD_PROMPT });
    llm.text(PARENT_WAITING);
    // The coordinator goes idle after launching the collector and reports; then reports again.
    llm.text(PARENT_WAITING);
    llm.text(PARENT_DONE);
    llm.route(
      CHILD_PROMPT,
      (script) => {
        script.tool("subagent", {
          agent: "general",
          description: GRANDCHILD_TITLE,
          prompt: GRANDCHILD_PROMPT,
        });
        script.text(CHILD_WAITING);
        script.text(CHILD_DONE);
      },
      { firstUserMessage: true },
    );
    llm.route(
      GRANDCHILD_PROMPT,
      (script) => {
        script.tool("question", {
          questions: [
            {
              header: "Verification",
              question: QUESTION,
              options: [
                { label: ANSWER, description: "Run only the tests covering the changed behavior." },
                { label: "Full suite", description: "Run all project tests before continuing." },
              ],
            },
          ],
        });
        script.text(GRANDCHILD_DONE);
      },
      { firstUserMessage: true },
    );
  },
  async run(page, { client, session, llm, runRoot }) {
    const parentHash = await page.evaluate(() => location.hash);
    await client.session.prompt({ sessionID: session.id, text: this.prompt });
    const child = await onlyChild(client, session.id);
    const grandchild = await onlyChild(client, child.id);
    await expect
      .poll(async () => (await client.session.form.list({ sessionID: grandchild.id })).length, {
        timeout: TIMEOUT,
      })
      .toBe(1);
    const [question] = await client.session.form.list({ sessionID: grandchild.id });
    expect(question!.metadata?.kind).toBe("question");
    const delegatedCard = requestCard(page, grandchild.id, question!.id, "question");
    await expect(delegatedCard).toBeVisible({ timeout: TIMEOUT });
    await expect(delegatedCard).toContainText(QUESTION);
    await expect(page.locator(`[data-palot-subagent-launch="${child.id}"]`)).toContainText(
      "needs input",
    );
    await expect(delegatedCard).toContainText("From general subagent");
    await assertParentSelected(page, parentHash, this.prompt);

    // session.create has no parentID in beta-19507. The actual nested subagent
    // tools above create the hierarchy; only extra pending requests are seeded.
    const extra = await client.session.form.create({
      sessionID: child.id,
      title: "Optional coordinator decision",
      metadata: { kind: "question" },
      fields: [
        {
          key: "q0",
          type: "string",
          title: "Should the coordinator include a separate appendix?",
          required: true,
          options: [{ value: "Include appendix", label: "Include appendix" }],
          custom: true,
        },
      ],
    });
    await client.session.update({
      sessionID: child.id,
      permissions: [{ action: "shell", resource: "*", effect: "ask" }],
    });
    // The public permission API evaluates a request without executing a shell.
    const permission = await client.permission.create({
      sessionID: child.id,
      action: "shell",
      resources: ["printf 'SUBAGENT_REQUESTS_FIXTURE'"],
    });
    expect(permission.effect).toBe("ask");
    const extraCard = requestCard(page, child.id, extra.id, "question");
    const permissionCard = requestCard(page, child.id, permission.id, "permission");
    await expect(page.locator(PANEL)).toContainText(/\d of 3/);
    await showRequest(page, extraCard);
    await expect(extraCard).toContainText("From general subagent");
    await showRequest(page, permissionCard);
    await expect(permissionCard).toContainText("From general subagent");
    await expectPendingQuestion(client, grandchild.id, question!.id);
    await expectPendingQuestion(client, child.id, extra.id);
    expect(await client.session.form.list({ sessionID: session.id })).toEqual([]);
    await llm.waitForCalls(CALLS_BEFORE_ANSWER);
    expect(llm.scriptedCalls()).toBe(CALLS_BEFORE_ANSWER);

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator(PANEL)).toContainText(/\d of 3/, { timeout: TIMEOUT });
    await showRequest(page, delegatedCard);
    await expect(delegatedCard).toContainText(QUESTION);
    await showRequest(page, extraCard);
    await expect(extraCard).toContainText("From general subagent");
    await showRequest(page, permissionCard);
    await expect(permissionCard).toContainText("From general subagent");
    await assertParentSelected(page, parentHash, this.prompt);

    // The child remains inspectable, including its own forms and nested requests.
    await page.locator(`[data-palot-subagent-launch="${child.id}"]`).click();
    await expect(page.locator(`[data-palot-subagent-session="${child.id}"]`)).toBeVisible();
    // The child takes messages through the normal composer.
    await expect(page.locator("[data-palot-subagent-composer-note]")).toContainText(
      "Messages go to this subagent",
    );
    // The child's own requests carry no subagent badge; its subagent's do.
    await showRequest(page, extraCard);
    await expect(extraCard).toContainText("Should the coordinator include a separate appendix?");
    await showRequest(page, delegatedCard);
    await expect(delegatedCard).toContainText("From general subagent");
    await page.getByRole("button", { name: /^Open parent task: / }).click();
    await assertParentSelected(page, parentHash, this.prompt);
    await expect(page.locator(PANEL)).toContainText(/\d of 3/);
    await showRequest(page, delegatedCard);
    await captureLayout(page, delegatedCard, runRoot);

    // Dismissing the direct child's extra question must not answer or dismiss
    // the grandchild's real blocked tool, nor the child's separate permission.
    await showRequest(page, extraCard);
    await extraCard.getByRole("button", { name: "Dismiss", exact: true }).click();
    await expect(extraCard).toHaveCount(0);
    await expect
      .poll(
        async () =>
          (await client.session.form.get({ sessionID: child.id, formID: extra.id })).state,
      )
      .toEqual({ status: "cancelled" });
    await expectPendingQuestion(client, grandchild.id, question!.id);
    expect(
      (await client.permission.list({ sessionID: child.id })).map((entry) => entry.id),
    ).toEqual([permission.id]);
    await assertParentSelected(page, parentHash, this.prompt);

    await showRequest(page, permissionCard);
    // The empty text field doubles as feedback, so Allow once is the composer's primary.
    await page.getByRole("button", { name: "Allow once", exact: true }).click();
    await expect(permissionCard).toHaveCount(0);
    await expect.poll(() => client.permission.list({ sessionID: child.id })).toEqual([]);
    await expectPendingQuestion(client, grandchild.id, question!.id);
    expect(llm.scriptedCalls()).toBe(CALLS_BEFORE_ANSWER);

    // Trusted keyboard selection and click submission exercise the real renderer
    // handlers. The service state and tool result below prove reply ownership.
    await showRequest(page, delegatedCard);
    await delegatedCard.locator('[data-slot="questionnaire-item"]:visible').focus();
    await page.keyboard.press("1");
    await expect(delegatedCard.locator(`input[value="${ANSWER}"]`)).toBeChecked();
    await page.getByRole("button", { name: "Submit answer", exact: true }).click();
    await expect(delegatedCard).toHaveCount(0);
    await expect
      .poll(
        async () =>
          (await client.session.form.get({ sessionID: grandchild.id, formID: question!.id })).state,
      )
      .toEqual({ status: "answered", answer: { q0: ANSWER } });
    await client.experimental.session.wait(
      { sessionID: session.id },
      { signal: AbortSignal.timeout(TIMEOUT) },
    );
    await expect(page.getByText(PARENT_DONE, { exact: true })).toBeVisible({ timeout: TIMEOUT });
    await assertParentSelected(page, parentHash, this.prompt);
    await expect(page.getByRole("textbox", { name: "Message Palot" })).toBeVisible();
    await expect(page.locator(REQUESTS)).toHaveCount(0);

    const grandchildMessages = (
      await client.message.list({ sessionID: grandchild.id, order: "asc" })
    ).data;
    const results = grandchildMessages.flatMap((message) =>
      message.type === "assistant"
        ? message.content.flatMap((part) =>
            part.type === "tool" && part.name === "question" && part.state.status === "completed"
              ? part.state.content.flatMap((content) =>
                  content.type === "text" ? [content.text] : [],
                )
              : [],
          )
        : [],
    );
    expect(results.some((result) => result.includes(QUESTION) && result.includes(ANSWER))).toBe(
      true,
    );
    await expectAssistantText(client, grandchild.id, GRANDCHILD_DONE);
    await expectAssistantText(client, child.id, CHILD_DONE);
    expect(await client.session.form.list({ sessionID: session.id })).toEqual([]);
    // The coordinator first reported while the collector still waited for the answer: OpenCode
    // lists the collector as still running, so that report is not "Finished"; its last one is.
    const reports = page.locator('[data-palot-background-report="subagent"]');
    await expect(reports).toHaveCount(2);
    await expect(reports).toContainText([
      `1 subagent waiting for its subagent · ${CHILD_TITLE}`,
      `Finished 1 subagent · ${CHILD_TITLE}`,
    ]);
    // The task's row reads idle at once; the list holds its place for a moment after a change
    // (DESIGN: "The order holds"), then moves it out of Working.
    const row = taskRowBySession(page, session.id);
    await expect(row).not.toHaveAttribute("data-status", "working");
    await expect
      .poll(() => row.getAttribute("data-placement"), { timeout: SETTLE_TIMEOUT })
      .not.toBe("working");
    await page.screenshot({ path: join(runRoot, "subagent-requests-completed.png") });
  },
  async assert(page, { llm }) {
    await expect(page.getByText(PARENT_DONE, { exact: true })).toBeVisible();
    await expect(page.locator(REQUESTS)).toHaveCount(0);
    expect(llm.scriptedCalls()).toBe(CALLS);
  },
};

/** Pages the request panel until `card` is the request it shows. */
async function showRequest(page: Page, card: Locator) {
  for (let attempt = 0; attempt < 4 && !(await card.isVisible()); attempt += 1) {
    await page
      .locator(`${PANEL} [data-state="open"] > [data-slot="request-panel"]`)
      .getByRole("button", { name: "Next request" })
      .click();
  }
  await expect(card).toBeVisible();
}

async function onlyChild(client: OpenCodeClient, parentID: string): Promise<SessionInfo> {
  await expect
    .poll(async () => (await client.session.list({ parentID })).data.length, { timeout: TIMEOUT })
    .toBe(1);
  return (await client.session.list({ parentID })).data[0]!;
}

function requestCard(
  page: Page,
  sessionID: string,
  requestID: string,
  type: "question" | "permission",
) {
  // Only the request in view: one fading out after paging is closed and takes no input.
  return page.locator(
    `[data-state="open"] > [data-palot-request-session-id="${sessionID}"][data-palot-request-id="${requestID}"][data-palot-request-type="${type}"]`,
  );
}

async function assertParentSelected(page: Page, hash: string, prompt: string) {
  // Native navigation may add the explicit connection profile to the route.
  await expect
    .poll(() => page.evaluate(() => location.hash.split("?")[0]))
    .toBe(hash.split("?")[0]);
  await expect(page.locator("[data-palot-subagent-session]")).toHaveCount(0);
  await expect(page.getByText(prompt, { exact: true })).toBeVisible();
}

async function expectPendingQuestion(client: OpenCodeClient, sessionID: string, formID: string) {
  expect((await client.session.form.get({ sessionID, formID })).state).toEqual({
    status: "pending",
  });
  expect((await client.session.form.list({ sessionID })).map((entry) => entry.id)).toContain(
    formID,
  );
}

async function expectAssistantText(client: OpenCodeClient, sessionID: string, text: string) {
  const messages = (await client.message.list({ sessionID, order: "asc" })).data;
  expect(
    messages.some(
      (message) =>
        message.type === "assistant" &&
        message.content.some((part) => part.type === "text" && part.text === text),
    ),
  ).toBe(true);
}

async function captureLayout(page: Page, question: Locator, runRoot: string) {
  const original = page.viewportSize();
  const measurements = [];
  try {
    for (const [name, viewport] of [
      ["wide", { width: 1440, height: 900 }],
      ["narrow", { width: 920, height: 640 }],
    ] as const) {
      // Renderer viewport coverage, not an assertion about native window bounds.
      await page.setViewportSize(viewport);
      await question.scrollIntoViewIfNeeded();
      await expect(question).toBeVisible();
      const dimensions = await page.locator(REQUESTS).evaluateAll((cards) => ({
        documentWidth: document.documentElement.clientWidth,
        documentScrollWidth: document.documentElement.scrollWidth,
        cards: cards.map((card) => ({ width: card.clientWidth, scrollWidth: card.scrollWidth })),
      }));
      expect(dimensions.documentScrollWidth).toBeLessThanOrEqual(dimensions.documentWidth + 1);
      for (const card of dimensions.cards) {
        expect(card.width).toBeGreaterThan(0);
        expect(card.scrollWidth).toBeLessThanOrEqual(card.width + 1);
      }
      measurements.push({ name, viewport, ...dimensions });
      await page.screenshot({ path: join(runRoot, `subagent-requests-${name}.png`) });
      await page.emulateMedia({ colorScheme: "dark" });
      await expect
        .poll(() => page.evaluate(() => document.documentElement.style.colorScheme))
        .toBe("dark");
      await page.screenshot({ path: join(runRoot, `subagent-requests-${name}-dark.png`) });
      await page.emulateMedia({ colorScheme: "light" });
      await expect
        .poll(() => page.evaluate(() => document.documentElement.style.colorScheme))
        .toBe("light");
    }
    await writeFile(
      join(runRoot, "subagent-requests-layout.json"),
      JSON.stringify(measurements, null, 2),
    );
  } finally {
    await page.emulateMedia({ colorScheme: "light" });
    if (original) await page.setViewportSize(original);
  }
}
