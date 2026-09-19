import type { SessionMessageInfo } from "@opencode/client";
import { expect } from "@playwright/test";
import type { Scenario } from "./scenarios.ts";

const DRAFT = "Keep this unsent draft through the configuration reload.";
const ANSWER = "Imported transcript remains hydrated after the location reload.";
const FORM_TITLE = "Decision pending during configuration reload";

export const openCodeApiMigrationScenario: Scenario = {
  description:
    "exercise 2.0.7 session routes and recover a selected transcript, draft, and pending forms after location reload without model calls",
  prompt: "",
  expectedModelCalls: 0,
  arrange() {},
  async run(page, { client, session, llm }) {
    const created = Date.now() - 10_000;
    const messages: SessionMessageInfo[] = [
      {
        id: "msg_api_migration_user",
        type: "user",
        time: { created },
        text: "Preserve this imported conversation.",
      },
      {
        id: "msg_api_migration_assistant",
        type: "assistant",
        time: { created: created + 1, completed: created + 2 },
        agent: "build",
        model: { providerID: "test", id: "test-model" },
        finish: "stop",
        content: [{ type: "text", text: ANSWER }],
      },
    ];
    const source = await client.session.import({
      info: { ...session, id: `${session.id}_migration`, title: "API migration fixture" },
      messages,
      location: session.location,
    });
    const sessionID = source.id;
    await page.evaluate((id) => {
      location.hash = `#/sessions/${id}`;
    }, sessionID);
    const composer = page.getByRole("textbox", { name: "Message Palot" });
    const panel = page.locator("[data-palot-composer-request]");
    const transcript = page.getByRole("region", { name: "Task transcript", exact: true });
    await expect(transcript.getByText(ANSWER, { exact: true })).toBeVisible();
    await composer.fill(DRAFT);

    await client.session.update({ sessionID, title: "API migration renamed" });
    await expect(
      page
        .getByRole("main", { name: "Current task" })
        .getByText("API migration renamed", { exact: true }),
    ).toBeVisible();

    // resume:false persists a real inbox item without starting a provider turn.
    const queued = await client.session.prompt({
      sessionID,
      text: "Do not execute this queued fixture.",
      delivery: "steer",
      resume: false,
    });
    // Moving to steer wakes execution; queue instead to keep this fixture provider-free.
    await client.session.inbox.update({ sessionID, inboxID: queued.id, delivery: "queue" });
    expect(await client.session.inbox.list({ sessionID })).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: queued.id, delivery: "queue" })]),
    );
    await client.session.inbox.cancel({ sessionID, inboxID: queued.id });
    expect(await client.session.inbox.list({ sessionID })).toHaveLength(0);

    const pending = await client.session.form.create({
      sessionID,
      title: FORM_TITLE,
      fields: [{ key: "decision", type: "string", title: "Decision", required: true }],
    });
    expect((await client.session.form.get({ sessionID, formID: pending.id })).state).toEqual({
      status: "pending",
    });
    await expect(panel.getByText(FORM_TITLE, { exact: true })).toBeVisible();

    // Reload the isolated server's locations, not the Electron document. This
    // exercises shutdown/cancel events and renderer rehydration on its live stream.
    const server = await client.server.info();
    await client.location.reload();
    // Forms are location-local: shutdown cancels the request and the rebuilt
    // location no longer retains its detail record.
    await expect(client.session.form.get({ sessionID, formID: pending.id })).rejects.toMatchObject({
      _tag: "FormNotFoundError",
    });
    expect(await client.session.form.list({ sessionID })).toHaveLength(0);
    await expect(panel).toBeHidden();
    await expect(composer).toHaveValue(DRAFT);
    await expect(transcript.getByText(ANSWER, { exact: true })).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => location.hash.split("?")[0]))
      .toBe(`#/sessions/${sessionID}`);
    expect(await client.server.info()).toMatchObject({ pid: server.pid, version: server.version });

    // A fresh event after reload must still reach the selected native session.
    // A surviving old transcript alone would not establish client recovery.
    const recovered = await client.session.form.create({
      sessionID,
      title: "Form created after reload",
      fields: [{ key: "decision", type: "string", title: "Decision", required: true }],
    });
    await expect(panel.getByText("Form created after reload", { exact: true })).toBeVisible();
    await client.session.form.cancel({ sessionID, formID: recovered.id });
    await expect(panel).toBeHidden();
    await expect(composer).toHaveValue(DRAFT);

    const exported = await client.session.export({ sessionID });
    expect(exported.info.title).toBe("API migration renamed");
    expect(exported.messages).toEqual(messages);
    await page.reload();
    await expect(transcript.getByText(ANSWER, { exact: true })).toBeVisible();
    await expect(composer).toHaveValue(DRAFT);
    await expect(panel).toBeHidden();
    // Exercise Palot's explicit reload control as well as external reload events.
    await page.evaluate(() => {
      location.hash = "#/settings/config";
    });
    const reload = page.getByRole("button", { name: "Reload configuration", exact: true });
    await expect(reload).toBeEnabled();
    await reload.click();
    await expect(reload).toBeEnabled();
    await page.evaluate((id) => {
      location.hash = `#/sessions/${id}`;
    }, sessionID);
    await expect(transcript.getByText(ANSWER, { exact: true })).toBeVisible();
    await expect(composer).toHaveValue(DRAFT);
    expect(llm.requests).toHaveLength(0);
  },
  async assert(page, { llm }) {
    await expect(page.getByRole("textbox", { name: "Message Palot" })).toHaveValue(DRAFT);
    expect(llm.scriptedCalls()).toBe(0);
  },
};
