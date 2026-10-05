import { expect, type Page } from "@playwright/test";
import { access, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Scenario } from "./scenarios.ts";
import { isTitleRequest } from "./test-llm-server.ts";

const PARENT_PROMPT = "The project mascot is a violet heron. Keep working on the parent task.";
const OTHER_TITLE = "BTW separate task";
const DRAFT = "This is an unsent normal message, not a side question.";
const FIRST = "BTWA: What is the project mascot in this conversation?";
const BACKGROUND = "BTWB: Explain the mascot while I browse another task.";
const CLOSED = "BTWC: This pending question will be closed.";
const TOOL_PROBE = "BTWD: Answer directly without taking any actions.";
const FIRST_ANSWER = "SIDE ANSWER A: The mascot is a violet heron.";
const BACKGROUND_ANSWER = "SIDE ANSWER B: A violet heron belongs to the original task.";
const CLOSED_ANSWER = "SIDE ANSWER C MUST NEVER REOPEN A TAB";
const TOOL_ANSWER = "SIDE ANSWER D: No action was taken.";
const FORBIDDEN_FILE = ".btw-forbidden-tool";
const SIDE_QUESTIONS = [FIRST, BACKGROUND, CLOSED, TOOL_PROBE];

type SavedQuestion = {
  id: string;
  profileID: string;
  sessionID: string;
  question: string;
  answer?: string;
};
type RequestObservation = { event: string; id: string; method?: string; path: string };

export const btwScenario: Scenario = {
  description:
    "ask transient tool-free side questions during an active turn, retain owner tabs across navigation/reload, and forget a closed pending question",
  prompt: PARENT_PROMPT,
  expectedModelCalls: 5,
  arrange(llm) {
    // Keep the parent genuinely active throughout navigation, reload, and the
    // side requests. The scenario interrupts it explicitly in finally.
    llm.textChunks(
      ["PARENT TASK IS STILL WORKING. ", ...Array<string>(2_400).fill("Working. ")],
      100,
    );
    // Do not route the parent marker: it is also present in every generation's
    // context. Side markers must not enter history, so these routes stay unique.
    llm.route("BTWA:", (script) => script.text(FIRST_ANSWER));
    llm.route("BTWB:", (script) =>
      script.textChunks([BACKGROUND_ANSWER, ...Array<string>(100).fill(" ")], 100),
    );
    llm.route("BTWC:", (script) => script.textChunks([CLOSED_ANSWER], 2_000));
    // The fixture intentionally disobeys the no-tools instructions. A text-only
    // happy path alone cannot prove that OpenCode won't execute a tool call.
    llm.route("BTWD:", (script) =>
      script.toolsWithText(
        [{ name: "shell", input: { command: `printf forbidden > ${FORBIDDEN_FILE}` } }],
        [TOOL_ANSWER],
        0,
      ),
    );
  },
  async run(page, { client, session, llm, projectDirectory, runRoot }) {
    await page.setViewportSize({ width: 1440, height: 900 });
    const runtime = await page.evaluate(() => window.palot.runtimeStatus());
    const profileID = runtime.profileID;
    const observations: RequestObservation[] = [];
    const observe = (message: { text(): string }) => {
      const match =
        /^\[opencode-client\] (request started|request cancelled|response) (\{.*\})$/.exec(
          message.text(),
        );
      if (!match) return;
      const data = JSON.parse(match[2]!) as { id: string; path: string; method?: string };
      observations.push({ event: match[1]!, ...data });
    };
    page.on("console", observe);
    const composer = page.getByRole("textbox", { name: "Message Palot", exact: true });
    const pane = page.getByRole("region", { name: "Right workbench", exact: true });
    const tab = (question: string) =>
      pane.getByRole("tab", { name: `BTW: ${question}`, exact: true });
    const panel = (question: string) =>
      pane.getByRole("tabpanel", { name: `BTW: ${question}`, exact: true });
    const other = await client.session.create({ location: session.location, title: OTHER_TITLE });

    const assertTransient = async () => {
      const messages = (
        await client.message.list({ sessionID: session.id, order: "asc", limit: 100 })
      ).data;
      expect(
        messages.filter((message) => message.type === "user").map((message) => message.text),
      ).toEqual([PARENT_PROMPT]);
      expect(
        messages.flatMap((message) =>
          message.type === "assistant"
            ? message.content.filter((part) => part.type === "tool")
            : [],
        ),
      ).toEqual([]);
      const serialized = JSON.stringify(messages);
      for (const text of [
        ...SIDE_QUESTIONS,
        FIRST_ANSWER,
        BACKGROUND_ANSWER,
        CLOSED_ANSWER,
        TOOL_ANSWER,
        DRAFT,
      ])
        expect(serialized).not.toContain(text);
      expect(await client.session.inbox.list({ sessionID: session.id })).toEqual([]);
    };
    const assertActive = async () => {
      expect((await client.session.active())[session.id]).toEqual({ type: "running" });
      // A nonempty composer intentionally replaces Stop with Queue/Steer.
      if (!(await composer.inputValue()))
        await expect(page.getByRole("button", { name: "Stop task", exact: true })).toBeEnabled();
      await expect(composer).toBeEditable();
    };
    const ask = async (question: string) => {
      await composer.fill(`/btw ${question}`);
      await composer.press("Enter");
      await expect(tab(question)).toBeVisible();
      await expect(panel(question)).toBeVisible();
      await expect(composer).toHaveValue("");
      await expect(composer).toBeEditable();
    };

    try {
      await client.session.prompt({ sessionID: session.id, text: PARENT_PROMPT });
      await llm.waitForCalls(1);
      await expect(page.getByText(/PARENT TASK IS STILL WORKING/)).toBeVisible();
      await assertActive();

      await composer.fill("/btw ");
      // Use the submit control here: Enter on a bare slash command first selects
      // its discovery item, rather than submitting the missing argument.
      await page
        .getByRole("button", {
          name: /^(Send message|Queue message after current turn|Steer current turn)$/,
        })
        .click();
      await expect(page.getByText("Enter a question after /btw.", { exact: true })).toBeVisible();
      expect(llm.scriptedCalls()).toBe(1);

      await ask(FIRST);
      await composer.fill(DRAFT);
      await expect(panel(FIRST).getByText(FIRST_ANSWER, { exact: true })).toBeVisible();
      await expect(composer).toHaveValue(DRAFT);
      await assertTransient();
      await assertActive();

      await ask(BACKGROUND);
      await llm.waitForCalls(3);
      await expect(panel(BACKGROUND).getByRole("status")).toContainText("Answering");
      await composer.fill(DRAFT);
      await switchTask(page, other.id, OTHER_TITLE);
      await expect(page.getByRole("tab", { name: /^BTW:/ })).toHaveCount(0);
      await expect(composer).toHaveValue("");
      // The owner is no longer mounted. Its answer must still land in its own
      // persisted workbench, not the selected task's composer or workbench.
      await expect
        .poll(
          async () =>
            (await savedQuestions(page, profileID, session.id)).find(
              (item) => item.question === BACKGROUND,
            )?.answer,
          { timeout: 30_000 },
        )
        .toBe(BACKGROUND_ANSWER);
      expect(await savedQuestions(page, profileID, other.id)).toEqual([]);
      await expect(page.getByRole("tab", { name: /^BTW:/ })).toHaveCount(0);
      await page.evaluate((id) => {
        location.hash = `#/sessions/${id}`;
      }, session.id);
      await expect(composer).toBeVisible();
      await expect(panel(BACKGROUND).getByText(BACKGROUND_ANSWER, { exact: true })).toBeVisible();
      await expect(composer).toHaveValue(DRAFT);
      await tab(FIRST).click();
      await expect(panel(FIRST).getByText(FIRST_ANSWER, { exact: true })).toBeVisible();
      await expect
        .poll(() => savedQuestions(page, profileID, session.id))
        .toMatchObject([
          { profileID, sessionID: session.id, question: FIRST, answer: FIRST_ANSWER },
          { profileID, sessionID: session.id, question: BACKGROUND, answer: BACKGROUND_ANSWER },
        ]);

      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(composer).toHaveValue(DRAFT);
      await expect(tab(FIRST)).toBeVisible();
      await expect(tab(BACKGROUND)).toBeVisible();
      await expect(panel(FIRST).getByText(FIRST_ANSWER, { exact: true })).toBeVisible();
      expect(llm.scriptedCalls()).toBe(3);
      await assertTransient();
      await assertActive();

      await ask(CLOSED);
      await llm.waitForCalls(4);
      await expect(panel(CLOSED).getByRole("status")).toContainText("Answering");
      const closedRequest = observations
        .filter((item) => item.event === "request started" && item.path.endsWith("/generate"))
        .at(-1);
      expect(closedRequest).toBeDefined();
      await pane.getByRole("button", { name: `Close BTW: ${CLOSED}`, exact: true }).click();
      await expect(tab(CLOSED)).toHaveCount(0);
      await expect
        .poll(() =>
          observations.some(
            (item) => item.id === closedRequest!.id && item.event === "request cancelled",
          ),
        )
        .toBe(true);

      await ask(TOOL_PROBE);
      await llm.waitForCalls(5);
      // Tool-only or invalid provider output may be rejected by the generation
      // endpoint. Either a text answer or an explicit error must settle, with no
      // tool execution or durable turn. Don't mistake rejection for a text answer.
      await expect(panel(TOOL_PROBE).getByRole("status")).toHaveCount(0);
      expect(
        (await panel(TOOL_PROBE).getByText(TOOL_ANSWER, { exact: true }).count()) +
          (await panel(TOOL_PROBE).getByRole("alert").count()),
      ).toBe(1);
      const sideRequests = llm.requests.filter(
        (request) =>
          !isTitleRequest(request.body) &&
          SIDE_QUESTIONS.some((question) => JSON.stringify(request.body).includes(question)),
      );
      expect(sideRequests).toHaveLength(4);
      await writeFile(
        join(runRoot, "btw-provider-requests.json"),
        JSON.stringify(sideRequests, null, 2),
      );
      for (const request of sideRequests) {
        const body = JSON.stringify(request.body);
        expect(body).toContain("Do not call any tools and do not take any actions.");
        expect(body).toContain("violet heron");
        // 2.0.23 includes tool definitions as model context, but generate returns
        // response.text directly without the session runner's execution loop.
        // The deliberately returned shell call above proves non-execution;
        // absence of definitions is not the published API's contract.
      }
      expect(
        await access(join(projectDirectory, FORBIDDEN_FILE)).then(
          () => true,
          () => false,
        ),
      ).toBe(false);
      await assertTransient();
      await assertActive();

      // Pass the delayed provider's original completion window. Cancellation may
      // stop that provider stream entirely; unit tests separately force a late
      // promise resolution. Native UI must never resurrect the closed question.
      await page.waitForTimeout(6_500);
      await expect(tab(CLOSED)).toHaveCount(0);
      expect(
        (await savedQuestions(page, profileID, session.id)).some(
          (item) => item.question === CLOSED,
        ),
      ).toBe(false);
      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(tab(TOOL_PROBE)).toBeVisible();
      await expect(tab(CLOSED)).toHaveCount(0);
      await expect(tab(FIRST)).toBeVisible();
      await expect(tab(BACKGROUND)).toBeVisible();
      await pane.getByRole("button", { name: `Close BTW: ${FIRST}`, exact: true }).click();
      await pane.getByRole("button", { name: `Close BTW: ${BACKGROUND}`, exact: true }).click();
      await pane.getByRole("button", { name: `Close BTW: ${TOOL_PROBE}`, exact: true }).click();
      await expect.poll(() => savedQuestions(page, profileID, session.id)).toEqual([]);
      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(composer).toBeEditable();
      await expect(page.getByRole("tab", { name: /^BTW:/ })).toHaveCount(0);

      const mutations = observations.filter(
        (item) => item.event === "request started" && item.method === "POST",
      );
      expect(mutations.filter((item) => item.path.endsWith("/generate"))).toHaveLength(4);
      expect(
        mutations.filter((item) => /\/(prompt|command|shell|steer|queue)(?:\?|$)/.test(item.path)),
      ).toEqual([]);
      expect(llm.scriptedCalls()).toBe(5);
      await writeFile(
        join(runRoot, "btw.json"),
        JSON.stringify(
          {
            profileID,
            ownerSessionID: session.id,
            otherSessionID: other.id,
            requests: observations,
            providerRequests: sideRequests,
            closedRequestID: closedRequest!.id,
            noToolSideEffect: true,
          },
          null,
          2,
        ),
      );
    } finally {
      page.off("console", observe);
      await client.session.interrupt({ sessionID: session.id });
      await client.session.wait({ sessionID: session.id });
    }
  },
  async assert(page, { client, session, llm }) {
    await expect(page.getByRole("textbox", { name: "Message Palot", exact: true })).toBeEditable();
    await expect(page.getByRole("tab", { name: /^BTW:/ })).toHaveCount(0);
    expect(llm.scriptedCalls()).toBe(5);
    expect(await client.session.inbox.list({ sessionID: session.id })).toEqual([]);
    const messages = (
      await client.message.list({ sessionID: session.id, order: "asc", limit: 100 })
    ).data;
    expect(
      messages.filter((message) => message.type === "user").map((message) => message.text),
    ).toEqual([PARENT_PROMPT]);
    expect(
      messages.flatMap((message) =>
        message.type === "assistant" ? message.content.filter((part) => part.type === "tool") : [],
      ),
    ).toEqual([]);
  },
};

async function switchTask(page: Page, sessionID: string, title: string) {
  await page.keyboard.press(process.platform === "darwin" ? "Meta+K" : "Control+K");
  await page.getByRole("combobox", { name: "Search tasks and commands" }).fill(title);
  await page.getByRole("option", { name: new RegExp(title) }).click();
  await expect.poll(() => new URL(page.url()).hash.split("?")[0]).toBe(`#/sessions/${sessionID}`);
  await expect(page.getByRole("textbox", { name: "Message Palot", exact: true })).toBeVisible();
}

async function savedQuestions(
  page: Page,
  profileID: string,
  sessionID: string,
): Promise<SavedQuestion[]> {
  return page.evaluate(
    ({ profileID, sessionID }) => {
      const raw = localStorage.getItem("palot.desktop.state.workspace.workbench");
      if (!raw) return [];
      const saved = JSON.parse(raw) as {
        value: {
          scopes: Record<
            string,
            {
              right: {
                tabs: Array<{ id: string; kind: string; resource: Omit<SavedQuestion, "id"> }>;
              };
              bottom: {
                tabs: Array<{ id: string; kind: string; resource: Omit<SavedQuestion, "id"> }>;
              };
            }
          >;
        };
      };
      const context = saved.value.scopes[`${profileID}\u0000${sessionID}`];
      if (!context) return [];
      return [...context.right.tabs, ...context.bottom.tabs]
        .filter((tab) => tab.kind === "btw")
        .map((tab) => ({ id: tab.id, ...tab.resource }));
    },
    { profileID, sessionID },
  );
}
