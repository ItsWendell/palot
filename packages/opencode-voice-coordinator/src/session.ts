import type { Plugin } from "@opencode/plugin";

type SessionApi = Plugin.Context["session"];
export type SessionInfo = Awaited<ReturnType<SessionApi["get"]>>;
export type SessionMessage = Awaited<ReturnType<SessionApi["context"]>>[number];
export type SessionStatus = "busy" | "idle" | "needs_input";

/** Replies are summarised aloud, so only their opening matters to the coordinator. */
export const REPLY_CHAR_LIMIT = 1500;

export interface SessionSnapshot {
  sessionID: string;
  title: string | null;
  directory: string;
  status: SessionStatus;
  outcome?: "succeeded" | "failed" | "interrupted";
  updated: string;
  pendingPermissions: number;
  pendingQuestions: number;
  replies?: string[];
}

/** Messages that start or continue a turn; agent and model switches do not. */
const TURN_MESSAGES = new Set<SessionMessage["type"]>(["user", "synthetic", "assistant"]);

/**
 * Describes a session from its context messages. A turn ends with an `idle` marker, so any
 * turn message after the last marker means the session is still working.
 */
export function describeSession(
  info: SessionInfo,
  messages: readonly SessionMessage[],
  pendingPermissions: number,
  replyLimit = 0,
): SessionSnapshot {
  const lastIdle = messages.findLastIndex((message) => message.type === "idle");
  const turn = messages.slice(lastIdle + 1);
  const running = turn.some((message) => TURN_MESSAGES.has(message.type));
  const pendingQuestions = running ? countOpenQuestions(turn) : 0;
  const status: SessionStatus =
    pendingPermissions > 0 || pendingQuestions > 0 ? "needs_input" : running ? "busy" : "idle";
  return {
    sessionID: info.id,
    title: info.title ?? null,
    directory: info.location.directory,
    status,
    ...(status === "idle" && info.outcome ? { outcome: info.outcome } : {}),
    updated: new Date(info.time.updated).toISOString(),
    pendingPermissions,
    pendingQuestions,
    ...(replyLimit > 0 ? { replies: latestReplies(messages, replyLimit) } : {}),
  };
}

/** The newest assistant texts, oldest first, each cut to REPLY_CHAR_LIMIT. */
export function latestReplies(messages: readonly SessionMessage[], limit: number): string[] {
  const replies: string[] = [];
  for (let index = messages.length - 1; index >= 0 && replies.length < limit; index--) {
    const message = messages[index];
    if (message?.type !== "assistant") continue;
    const text = message.content
      .flatMap((part) => (part.type === "text" ? [part.text] : []))
      .join("\n")
      .trim();
    if (text) replies.unshift(truncate(text, REPLY_CHAR_LIMIT));
  }
  return replies;
}

export function truncate(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit).trimEnd()}…`;
}

function countOpenQuestions(turn: readonly SessionMessage[]): number {
  return turn
    .flatMap((message) => (message.type === "assistant" ? message.content : []))
    .filter(
      (part) =>
        part.type === "tool" &&
        part.name === "question" &&
        (part.state.status === "running" || part.state.status === "streaming"),
    ).length;
}
