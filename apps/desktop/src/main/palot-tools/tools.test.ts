// @vitest-environment node

import type { OpenCodeClient, OpenCodeEvent, SessionInfo } from "@opencode/client";
import type { ClientMcpTool } from "@opencode/client/mcp";
import { describe, expect, it, vi } from "vitest";
import type {
  AutomationCommand,
  AutomationRecord,
  AutomationSnapshot,
  SessionTriageCommand,
  SessionTriageSnapshot,
} from "../../shared";
import { palotSchedulingState, palotTools, type PalotToolContext } from "./tools";

const NOW = Date.parse("2026-10-26T08:00:00Z");

function session(id: string, patch: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id,
    projectID: "prj_1",
    cost: 0,
    tokens: {} as SessionInfo["tokens"],
    time: { created: NOW - 10_000, updated: NOW - 5_000 },
    title: `Task ${id}`,
    location: { directory: "/repo" },
    // As Palot's presets do: OpenCode asks before scheduling.
    permissions: [{ action: "palot_*", resource: "*", effect: "ask" }],
    ...patch,
  } as SessionInfo;
}

function setup(sessions: SessionInfo[] = [session("ses_root")], askBeforeScheduling = true) {
  const byID = new Map(sessions.map((item) => [item.id, item]));
  const active: Record<string, { type: "running" }> = {};
  const observers = new Set<(event: OpenCodeEvent) => void>();
  const update = vi.fn(async (input: { sessionID: string; permissions?: unknown }) => {
    const current = byID.get(input.sessionID)!;
    byID.set(input.sessionID, { ...current, ...(input as Partial<SessionInfo>) });
  });
  const client = {
    session: {
      get: vi.fn(async ({ sessionID }: { sessionID: string }) => {
        const found = byID.get(sessionID);
        if (!found) throw new Error("missing");
        return found;
      }),
      list: vi.fn(async (input: { parentID?: string | null }) => ({
        data: [...byID.values()].filter((item) =>
          input.parentID === null ? !item.parentID : item.parentID === input.parentID,
        ),
        cursor: {},
      })),
      active: vi.fn(async () => active),
      update,
      form: { list: vi.fn(async () => []) },
    },
    permission: { list: vi.fn(async () => []), saved: { list: vi.fn(async () => []) } },
    message: { list: vi.fn(async () => ({ data: [], cursor: {} })) },
    project: { list: vi.fn(async () => [{ id: "prj_1", canonical: "/repo" }]) },
  };

  let automations: AutomationRecord[] = [];
  const dispatch = vi.fn(async (command: AutomationCommand): Promise<AutomationSnapshot> => {
    if (command.type === "create") {
      automations = [
        ...automations,
        {
          ...command.draft,
          version: 1,
          id: `aut_${automations.length + 1}`,
          profileID: command.profileID,
          createdAt: NOW,
          updatedAt: NOW,
          definitionVersion: 1,
          nextRunAt: command.draft.trigger.type === "once" ? command.draft.trigger.at : null,
          lastRunAt: null,
          activeRunID: null,
          consecutiveStartFailures: 0,
        },
      ];
    }
    if (command.type === "delete")
      automations = automations.filter((item) => item.id !== command.automationID);
    return { profileID: "profile", automations, runs: [] };
  });
  let triage: SessionTriageSnapshot = {
    profileID: "profile",
    bootstrapThrough: null,
    sessions: [],
  };
  const triageDispatch = vi.fn((command: SessionTriageCommand) => {
    if (command.type === "pin" || command.type === "settle") {
      triage = {
        ...triage,
        sessions: [
          {
            sessionID: command.sessionID,
            disposition: command.type === "settle" ? "settled" : "inbox",
            settledThrough: command.type === "settle" ? command.through : null,
            pinnedAt: command.type === "pin" ? command.at : null,
            snoozedUntil: null,
            snoozedThrough: null,
            updatedAt: command.at,
          },
        ],
      };
    }
    return triage;
  });
  const onTriageChanged = vi.fn();
  const abort = new AbortController();
  const linked = {
    key: "github.com/acme/web#7",
    pullRequest: { url: "https://github.com/acme/web/pull/7" },
  };
  const sourceControl = {
    linkPullRequest: vi.fn(async () => ({ ok: true as const, value: linked })),
    listPullRequestLinks: vi.fn(async () => ({ ok: true as const, value: [linked] })),
    watchPullRequest: vi.fn(async () => ({ ok: true as const, value: linked })),
    createPullRequest: vi.fn(async () => ({ ok: true as const, value: linked })),
  };
  const context: PalotToolContext = {
    profileID: "profile",
    withClient: (operation) => operation(client as unknown as OpenCodeClient),
    onEvent: (observer) => {
      observers.add(observer);
      return () => observers.delete(observer);
    },
    automations: { load: () => ({ profileID: "profile", automations, runs: [] }), dispatch },
    triage: { load: () => triage, dispatch: triageDispatch },
    onTriageChanged,
    timezone: () => "Europe/Amsterdam",
    now: () => NOW,
    signal: abort.signal,
    scheduling: palotSchedulingState(),
    askBeforeScheduling: () => askBeforeScheduling,
    sourceControl: () => sourceControl as never,
  };
  const tools = new Map(palotTools(context).map((tool) => [tool.name, tool]));
  const call = async (name: string, args: Record<string, unknown>, sessionID = "ses_root") => {
    const result = await (tools.get(name) as ClientMcpTool).handler(args, { sessionID });
    const text = result.content[0]?.type === "text" ? result.content[0].text : "";
    return { error: result.isError === true, value: JSON.parse(text) };
  };
  const emit = (event: Partial<OpenCodeEvent>) => {
    for (const observer of observers) observer(event as OpenCodeEvent);
  };
  return {
    call,
    client,
    dispatch,
    triageDispatch,
    onTriageChanged,
    active,
    emit,
    byID,
    abort,
    sourceControl,
  };
}

describe("Palot agent tools", () => {
  it("links and watches the calling subagent's root task", async () => {
    const harness = setup([
      session("ses_root"),
      session("ses_child", { parentID: "ses_root" } as Partial<SessionInfo>),
    ]);
    await harness.call(
      "link_pull_request",
      { url: "https://github.com/acme/web/pull/7" },
      "ses_child",
    );
    expect(harness.sourceControl.linkPullRequest).toHaveBeenCalledWith({
      profileID: "profile",
      sessionID: "ses_root",
      url: "https://github.com/acme/web/pull/7",
    });
    await harness.call("watch_pull_request", {}, "ses_child");
    expect(harness.sourceControl.watchPullRequest).toHaveBeenLastCalledWith({
      profileID: "profile",
      sessionID: "ses_root",
      key: "github.com/acme/web#7",
      watching: true,
    });
    await harness.call("unwatch_pull_request", {});
    expect(harness.sourceControl.watchPullRequest).toHaveBeenLastCalledWith(
      expect.objectContaining({ watching: false }),
    );
  });

  it("requires PR creation approval even when scheduling approvals are disabled", async () => {
    const harness = setup([session("ses_root", { permissions: [] })], false);
    const args = { base: "main", title: "Feature", body: "Summary", draft: true };
    expect((await harness.call("create_pull_request", args)).value.error.code).toBe(
      "approval_required",
    );
    expect(harness.sourceControl.createPullRequest).not.toHaveBeenCalled();
    expect(harness.byID.get("ses_root")!.permissions).toContainEqual({
      action: "palot_create_pull_request",
      resource: "*",
      effect: "ask",
    });
    // The next invocation is protected by the authoritative OpenCode permission rule.
    expect((await harness.call("create_pull_request", args)).error).toBe(false);
    expect(harness.sourceControl.createPullRequest).toHaveBeenCalledWith({
      profileID: "profile",
      sessionID: "ses_root",
      ...args,
    });
  });
  it("declares object schemas and keeps tool names within OpenCode's limits", () => {
    const tools = palotTools({} as PalotToolContext);
    for (const tool of tools) {
      expect(tool.name).toMatch(/^[a-z_]+$/);
      expect(tool.inputSchema).toMatchObject({ type: "object" });
    }
  });

  it("schedules a follow-up for the calling task's root once, even when retried", async () => {
    const harness = setup([session("ses_root"), session("ses_child", { parentID: "ses_root" })]);
    const args = {
      name: "Check CI",
      prompt: "Check whether CI passed.",
      at: "2026-10-27T09:00",
      clientRequestId: "req-1",
    };
    const first = await harness.call("schedule_task", args, "ses_child");
    expect(first.error).toBe(false);
    expect(first.value.scheduled).toMatchObject({
      automationId: "aut_1",
      target: { type: "this_task" },
      schedule: "Once at 2026-10-27T09:00 (Europe/Amsterdam)",
      nextRun: "2026-10-27T09:00",
    });
    expect(harness.dispatch).toHaveBeenCalledWith({
      type: "create",
      profileID: "profile",
      draft: expect.objectContaining({
        destination: { type: "session", sessionID: "ses_root" },
        createdFromSessionID: "ses_root",
        trigger: {
          version: 1,
          type: "once",
          at: Date.parse("2026-10-27T08:00:00Z"),
          timezone: "Europe/Amsterdam",
        },
      }),
    });

    const retry = await harness.call("schedule_task", args, "ses_child");
    expect(retry.value).toMatchObject({ reused: true, scheduled: { automationId: "aut_1" } });
    expect(harness.dispatch).toHaveBeenCalledTimes(1);
  });

  it("schedules recurring work as new tasks in the project", async () => {
    const harness = setup([session("ses_root")]);
    const result = await harness.call("schedule_task", {
      name: "Weekly report",
      prompt: "Summarize the week's merged PRs.",
      at: "2026-10-30T16:00",
      rrule: "RRULE:FREQ=WEEKLY;BYDAY=FR",
      target: "new_task",
    });
    expect(result.value.scheduled).toMatchObject({
      rrule: "FREQ=WEEKLY;BYDAY=FR",
      target: { type: "new_task", directory: "/repo", workspace: "worktree" },
    });
    expect(harness.dispatch.mock.calls[0]?.[0]).toMatchObject({
      draft: {
        destination: {
          type: "standalone",
          projectID: "prj_1",
          sourceDirectory: "/repo",
          workspace: { type: "new-worktree" },
        },
      },
    });
  });

  it("returns typed failures for unusable schedules and unknown callers", async () => {
    const harness = setup([session("ses_root")]);
    for (const at of ["next tuesday", "2026-10-25T09:00"]) {
      const result = await harness.call("schedule_task", { name: "x", prompt: "y", at });
      expect(result).toMatchObject({ error: true, value: { error: { code: "invalid_schedule" } } });
    }
    const missing = await harness.call("schedule_task", { name: "x" });
    expect(missing.value.error.code).toBe("invalid_arguments");
    const tool = palotTools({} as PalotToolContext).find((item) => item.name === "read_task")!;
    const anonymous = await tool.handler({}, {});
    expect(anonymous.isError).toBe(true);
    expect(harness.dispatch).not.toHaveBeenCalled();
  });

  it("schedules without asking in Full access tasks, as ChatGPT's Full access does", async () => {
    // Includes tasks whose Full access rules predate Palot's tools or carry its old ask rules.
    for (const permissions of [
      [{ action: "*", resource: "*", effect: "allow" as const }],
      [
        { action: "*", resource: "*", effect: "allow" as const },
        { action: "palot_schedule_task", resource: "*", effect: "ask" as const },
      ],
    ]) {
      const harness = setup([session("ses_root", { permissions })]);
      const result = await harness.call("schedule_task", {
        name: "x",
        prompt: "y",
        at: "2026-10-27T09:00",
      });
      expect(result.error).toBe(false);
      expect(harness.client.session.update).not.toHaveBeenCalled();
    }
  });

  it("schedules without asking anywhere when the user turned asking off", async () => {
    const harness = setup([session("ses_root", { permissions: [] })], false);
    const result = await harness.call("schedule_task", {
      name: "x",
      prompt: "y",
      at: "2026-10-27T09:00",
    });
    expect(result.error).toBe(false);
    expect(harness.client.permission.saved.list).not.toHaveBeenCalled();
  });

  it("fails closed when nothing in the task makes OpenCode ask", async () => {
    // No session rule: an agent or config allow could apply, so Palot cannot rely on a prompt.
    const unruled = setup([session("ses_root", { permissions: [] })]);
    const args = { name: "x", prompt: "y", at: "2026-10-27T09:00" };
    expect((await unruled.call("schedule_task", args)).value.error.code).toBe("approval_required");
    expect(unruled.byID.get("ses_root")!.permissions?.at(-1)?.effect).toBe("ask");

    // "Always allow for this project" is the user's own saved rule, applied after the task's.
    const saved = setup([session("ses_root", { permissions: [] })]);
    saved.client.permission.saved.list.mockResolvedValue([
      { action: "palot_schedule_task", resource: "*" },
    ] as never);
    expect((await saved.call("schedule_task", args)).error).toBe(false);
    expect(saved.dispatch).toHaveBeenCalledTimes(1);
  });

  it("schedules once when the same request arrives twice at the same time", async () => {
    const harness = setup();
    const args = { name: "x", prompt: "y", at: "2026-10-27T09:00", clientRequestId: "same" };
    const [first, second] = await Promise.all([
      harness.call("schedule_task", args),
      harness.call("schedule_task", args),
    ]);
    expect(harness.dispatch).toHaveBeenCalledTimes(1);
    expect([first.value.reused, second.value.reused].filter(Boolean)).toHaveLength(1);
  });

  it("updates only the fields passed and deletes by ID", async () => {
    const harness = setup([session("ses_root")]);
    await harness.call("schedule_task", {
      name: "Daily",
      prompt: "Do it.",
      at: "2026-10-27T09:00",
      rrule: "FREQ=DAILY",
    });
    await harness.call("update_automation", { automationId: "aut_1", at: "2026-10-27T10:30" });
    expect(harness.dispatch.mock.calls[1]?.[0]).toMatchObject({
      type: "update",
      automationID: "aut_1",
      draft: {
        name: "Daily",
        action: { prompt: "Do it." },
        trigger: {
          type: "recurring",
          rrule: "FREQ=DAILY",
          dtstart: Date.parse("2026-10-27T09:30:00Z"),
        },
      },
    });
    const unknown = await harness.call("delete_automation", { automationId: "aut_9" });
    expect(unknown.value.error.code).toBe("not_found");
    const deleted = await harness.call("delete_automation", { automationId: "aut_1" });
    expect(deleted.value).toEqual({ deleted: { automationId: "aut_1", name: "Daily" } });
  });

  it("settles through its subagents' activity, and moves it back to the Inbox", async () => {
    const harness = setup([
      session("ses_root"),
      session("ses_child", {
        parentID: "ses_root",
        time: { created: NOW - 200, updated: NOW, idle: NOW - 100 },
      }),
    ]);
    const settled = await harness.call("settle_task", {});
    expect(settled.error).toBe(false);
    expect(harness.triageDispatch.mock.calls[0]?.[0]).toMatchObject({
      type: "settle",
      sessionID: "ses_root",
      through: { updatedAt: NOW - 100, sessionID: "ses_child" },
    });
    expect(harness.onTriageChanged).toHaveBeenCalledTimes(1);
    expect(settled.value.task).toMatchObject({ taskId: "ses_root", inbox: "settled" });

    await harness.call("settle_task", { settled: false });
    expect(harness.triageDispatch.mock.calls[1]?.[0]).toMatchObject({ type: "inbox" });
  });

  it("settles the calling task when its running turn succeeds, not before", async () => {
    const harness = setup([session("ses_root"), session("ses_sub", { parentID: "ses_root" })]);
    harness.active.ses_root = { type: "running" };
    // A subagent settling its task settles the task it belongs to.
    const pending = await harness.call("settle_task", {}, "ses_sub");
    expect(pending.value).toMatchObject({ settlesWhenTurnEnds: true, task: { inbox: "inbox" } });
    expect(harness.triageDispatch).not.toHaveBeenCalled();

    harness.emit({
      type: "session.execution.succeeded",
      created: NOW + 5_000,
      data: { sessionID: "ses_root" },
    } as never);
    await vi.waitFor(() => expect(harness.triageDispatch).toHaveBeenCalledTimes(1));
    expect(harness.triageDispatch.mock.calls[0]?.[0]).toMatchObject({
      type: "settle",
      sessionID: "ses_root",
      through: { updatedAt: NOW + 5_000, sessionID: "ses_root" },
    });
    expect(harness.onTriageChanged).toHaveBeenCalledTimes(1);
  });

  it.each(["session.execution.failed", "session.execution.interrupted"])(
    "keeps a self-settling task in the Inbox after %s, and when moved back first",
    async (type) => {
      const harness = setup();
      harness.active.ses_root = { type: "running" };
      await harness.call("settle_task", {});
      harness.emit({ type, created: NOW, data: { sessionID: "ses_root" } } as never);

      await harness.call("settle_task", {});
      await harness.call("settle_task", { settled: false });
      harness.emit({
        type: "session.execution.succeeded",
        created: NOW,
        data: { sessionID: "ses_root" },
      } as never);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(harness.triageDispatch.mock.calls.map(([command]) => command.type)).toEqual(["inbox"]);
    },
  );

  it("refuses to settle another task that is running or waiting for the user", async () => {
    const harness = setup([session("ses_root"), session("ses_other")]);
    harness.active.ses_other = { type: "running" };
    const running = await harness.call("settle_task", { taskId: "ses_other" });
    expect(running.value.error.code).toBe("task_busy");

    delete harness.active.ses_other;
    vi.mocked(harness.client.permission.list).mockImplementation((async ({
      sessionID,
    }: {
      sessionID: string;
    }) => (sessionID === "ses_other" ? [{ id: "per_1", action: "shell" }] : [])) as never);
    const waiting = await harness.call("settle_task", { taskId: "ses_other" });
    expect(waiting.value.error.code).toBe("task_busy");
    expect(harness.triageDispatch).not.toHaveBeenCalled();
  });

  it("snoozes until a future time, pins, and archives in OpenCode", async () => {
    const harness = setup();
    for (const until of [undefined, "2020-01-01T09:00", "soon"]) {
      const result = await harness.call("snooze_task", until ? { until } : {});
      expect(result.value.error.code).toBe("invalid_arguments");
    }
    const snoozed = await harness.call("snooze_task", { until: "2026-10-28T09:00" });
    expect(snoozed.error).toBe(false);
    expect(harness.triageDispatch.mock.calls[0]?.[0]).toMatchObject({ type: "snooze" });

    await harness.call("pin_task", {});
    await harness.call("pin_task", { pinned: false });
    expect(harness.triageDispatch.mock.calls.slice(1).map(([command]) => command.type)).toEqual([
      "pin",
      "unpin",
    ]);

    const archived = await harness.call("archive_task", {});
    expect(archived.error).toBe(false);
    expect(harness.client.session.update).toHaveBeenCalledWith({
      sessionID: "ses_root",
      archived: true,
    });
    expect(harness.triageDispatch).toHaveBeenCalledTimes(3);
  });

  it("waits for the first task to finish or need the user", async () => {
    const harness = setup([session("ses_root"), session("ses_other"), session("ses_third")]);
    harness.active.ses_other = { type: "running" };
    harness.active.ses_third = { type: "running" };
    const self = await harness.call("wait_tasks", { taskIds: ["ses_root"] });
    expect(self.value.error.code).toBe("invalid_arguments");

    const waiting = harness.call("wait_tasks", { taskIds: ["ses_other", "ses_third"] });
    await vi.waitFor(() => expect(harness.client.permission.list).toHaveBeenCalledTimes(2));
    delete harness.active.ses_third;
    harness.emit({
      type: "session.execution.succeeded",
      data: { sessionID: "ses_third" },
    } as never);
    const result = await waiting;
    expect(result.value.changed).toEqual(["ses_third"]);
    expect(result.value.tasks.map((task: { status: string }) => task.status)).toEqual([
      "running",
      "idle",
    ]);

    // A task that is already idle returns at once.
    const idle = await harness.call("wait_tasks", { taskIds: ["ses_third"] });
    expect(idle.value.changed).toEqual(["ses_third"]);
  });

  it("returns at once when a task's subagent is already waiting for the user", async () => {
    const harness = setup([
      session("ses_root"),
      session("ses_other"),
      session("ses_sub", { parentID: "ses_other" }),
    ]);
    harness.active.ses_other = { type: "running" };
    harness.client.permission.list.mockImplementation((async ({
      sessionID,
    }: {
      sessionID: string;
    }) => (sessionID === "ses_sub" ? [{ action: "shell" }] : [])) as never);
    const result = await harness.call("wait_tasks", {
      taskIds: ["ses_other"],
      timeoutSeconds: 600,
    });
    expect(result.value.changed).toEqual(["ses_other"]);
  });

  it("ends a wait when the tools are detached", async () => {
    const harness = setup([session("ses_root"), session("ses_other")]);
    harness.active.ses_other = { type: "running" };
    const waiting = harness.call("wait_tasks", { taskIds: ["ses_other"] });
    await vi.waitFor(() => expect(harness.client.permission.list).toHaveBeenCalled());
    harness.abort.abort();
    expect((await waiting).value.timedOut).toBe(true);
  });

  it("reads a task's latest messages oldest first, with requests waiting for the user", async () => {
    const harness = setup([session("ses_root"), session("ses_other")]);
    harness.active.ses_other = { type: "running" };
    harness.client.permission.list.mockResolvedValue([{ action: "shell" }] as never);
    harness.client.message.list.mockResolvedValue({
      data: [
        {
          type: "assistant",
          content: [
            { type: "tool", name: "shell" },
            { type: "text", text: "Running the tests." },
          ],
        },
        { type: "user", text: "Run the tests" },
      ],
      cursor: {},
    } as never);
    const result = await harness.call("read_task", { taskId: "ses_other" });
    expect(result.value).toMatchObject({
      taskId: "ses_other",
      status: "running",
      waitingForUser: [{ type: "permission", action: "shell" }],
      messages: [
        { role: "user", text: "Run the tests" },
        { role: "assistant", text: "Running the tests.", tools: ["shell"] },
      ],
    });
  });
});
