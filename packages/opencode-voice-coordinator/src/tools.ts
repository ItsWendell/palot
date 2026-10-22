import path from "node:path";
import type { Plugin } from "@opencode/plugin";
import { Schema } from "effect";
import { COORDINATOR_AGENT } from "./agent";
import { describeSession, type SessionSnapshot } from "./session";
import { waitForAny } from "./wait";

type ToolEditor = Parameters<Parameters<Plugin.Context["tool"]["transform"]>[0]>[0];
type ToolContext = Parameters<Parameters<ToolEditor["add"]>[0]["execute"]>[1];

export type CoordinatorContext = Pick<
  Plugin.Context,
  "event" | "location" | "permission" | "session" | "storage" | "worktree"
>;

export const TOOL_NAMES = [
  "voice_list_projects",
  "voice_list_sessions",
  "voice_create_session",
  "voice_send_message",
  "voice_read_session",
  "voice_wait_sessions",
] as const;

/** Storage keys for task sessions a coordinator started; session IDs sort newest first. */
const TASK_PREFIX = "task/";
const TASK_SCAN_LIMIT = 100;
const DEFAULT_WAIT_MS = 60_000;

const SessionID = Schema.String.check(Schema.isStartingWith("ses_")).annotate({
  description: "Task session ID (ses_…).",
});
/** Any non-blank string; trimming would drop field descriptions from the JSON schema. */
const Text = Schema.String.check(Schema.isPattern(/\S/));

export const ListSessionsInput = Schema.Struct({
  directory: Schema.optionalKey(Schema.String).annotate({
    description: "Only sessions in this absolute directory or below it.",
  }),
  limit: Schema.optionalKey(
    Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 25 })),
  ).annotate({
    description: "Maximum sessions to return, newest first. Defaults to 10.",
  }),
});

export const CreateSessionInput = Schema.Struct({
  directory: Text.annotate({ description: "Absolute project directory the task works in." }),
  title: Schema.optionalKey(Text).annotate({
    description: "Short task title. Omit to let OpenCode name it.",
  }),
  prompt: Text.annotate({ description: "Self-contained instructions for the task session." }),
  agent: Schema.optionalKey(Text).annotate({
    description: "Agent ID for the task. Omit unless the user asked for a specific agent.",
  }),
});

export const SendMessageInput = Schema.Struct({
  sessionID: SessionID,
  text: Text.annotate({ description: "Message for the task session." }),
  delivery: Schema.optionalKey(Schema.Literals(["steer", "queue"])).annotate({
    description: '"steer" (default) joins the current turn; "queue" waits for it to finish.',
  }),
});

export const ReadSessionInput = Schema.Struct({
  sessionID: SessionID,
  limit: Schema.optionalKey(
    Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 5 })),
  ).annotate({
    description: "Number of latest assistant replies to return. Defaults to 1.",
  }),
});

export const WaitSessionsInput = Schema.Struct({
  sessionIDs: Schema.Array(SessionID).check(Schema.isMinLength(1), Schema.isMaxLength(8)),
  timeoutMs: Schema.optionalKey(
    Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 120_000 })),
  ).annotate({
    description: "How long to wait. 0 only reports current status. Defaults to 60000.",
  }),
});

export function registerTools(ctx: CoordinatorContext, editor: ToolEditor): void {
  const inspect = async (sessionID: string, replyLimit = 0): Promise<SessionSnapshot> => {
    const [info, messages, permissions] = await Promise.all([
      ctx.session.get({ sessionID }),
      ctx.session.context({ sessionID }),
      ctx.permission.list({ sessionID }),
    ]);
    return describeSession(info, messages, permissions.length, replyLimit);
  };

  const taskSessions = async () => {
    const { entries } = await ctx.storage.scan({ prefix: TASK_PREFIX, limit: TASK_SCAN_LIMIT });
    const sessions = await Promise.allSettled(
      entries.map((entry) => ctx.session.get({ sessionID: entry.key.slice(TASK_PREFIX.length) })),
    );
    // Removed sessions drop out here; their records are harmless and cheap to keep.
    return sessions
      .flatMap((result) => (result.status === "fulfilled" ? [result.value] : []))
      .sort((left, right) => right.time.updated - left.time.updated);
  };

  editor.add({
    name: "voice_list_projects",
    description:
      "List project directories you can start task sessions in: this session's project, its worktrees, and directories of recent task sessions.",
    input: Schema.Struct({}),
    options: { codemode: false },
    execute: async (_input, context) => {
      assertCoordinator(context);
      const project = ctx.location.project;
      const worktrees = await ctx.worktree.list({ projectID: project.id }).catch(() => []);
      const recent = await taskSessions();
      const projects = uniqueBy(
        [
          { directory: project.directory, projectID: project.id, source: "current" },
          ...worktrees.map((worktree) => ({
            directory: worktree.directory,
            projectID: project.id,
            source: "worktree",
          })),
          ...recent.map((session) => ({
            directory: session.location.directory,
            projectID: session.projectID,
            source: "recent task",
          })),
        ],
        (entry) => entry.directory,
      );
      return json({ projects });
    },
  });

  editor.add({
    name: "voice_list_sessions",
    description:
      "List recent task sessions started from voice, newest first, with their status (busy, idle, or needs_input).",
    input: ListSessionsInput,
    options: { codemode: false },
    execute: async (input, context) => {
      assertCoordinator(context);
      const within = input.directory && path.resolve(input.directory);
      const sessions = (await taskSessions())
        .filter((session) => !within || isWithin(session.location.directory, within))
        .slice(0, input.limit ?? 10);
      return json({ sessions: await Promise.all(sessions.map((session) => inspect(session.id))) });
    },
  });

  editor.add({
    name: "voice_create_session",
    description:
      "Start a task session in a project directory and send it the first prompt. Returns the new session ID.",
    input: CreateSessionInput,
    options: { codemode: false },
    execute: async (input, context) => {
      assertCoordinator(context);
      if (!path.isAbsolute(input.directory)) throw new Error("directory must be an absolute path.");
      const directory = path.resolve(input.directory);
      await ctx.permission.assert({
        ...permissionSource(context),
        action: "voice_create_session",
        resources: [directory],
        save: [directory],
        metadata: { directory, title: input.title, prompt: input.prompt },
      });
      const session = await ctx.session.create({
        location: { directory },
        ...(input.title ? { title: input.title } : {}),
        ...(input.agent ? { agent: input.agent } : {}),
        metadata: { voiceCoordinator: context.sessionID },
      });
      await ctx.storage.set(TASK_PREFIX + session.id, { coordinatorSessionID: context.sessionID });
      await ctx.session.prompt({ sessionID: session.id, text: input.prompt });
      return {
        ...json({
          sessionID: session.id,
          directory: session.location.directory,
          title: session.title ?? null,
        }),
        metadata: { sessionID: session.id },
      };
    },
  });

  editor.add({
    name: "voice_send_message",
    description: "Send a follow-up or correction to a task session.",
    input: SendMessageInput,
    options: { codemode: false },
    execute: async (input, context) => {
      assertCoordinator(context);
      if (input.sessionID === context.sessionID)
        throw new Error("This is your own session; reply directly instead.");
      await ctx.session.get({ sessionID: input.sessionID });
      await ctx.permission.assert({
        ...permissionSource(context),
        action: "voice_send_message",
        resources: [input.sessionID],
        save: ["*"],
        metadata: {
          sessionID: input.sessionID,
          text: input.text,
          delivery: input.delivery ?? "steer",
        },
      });
      const entry = await ctx.session.prompt({
        sessionID: input.sessionID,
        text: input.text,
        ...(input.delivery ? { delivery: input.delivery } : {}),
      });
      return json({ sessionID: input.sessionID, messageID: entry.id, delivery: entry.delivery });
    },
  });

  editor.add({
    name: "voice_read_session",
    description:
      "Read a task session's status, pending approvals and questions, and its latest assistant reply.",
    input: ReadSessionInput,
    options: { codemode: false },
    execute: async (input, context) => {
      assertCoordinator(context);
      return json(await inspect(input.sessionID, input.limit ?? 1));
    },
  });

  editor.add({
    name: "voice_wait_sessions",
    description:
      "Wait until any listed task session goes idle or needs the user's input, or until the timeout. Returns each session's status.",
    input: WaitSessionsInput,
    options: { codemode: false },
    execute: async (input, context) => {
      assertCoordinator(context);
      const sessionIDs = [...new Set(input.sessionIDs)];
      const timeoutMs = input.timeoutMs ?? DEFAULT_WAIT_MS;
      const before = await Promise.all(sessionIDs.map((sessionID) => inspect(sessionID)));
      const waiting = before.find((session) => session.status === "needs_input");
      if (waiting || timeoutMs === 0) {
        const outcome = waiting
          ? { reason: "needs_input", sessionID: waiting.sessionID }
          : { reason: "timeout" };
        return json({ ...outcome, sessions: before });
      }
      const outcome = await waitForAny({
        sessionIDs,
        timeoutMs,
        signal: context.signal,
        waitIdle: (sessionID) => ctx.session.wait({ sessionID }),
        events: (signal) => ctx.event.subscribe({ signal }),
      });
      const sessions = await Promise.all(sessionIDs.map((sessionID) => inspect(sessionID)));
      return json({ ...outcome, sessions: settleIdle(sessions, outcome) });
    },
  });
}

/** `session.wait` is authoritative; context messages can trail it by a moment. */
export function settleIdle(
  sessions: SessionSnapshot[],
  outcome: { reason: string; sessionID?: string },
): SessionSnapshot[] {
  if (outcome.reason !== "idle") return sessions;
  return sessions.map((session) =>
    session.sessionID === outcome.sessionID && session.status === "busy"
      ? { ...session, status: "idle" }
      : session,
  );
}

function assertCoordinator(context: ToolContext): void {
  if (context.agent !== COORDINATOR_AGENT)
    throw new Error(`Voice tools are only available to the ${COORDINATOR_AGENT} agent.`);
}

function permissionSource(context: ToolContext) {
  return {
    sessionID: context.sessionID,
    agent: context.agent,
    source: { type: "tool" as const, messageID: context.messageID, id: context.id },
  };
}

function json(value: unknown) {
  return { content: JSON.stringify(value) };
}

function isWithin(directory: string, root: string): boolean {
  const relative = path.relative(root, directory);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function uniqueBy<T>(items: readonly T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => !seen.has(key(item)) && seen.add(key(item)));
}
