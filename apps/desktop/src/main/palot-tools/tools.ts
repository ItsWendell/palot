/**
 * Palot's agent tools: scheduling, reading and waiting on tasks, and organizing them.
 *
 * Handlers run in the main process against Palot's own stores and the connection's OpenCode
 * client. They return failures as `{ error: { code, message } }` results instead of throwing,
 * so the model can recover. A tool's target task defaults to the calling task.
 */
import type {
  OpenCodeClient,
  OpenCodeEvent,
  PermissionRuleset,
  SessionInfo,
} from "@opencode/client";
import type { ClientMcpTool, ClientMcpToolResult } from "@opencode/client/mcp";
import type {
  AutomationCommand,
  AutomationDraft,
  AutomationRecord,
  AutomationSnapshot,
  AutomationTrigger,
  SessionTriageCommand,
  SessionTriageRecord,
  SessionTriageSnapshot,
} from "../../shared";
import {
  isFullAccessRuleset,
  PALOT_TOOL_APPROVALS,
  palotToolAction,
  type PalotToolName,
} from "../../shared/palot-tools-contract";
import {
  automationInstant,
  automationLocalTime,
  scheduleSummary,
  validateAutomationTrigger,
} from "../automations/recurrence";

export interface PalotToolContext {
  profileID: string;
  withClient<T>(operation: (client: OpenCodeClient) => Promise<T>): Promise<T>;
  onEvent(observer: (event: OpenCodeEvent) => void): () => void;
  automations: {
    load(profileID: string): AutomationSnapshot;
    dispatch(command: AutomationCommand): Promise<AutomationSnapshot>;
  };
  triage: {
    load(profileID: string): SessionTriageSnapshot;
    dispatch(command: SessionTriageCommand): SessionTriageSnapshot;
  };
  onTriageChanged(snapshot: SessionTriageSnapshot): void;
  timezone(): string;
  now(): number;
  /** Aborts when these tools are detached, ending any wait. */
  signal: AbortSignal;
  /** Shared by every attachment on one connection, so retries dedupe across them. */
  scheduling: PalotSchedulingState;
  /** The user's "Ask before agents schedule tasks" setting; Full access tasks never ask. */
  askBeforeScheduling(): boolean;
}

export interface PalotSchedulingState {
  /** `rootSessionID\0clientRequestId` to the automation it created. */
  created: Map<string, string>;
  /** Creates run one at a time, so each can identify the record it added. */
  queue: Promise<unknown>;
  /** Tasks that settled themselves mid-turn, settling when that turn succeeds. */
  settleAfterTurn: Map<string, symbol>;
}

export function palotSchedulingState(): PalotSchedulingState {
  return { created: new Map(), queue: Promise.resolve(), settleAfterTurn: new Map() };
}

type Args = Record<string, unknown>;

class ToolFailure extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const MAX_WAIT_SECONDS = 900;
const DEFAULT_WAIT_SECONDS = 300;
const MAX_TEXT = 4_000;
const DAY = 86_400_000;

export function palotTools(context: PalotToolContext): ClientMcpTool[] {
  const scheduling = context.scheduling;
  const serialized = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = scheduling.queue.then(operation, operation);
    scheduling.queue = result.catch(() => undefined);
    return result;
  };

  const tool = (
    name: PalotToolName,
    description: string,
    properties: Record<string, unknown>,
    required: string[],
    handler: (args: Args, sessionID: string, client: OpenCodeClient) => Promise<unknown>,
  ): ClientMcpTool => ({
    name,
    description,
    inputSchema: {
      type: "object",
      properties,
      ...(required.length ? { required } : {}),
      additionalProperties: false,
    },
    handler: async (args, call) => {
      try {
        if (!call.sessionID)
          throw new ToolFailure("unknown_caller", "The calling task is unknown.");
        const sessionID = call.sessionID;
        return ok(
          await context.withClient(async (client) => {
            if (PALOT_TOOL_APPROVALS[name] === "ask")
              await requireApproval(client, sessionID, name, context.askBeforeScheduling());
            return handler(args, sessionID, client);
          }),
        );
      } catch (error) {
        return error instanceof ToolFailure
          ? failure(error.code, error.message)
          : failure("failed", error instanceof Error ? error.message : String(error));
      }
    },
  });

  const automationByID = (automationID: string) => {
    const record = context.automations
      .load(context.profileID)
      .automations.find((automation) => automation.id === automationID);
    if (!record) throw new ToolFailure("not_found", `No scheduled task has ID ${automationID}.`);
    return record;
  };

  const describeTask = async (
    client: OpenCodeClient,
    session: SessionInfo,
    callerRootID: string,
    active: Record<string, unknown>,
    triage: Map<string, SessionTriageRecord>,
  ) => ({
    taskId: session.id,
    title: session.title ?? "Untitled task",
    status: active[session.id] ? "running" : "idle",
    ...(session.outcome ? { lastOutcome: session.outcome } : {}),
    updated: automationLocalTime(session.time.updated, context.timezone()),
    directory: session.location.directory,
    ...(session.time.archived !== undefined ? { archived: true } : {}),
    ...triageState(triage.get(session.id), session, context.now()),
    ...(session.id === callerRootID ? { isCaller: true } : {}),
    // Only a running turn can be blocked on the user.
    ...(active[session.id] ? await pendingRequests(client, session.id) : {}),
  });

  const triageBase = (sessionID: string) => ({
    profileID: context.profileID,
    sessionID,
    at: context.now(),
  });

  /** Applies one Inbox change, if any, and returns the task as list_tasks describes it. */
  const triaged = async (
    client: OpenCodeClient,
    callerID: string,
    taskID: string,
    command: SessionTriageCommand | null,
  ) => {
    const snapshot = command ? context.triage.dispatch(command) : null;
    if (snapshot) context.onTriageChanged(snapshot);
    const [session, active, root] = await Promise.all([
      getSession(client, taskID),
      client.session.active(),
      rootSession(client, callerID),
    ]);
    return {
      task: await describeTask(
        client,
        session,
        root.id,
        active,
        triageRecords(snapshot ?? context.triage.load(context.profileID)),
      ),
    };
  };

  /**
   * Settles a task once its running turn succeeds, as T3 Code does for a thread settling itself.
   * A failed or interrupted turn stays in the Inbox; steering joins the same turn. Kept in
   * memory: a restart or reconnect mid-turn leaves the task in the Inbox.
   */
  const settleAfterTurn = (taskID: string) => {
    const token = Symbol(taskID);
    scheduling.settleAfterTurn.set(taskID, token);
    const current = () => scheduling.settleAfterTurn.get(taskID) === token;
    const stop = () => {
      if (current()) scheduling.settleAfterTurn.delete(taskID);
      clearTimeout(timer);
      unsubscribe();
      context.signal.removeEventListener("abort", stop);
    };
    const unsubscribe = context.onEvent((event) => {
      if (
        (event.type !== "session.execution.succeeded" &&
          event.type !== "session.execution.failed" &&
          event.type !== "session.execution.interrupted") ||
        event.data.sessionID !== taskID
      )
        return;
      const settle = event.type === "session.execution.succeeded" && current();
      stop();
      if (!settle) return;
      void context
        .withClient(async (client) => {
          const family = await familyWatermark(client, await getSession(client, taskID));
          // Covers the turn's own end even if the read raced OpenCode's idle stamp.
          const through =
            family.updatedAt >= event.created
              ? family
              : { updatedAt: event.created, sessionID: taskID };
          context.onTriageChanged(
            context.triage.dispatch({ ...triageBase(taskID), type: "settle", through }),
          );
        })
        .catch(() => undefined);
    });
    const timer = setTimeout(stop, DAY);
    context.signal.addEventListener("abort", stop, { once: true });
  };

  return [
    tool(
      "schedule_task",
      [
        "Schedule a prompt to run later in Palot, once or on a recurring schedule. Depending on the user's settings, they may be asked to approve it first.",
        'target "this_task" (default) sends the prompt to the calling task when due, for follow-ups such as "check CI tomorrow at 9". "new_task" starts a fresh task in this task\'s project on each run, for recurring work such as a weekly report.',
        "Write the prompt so it stands alone: the run may happen days later, without this conversation in view for new tasks.",
        "Times are the user's local time unless they include an offset. Do not schedule work you can do now, and do not create a duplicate: check list_automations first.",
      ].join("\n"),
      {
        name: {
          type: "string",
          maxLength: 200,
          description: "Short name shown in Palot's Scheduled list.",
        },
        prompt: { type: "string", description: "What to do when the task runs." },
        at: {
          type: "string",
          description:
            'ISO 8601 date-time such as "2026-10-27T09:00". Required for a one-time task; for a recurring one it is the first run and sets the time of day.',
        },
        rrule: {
          type: "string",
          description:
            'RFC 5545 recurrence rule without DTSTART, such as "FREQ=DAILY" or "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR". Omit for a one-time task.',
        },
        timezone: { type: "string", description: "IANA time zone. Defaults to the user's." },
        target: { type: "string", enum: ["this_task", "new_task"] },
        workspace: {
          type: "string",
          enum: ["worktree", "checkout"],
          description:
            'For "new_task": a fresh worktree per run (default) or the project checkout.',
        },
        clientRequestId: {
          type: "string",
          description: "Any unique string. Retrying with the same value never schedules twice.",
        },
      },
      ["name", "prompt"],
      async (args, sessionID, client) => {
        const name = text(args, "name", 200, true)!;
        const prompt = text(args, "prompt", 200_000, true)!;
        const timezone = text(args, "timezone", 128) ?? context.timezone();
        const target = choice(args, "target", ["this_task", "new_task"]) ?? "this_task";
        const workspace = choice(args, "workspace", ["worktree", "checkout"]) ?? "worktree";
        const requestID = text(args, "clientRequestId", 200);
        const trigger = buildTrigger(
          { at: text(args, "at", 64), rrule: text(args, "rrule", 4_096), timezone },
          context.now(),
        );
        const root = await rootSession(client, sessionID);
        const destination: AutomationDraft["destination"] =
          target === "this_task"
            ? { type: "session", sessionID: root.id }
            : {
                type: "standalone",
                ...(await projectOf(client, root)),
                workspace: { type: workspace === "worktree" ? "new-worktree" : "current" },
              };
        const key = requestID ? `${root.id}\0${requestID}` : null;
        return serialized(async () => {
          const existing = key ? scheduling.created.get(key) : undefined;
          const before = context.automations.load(context.profileID);
          const retried = existing && before.automations.find((item) => item.id === existing);
          if (retried) return { scheduled: describeAutomation(retried, root.id), reused: true };

          const draft: AutomationDraft = {
            name,
            status: "active",
            action: { prompt, agent: null, model: null, skills: [] },
            destination,
            trigger,
            missedRuns: { type: "catch-up-once", maxAgeMs: DAY },
            notifications: "background-only",
            createdFromSessionID: root.id,
          };
          const known = new Set(before.automations.map((automation) => automation.id));
          const after = await context.automations.dispatch({
            type: "create",
            profileID: context.profileID,
            draft,
          });
          const record = after.automations.find(
            (automation) =>
              !known.has(automation.id) && automation.createdFromSessionID === root.id,
          );
          if (!record) throw new ToolFailure("failed", "Palot did not record the scheduled task.");
          if (key) scheduling.created.set(key, record.id);
          return { scheduled: describeAutomation(record, root.id) };
        });
      },
    ),
    tool(
      "list_automations",
      "List Palot's scheduled tasks with their schedule, next run and latest run. Use before scheduling, updating or deleting one.",
      {
        scope: {
          type: "string",
          enum: ["this_task", "all"],
          description:
            '"this_task" lists only those created by or sending to the calling task. Defaults to "all".',
        },
      },
      [],
      async (args, sessionID, client) => {
        const scope = choice(args, "scope", ["this_task", "all"]) ?? "all";
        const root = await rootSession(client, sessionID);
        const snapshot = context.automations.load(context.profileID);
        const automations = snapshot.automations.filter(
          (automation) =>
            scope === "all" ||
            automation.createdFromSessionID === root.id ||
            (automation.destination.type === "session" &&
              automation.destination.sessionID === root.id),
        );
        return {
          automations: automations.map((automation) => {
            const run = snapshot.runs
              .filter((item) => item.automationID === automation.id)
              .toSorted((left, right) => right.scheduledFor - left.scheduledFor)[0];
            return {
              ...describeAutomation(automation, root.id),
              ...(run
                ? {
                    lastRun: {
                      state: run.state,
                      at: automationLocalTime(run.scheduledFor, automation.trigger.timezone),
                      ...(run.rootSessionID ? { taskId: run.rootSessionID } : {}),
                      ...(run.error ? { error: run.error.message } : {}),
                    },
                  }
                : {}),
            };
          }),
        };
      },
    ),
    tool(
      "update_automation",
      'Change a scheduled task\'s name, prompt, schedule, or pause or resume it. Only the fields you pass change. The user may be asked to approve the change. To change only the time of a recurring task, pass at; pass rrule "" to make it one-time.',
      {
        automationId: { type: "string" },
        name: { type: "string", maxLength: 200 },
        prompt: { type: "string" },
        at: { type: "string", description: "ISO 8601 date-time, as for schedule_task." },
        rrule: { type: "string" },
        timezone: { type: "string" },
        status: { type: "string", enum: ["active", "paused"] },
      },
      ["automationId"],
      async (args, sessionID, client) => {
        const record = automationByID(text(args, "automationId", 200, true)!);
        const name = text(args, "name", 200);
        const prompt = text(args, "prompt", 200_000);
        const status = choice(args, "status", ["active", "paused"]);
        const at = text(args, "at", 64);
        const rrule = optionalRaw(args, "rrule", 4_096);
        const timezone = text(args, "timezone", 128);
        const rescheduled = at !== undefined || rrule !== undefined || timezone !== undefined;
        if (!name && !prompt && !status && !rescheduled)
          throw new ToolFailure("invalid_arguments", "Pass at least one field to change.");
        const current = record.trigger;
        const zone = timezone ?? current.timezone;
        const trigger = rescheduled
          ? buildTrigger(
              {
                at:
                  at ??
                  automationLocalTime(current.type === "once" ? current.at : current.dtstart, zone),
                rrule:
                  rrule !== undefined
                    ? rrule || undefined
                    : current.type === "recurring"
                      ? current.rrule
                      : undefined,
                timezone: zone,
              },
              context.now(),
            )
          : current;
        const draft: AutomationDraft = {
          name: name ?? record.name,
          status: status ?? record.status,
          action: { ...record.action, ...(prompt ? { prompt } : {}) },
          destination: record.destination,
          trigger,
          missedRuns: record.missedRuns,
          notifications: record.notifications,
          createdFromSessionID: record.createdFromSessionID,
        };
        const snapshot = await context.automations.dispatch({
          type: "update",
          profileID: context.profileID,
          automationID: record.id,
          draft,
        });
        const updated = snapshot.automations.find((automation) => automation.id === record.id);
        const root = await rootSession(client, sessionID);
        return { updated: describeAutomation(updated ?? record, root.id) };
      },
    ),
    tool(
      "delete_automation",
      'Delete a scheduled task so it never runs again. Tasks its earlier runs started are kept. The user may be asked to approve the deletion. To stop it temporarily, use update_automation with status "paused".',
      { automationId: { type: "string" } },
      ["automationId"],
      async (args) => {
        const record = automationByID(text(args, "automationId", 200, true)!);
        await context.automations.dispatch({
          type: "delete",
          profileID: context.profileID,
          automationID: record.id,
        });
        return { deleted: { automationId: record.id, name: record.name } };
      },
    ),
    tool(
      "list_tasks",
      "List Palot tasks, newest activity first, with whether each is running or waiting for the user. Defaults to the calling task's project. Use read_task for a task's messages.",
      {
        scope: { type: "string", enum: ["project", "all"], description: 'Defaults to "project".' },
        status: { type: "string", enum: ["running", "all"], description: 'Defaults to "all".' },
        search: { type: "string", description: "Match task titles." },
        includeArchived: { type: "boolean" },
        limit: { type: "integer", minimum: 1, maximum: 50, description: "Defaults to 20." },
      },
      [],
      async (args, sessionID, client) => {
        const scope = choice(args, "scope", ["project", "all"]) ?? "project";
        const status = choice(args, "status", ["running", "all"]) ?? "all";
        const search = text(args, "search", 200);
        const includeArchived = flag(args, "includeArchived") ?? false;
        const limit = integer(args, "limit", 1, 50) ?? 20;
        const root = await rootSession(client, sessionID);
        const active = await client.session.active();
        let sessions: SessionInfo[];
        if (status === "running") {
          const roots = new Map<string, SessionInfo>();
          for (const id of Object.keys(active)) {
            const session = await rootSession(client, id).catch(() => null);
            if (session) roots.set(session.id, session);
          }
          sessions = [...roots.values()];
        } else {
          sessions = (
            await client.session.list({
              parentID: null,
              order: "desc",
              limit,
              ...(search ? { search } : {}),
              ...(scope === "project" ? { project: root.projectID } : {}),
              ...(includeArchived ? {} : { archived: false }),
            })
          ).data;
        }
        sessions = sessions
          .filter(
            (session) =>
              (scope === "all" || session.projectID === root.projectID) &&
              (includeArchived || session.time.archived === undefined) &&
              (!search || (session.title ?? "").toLowerCase().includes(search.toLowerCase())),
          )
          .toSorted((left, right) => right.time.updated - left.time.updated)
          .slice(0, limit);
        const triage = triageRecords(context.triage.load(context.profileID));
        return {
          tasks: await Promise.all(
            sessions.map((session) => describeTask(client, session, root.id, active, triage)),
          ),
        };
      },
    ),
    tool(
      "read_task",
      "Read a Palot task: its status, requests waiting for the user, and its latest messages. Defaults to the calling task.",
      {
        taskId: { type: "string" },
        messages: {
          type: "integer",
          minimum: 1,
          maximum: 20,
          description: "How many recent messages to include. Defaults to 6.",
        },
      },
      [],
      async (args, sessionID, client) => {
        const id = text(args, "taskId", 200) ?? sessionID;
        const count = integer(args, "messages", 1, 20) ?? 6;
        const [session, root, active] = await Promise.all([
          getSession(client, id),
          rootSession(client, sessionID),
          client.session.active(),
        ]);
        const [response, pending] = await Promise.all([
          client.message.list({ sessionID: session.id, limit: count * 4, order: "desc" }),
          pendingRequests(client, session.id),
        ]);
        const messages = response.data.flatMap((message) => {
          if (message.type === "user") return [{ role: "user", text: clip(message.text) }];
          if (message.type === "assistant") {
            const reply = clip(
              message.content
                .flatMap((part) => (part.type === "text" ? [part.text] : []))
                .join("\n\n")
                .trim(),
            );
            const tools = message.content.flatMap((part) =>
              part.type === "tool" ? [part.name] : [],
            );
            if (!reply && !tools.length) return [];
            return [
              {
                role: "assistant",
                ...(reply ? { text: reply } : {}),
                ...(tools.length ? { tools } : {}),
                ...(message.error ? { error: message.error.message } : {}),
              },
            ];
          }
          if (message.type === "idle" && message.outcome !== "succeeded")
            return [
              {
                role: "status",
                text: `Turn ${message.outcome}${message.error ? `: ${message.error.message}` : ""}`,
              },
            ];
          return [];
        });
        const triage = triageRecords(context.triage.load(context.profileID));
        return {
          ...(await describeTask(client, session, root.id, active, triage)),
          ...(session.parentID ? { parentTaskId: session.parentID } : {}),
          ...pending,
          messages: messages.slice(0, count).reverse(),
        };
      },
    ),
    tool(
      "wait_tasks",
      "Wait until the first of up to 8 other Palot tasks finishes its turn or needs the user, then report them. Returns at once if one already has. Use instead of polling read_task.",
      {
        taskIds: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 8 },
        timeoutSeconds: {
          type: "integer",
          minimum: 10,
          maximum: MAX_WAIT_SECONDS,
          description: `Defaults to ${DEFAULT_WAIT_SECONDS}.`,
        },
      },
      ["taskIds"],
      async (args, sessionID, client) => {
        const ids = taskIDs(args);
        const timeout =
          (integer(args, "timeoutSeconds", 10, MAX_WAIT_SECONDS) ?? DEFAULT_WAIT_SECONDS) * 1_000;
        const root = await rootSession(client, sessionID);
        if (ids.includes(root.id) || ids.includes(sessionID))
          throw new ToolFailure("invalid_arguments", "A task cannot wait for itself.");
        const changed = await waitForTasks(context, client, ids, timeout);
        const [active, sessions] = await Promise.all([
          client.session.active(),
          Promise.all(ids.map((id) => getSession(client, id))),
        ]);
        const triage = triageRecords(context.triage.load(context.profileID));
        return {
          ...(changed.length ? { changed } : { timedOut: true }),
          tasks: await Promise.all(
            sessions.map((session) => describeTask(client, session, root.id, active, triage)),
          ),
        };
      },
    ),
    tool(
      "settle_task",
      "Settle a Palot task (session) as done for now, as the user does in the sidebar: it leaves the Inbox until it has new activity. Defaults to the calling task; settling the calling task takes effect when its current turn ends, unless the turn fails or is interrupted. Another task must not be running or waiting for the user: use wait_tasks first. Pass settled false to move a task back to the Inbox. Only settle a task when its work is finished or the user asked.",
      { taskId: { type: "string" }, settled: { type: "boolean" } },
      [],
      async (args, sessionID, client) => {
        const settled = flag(args, "settled") ?? true;
        const [task, caller] = await Promise.all([
          rootSession(client, text(args, "taskId", 200) ?? sessionID),
          rootSession(client, sessionID),
        ]);
        const base = triageBase(task.id);
        if (!settled) {
          scheduling.settleAfterTurn.delete(task.id);
          return triaged(client, sessionID, task.id, { ...base, type: "inbox" });
        }
        const running = Boolean((await client.session.active())[task.id]);
        // Settling now would not stick: the turn's end is new activity that unsettles it.
        if (running && task.id === caller.id) {
          settleAfterTurn(task.id);
          return {
            ...(await triaged(client, sessionID, task.id, null)),
            settlesWhenTurnEnds: true,
          };
        }
        if (running)
          throw new ToolFailure(
            "task_busy",
            "That task is still running. Use wait_tasks until it finishes, then settle it.",
          );
        for (const member of await familyIDs(client, task.id)) {
          if ("waitingForUser" in (await pendingRequests(client, member)))
            throw new ToolFailure(
              "task_busy",
              "That task is waiting for the user to answer a request. It can be settled once they do.",
            );
        }
        return triaged(client, sessionID, task.id, {
          ...base,
          type: "settle",
          through: await familyWatermark(client, task),
        });
      },
    ),
    tool(
      "snooze_task",
      "Snooze a Palot task (session) until a time: it leaves the Inbox and returns then, or sooner if it has new activity. Defaults to the calling task. To wake it now, use settle_task with settled false.",
      {
        taskId: { type: "string" },
        until: { type: "string", description: "Future ISO 8601 date-time." },
      },
      ["until"],
      async (args, sessionID, client) => {
        const value = text(args, "until", 64, true)!;
        const until = automationInstant(value, context.timezone());
        if (until === null || until <= context.now())
          throw new ToolFailure("invalid_arguments", "until must be a future ISO 8601 date-time.");
        const task = await rootSession(client, text(args, "taskId", 200) ?? sessionID);
        return triaged(client, sessionID, task.id, {
          ...triageBase(task.id),
          type: "snooze",
          until,
          through: await familyWatermark(client, task),
        });
      },
    ),
    tool(
      "pin_task",
      "Pin a Palot task (session) to the top of the Inbox, or pass pinned false to unpin it. Defaults to the calling task.",
      { taskId: { type: "string" }, pinned: { type: "boolean" } },
      [],
      async (args, sessionID, client) => {
        const pinned = flag(args, "pinned") ?? true;
        const task = await rootSession(client, text(args, "taskId", 200) ?? sessionID);
        return triaged(client, sessionID, task.id, {
          ...triageBase(task.id),
          type: pinned ? "pin" : "unpin",
        });
      },
    ),
    tool(
      "archive_task",
      "Archive a Palot task (session) in OpenCode, which hides it in every app, or pass archived false to restore it. Defaults to the calling task. Only archive a task when the user asked; to mark it done for now, use settle_task.",
      { taskId: { type: "string" }, archived: { type: "boolean" } },
      [],
      async (args, sessionID, client) => {
        const archived = flag(args, "archived") ?? true;
        const task = await rootSession(client, text(args, "taskId", 200) ?? sessionID);
        await client.session.update({ sessionID: task.id, archived });
        return triaged(client, sessionID, task.id, null);
      },
    ),
  ];
}

/**
 * In Full access tasks, or with "Ask before agents schedule tasks" off, these tools run without
 * asking. Otherwise tools that ask must have asked, unless the user chose "Always allow for this project": that
 * saved rule is OpenCode's own, applied after the task's rules. Otherwise fail closed unless
 * the task's own last matching rule is an explicit ask, which OpenCode applies after agent and
 * config rules. Tasks whose rules predate these tools (Full access was only `*: allow`) get the
 * ask rules added and the model retries, which shows the approval card.
 */
async function requireApproval(
  client: OpenCodeClient,
  sessionID: string,
  name: PalotToolName,
  askBeforeScheduling: boolean,
) {
  const session = await client.session.get({ sessionID });
  // Like ChatGPT: Full access tasks never ask, and the user can turn asking off everywhere.
  if (!askBeforeScheduling || isFullAccessRuleset(session.permissions)) return;
  const action = palotToolAction(name);
  const permissions: PermissionRuleset = session.permissions ?? [];
  const matches = (rule: { action: string; resource: string }) =>
    wildcard(action, rule.action) && wildcard("*", rule.resource);
  if (permissions.findLast(matches)?.effect === "ask") return;
  const saved = await client.permission.saved.list({ projectID: session.projectID });
  if (saved.some(matches)) return;
  const asks = Object.entries(PALOT_TOOL_APPROVALS).flatMap(([tool, effect]) =>
    effect === "ask"
      ? [{ action: palotToolAction(tool as PalotToolName), resource: "*", effect: "ask" as const }]
      : [],
  );
  await client.session.update({ sessionID, permissions: [...permissions, ...asks] });
  throw new ToolFailure(
    "approval_required",
    "This needs the user's approval. Call the tool again with the same arguments to ask them.",
  );
}

/** OpenCode's permission wildcard: `*` matches any run of characters. */
function wildcard(value: string, pattern: string): boolean {
  const expression = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replaceAll("*", ".*");
  return new RegExp(`^${expression}$`, "s").test(value);
}

function buildTrigger(
  input: { at: string | undefined; rrule: string | undefined; timezone: string },
  now: number,
): AutomationTrigger {
  const start = input.at === undefined ? null : automationInstant(input.at, input.timezone);
  if (input.at !== undefined && start === null)
    throw new ToolFailure(
      "invalid_schedule",
      `at must be an ISO 8601 date-time such as "2026-10-27T09:00" in a valid time zone (got "${input.at}" in ${input.timezone}).`,
    );
  let trigger: AutomationTrigger;
  if (input.rrule) {
    trigger = {
      version: 1,
      type: "recurring",
      dtstart: start ?? now,
      timezone: input.timezone,
      rrule: input.rrule.trim().replace(/^RRULE:/i, ""),
    };
  } else {
    if (start === null)
      throw new ToolFailure(
        "invalid_schedule",
        "Pass at for a one-time task, or rrule for a recurring one.",
      );
    if (start <= now) throw new ToolFailure("invalid_schedule", "at is in the past.");
    trigger = { version: 1, type: "once", at: start, timezone: input.timezone };
  }
  try {
    validateAutomationTrigger(trigger);
  } catch (error) {
    throw new ToolFailure(
      "invalid_schedule",
      error instanceof Error ? error.message : String(error),
    );
  }
  return trigger;
}

function describeAutomation(automation: AutomationRecord, callerRootID: string) {
  const { trigger, destination } = automation;
  return {
    automationId: automation.id,
    name: automation.name,
    status: automation.status,
    schedule:
      trigger.type === "once"
        ? `Once at ${automationLocalTime(trigger.at, trigger.timezone)} (${trigger.timezone})`
        : scheduleSummary(trigger),
    ...(trigger.type === "recurring"
      ? { rrule: trigger.rrule, start: automationLocalTime(trigger.dtstart, trigger.timezone) }
      : {}),
    timezone: trigger.timezone,
    nextRun:
      automation.nextRunAt === null
        ? null
        : automationLocalTime(automation.nextRunAt, trigger.timezone),
    target:
      destination.type === "session"
        ? destination.sessionID === callerRootID
          ? { type: "this_task" }
          : { type: "task", taskId: destination.sessionID }
        : {
            type: "new_task",
            directory: destination.sourceDirectory,
            workspace: destination.workspace.type === "new-worktree" ? "worktree" : "checkout",
          },
    ...(automation.createdFromSessionID
      ? { createdFromTaskId: automation.createdFromSessionID }
      : {}),
    prompt: clip(automation.action.prompt, 1_000),
  };
}

async function projectOf(client: OpenCodeClient, session: SessionInfo) {
  const project = (await client.project.list()).find((item) => item.id === session.projectID);
  if (!project) throw new ToolFailure("not_found", "This task's project is unavailable.");
  return { projectID: project.id, sourceDirectory: project.canonical };
}

async function getSession(client: OpenCodeClient, sessionID: string): Promise<SessionInfo> {
  try {
    return await client.session.get({ sessionID });
  } catch {
    throw new ToolFailure("not_found", `No task has ID ${sessionID}.`);
  }
}

/** Palot organizes top-level tasks; a subagent belongs to the task that started it. */
async function rootSession(client: OpenCodeClient, sessionID: string): Promise<SessionInfo> {
  let session = await getSession(client, sessionID);
  const seen = new Set([session.id]);
  while (session.parentID && !seen.has(session.parentID) && seen.size < 32) {
    seen.add(session.parentID);
    session = await getSession(client, session.parentID);
  }
  return session;
}

/** A task and its subagents, at most 50. */
async function familyIDs(client: OpenCodeClient, rootID: string): Promise<string[]> {
  const family = [rootID];
  for (let index = 0; index < family.length && family.length < 50; index++) {
    const children = await client.session.list({ parentID: family[index]!, limit: 50 });
    for (const child of children.data)
      if (!family.includes(child.id) && family.length < 50) family.push(child.id);
  }
  return family;
}

/** The latest activity in a task and its subagents, which settling and snoozing cover. */
async function familyWatermark(client: OpenCodeClient, root: SessionInfo) {
  const activity = triageActivity;
  let latest = { updatedAt: activity(root), sessionID: root.id };
  const pending = [root.id];
  const seen = new Set(pending);
  while (pending.length && seen.size < 200) {
    const children = await client.session.list({ parentID: pending.pop()!, limit: 100 });
    for (const child of children.data) {
      if (seen.has(child.id)) continue;
      seen.add(child.id);
      pending.push(child.id);
      if (
        activity(child) > latest.updatedAt ||
        (activity(child) === latest.updatedAt && child.id > latest.sessionID)
      )
        latest = { updatedAt: activity(child), sessionID: child.id };
    }
  }
  return latest;
}

async function pendingRequests(client: OpenCodeClient, sessionID: string) {
  const [permissions, forms] = await Promise.all([
    client.permission.list({ sessionID }).catch(() => []),
    client.session.form.list({ sessionID }).catch(() => []),
  ]);
  const waiting = [
    ...permissions.map((request) => ({ type: "permission", action: request.action })),
    ...forms.map((form) => ({
      type: form.metadata?.kind === "question" ? "question" : "form",
      title: form.title,
    })),
  ];
  return waiting.length ? { waitingForUser: waiting } : {};
}

function triageRecords(snapshot: SessionTriageSnapshot): Map<string, SessionTriageRecord> {
  return new Map(snapshot.sessions.map((record) => [record.sessionID, record]));
}

function triageState(record: SessionTriageRecord | undefined, session: SessionInfo, now: number) {
  if (!record) return { inbox: "inbox" };
  const covered = (through: { updatedAt: number } | null) =>
    through !== null && through.updatedAt >= triageActivity(session);
  return {
    inbox:
      record.snoozedUntil !== null && record.snoozedUntil > now && covered(record.snoozedThrough)
        ? "snoozed"
        : record.disposition === "settled" && covered(record.settledThrough)
          ? "settled"
          : "inbox",
    ...(record.pinnedAt !== null ? { pinned: true } : {}),
  };
}

/**
 * Real activity, as Palot's Inbox counts it: `time.updated` capped at the latest turn end, so
 * permission and title writes (such as browser attach and detach) do not count.
 */
function triageActivity(session: SessionInfo): number {
  return Math.min(session.time.updated, Math.max(session.time.idle ?? 0, session.time.created));
}

/** Resolves with the tasks that finished a turn or started waiting for the user. */
async function waitForTasks(
  context: PalotToolContext,
  client: OpenCodeClient,
  ids: string[],
  timeout: number,
): Promise<string[]> {
  const targets = new Set(ids);
  // A subagent's request also blocks its task. Cache each session's owning target.
  const owners = new Map<string, string | null>(ids.map((id) => [id, id]));
  const ownerOf = async (sessionID: string): Promise<string | null> => {
    if (owners.has(sessionID)) return owners.get(sessionID)!;
    let owner: string | null = null;
    let current = sessionID;
    for (let depth = 0; depth < 16; depth++) {
      const session = await client.session.get({ sessionID: current }).catch(() => null);
      if (!session?.parentID) break;
      if (targets.has(session.parentID)) {
        owner = session.parentID;
        break;
      }
      current = session.parentID;
    }
    owners.set(sessionID, owner);
    return owner;
  };

  return new Promise<string[]>((resolve, reject) => {
    const changed = new Set<string>();
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      unsubscribe();
      context.signal.removeEventListener("abort", finish);
      resolve([...changed]);
    };
    const mark = (id: string | null) => {
      if (!id) return;
      changed.add(id);
      finish();
    };
    const unsubscribe = context.onEvent((event) => {
      if (
        event.type === "session.execution.succeeded" ||
        event.type === "session.execution.failed" ||
        event.type === "session.execution.interrupted"
      ) {
        if (targets.has(event.data.sessionID)) mark(event.data.sessionID);
      } else if (event.type === "permission.asked") {
        void ownerOf(event.data.sessionID).then(mark);
      } else if (event.type === "form.created") {
        void ownerOf(event.data.form.sessionID).then(mark);
      }
    });
    const timer = setTimeout(finish, timeout);
    context.signal.addEventListener("abort", finish, { once: true });
    if (context.signal.aborted) finish();

    // Subscribed first, so nothing that happens during this check is missed.
    void (async () => {
      const active = await client.session.active();
      for (const id of ids) {
        await getSession(client, id);
        if (!active[id]) {
          changed.add(id);
          continue;
        }
        // A subagent may already be waiting for the user; no new event would arrive.
        for (const member of await familyIDs(client, id)) {
          owners.set(member, id);
          if ("waitingForUser" in (await pendingRequests(client, member))) {
            changed.add(id);
            break;
          }
        }
      }
      if (changed.size) finish();
    })().catch((error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      unsubscribe();
      context.signal.removeEventListener("abort", finish);
      reject(error);
    });
  });
}

function taskIDs(args: Args): string[] {
  const value = args.taskIds;
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > 8 ||
    value.some((id) => typeof id !== "string" || !id.trim() || id.length > 200)
  )
    throw new ToolFailure("invalid_arguments", "taskIds must list 1 to 8 task IDs.");
  return [...new Set(value.map((id: string) => id.trim()))];
}

function text(args: Args, key: string, max: number, required = false): string | undefined {
  const value = optionalRaw(args, key, max);
  if (value !== undefined && value.trim()) return value.trim();
  if (required) throw new ToolFailure("invalid_arguments", `${key} is required.`);
  return undefined;
}

/** A string argument as given, including empty. */
function optionalRaw(args: Args, key: string, max: number): string | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string")
    throw new ToolFailure("invalid_arguments", `${key} must be a string.`);
  if (value.length > max)
    throw new ToolFailure("invalid_arguments", `${key} must be at most ${max} characters.`);
  return value;
}

function choice<T extends string>(args: Args, key: string, values: readonly T[]): T | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || !values.includes(value as T))
    throw new ToolFailure("invalid_arguments", `${key} must be one of: ${values.join(", ")}.`);
  return value as T;
}

function flag(args: Args, key: string): boolean | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "boolean")
    throw new ToolFailure("invalid_arguments", `${key} must be a boolean.`);
  return value;
}

function integer(args: Args, key: string, min: number, max: number): number | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max)
    throw new ToolFailure("invalid_arguments", `${key} must be an integer from ${min} to ${max}.`);
  return value;
}

function clip(value: string, max = MAX_TEXT): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function ok(value: unknown): ClientMcpToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

function failure(code: string, message: string): ClientMcpToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify({ error: { code, message } }, null, 2) }],
    isError: true,
  };
}
