import type { SessionInfo, SessionMessage } from "./session";

let sequence = 0;
const nextID = () => `msg_${String(++sequence).padStart(4, "0")}`;

export function sessionInfo(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id: "ses_task",
    projectID: "prj_palot",
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 1_000, updated: 2_000 },
    title: "Fix login",
    location: { directory: "/work/palot" },
    ...overrides,
  };
}

export const user = (text: string): SessionMessage => ({
  id: nextID(),
  time: { created: 1 },
  type: "user",
  text,
});

export const idle = (
  outcome: "succeeded" | "failed" | "interrupted" = "succeeded",
): SessionMessage => ({
  id: nextID(),
  time: { created: 1 },
  type: "idle",
  outcome,
});

export const agentSwitched = (): SessionMessage => ({
  id: nextID(),
  time: { created: 1 },
  type: "agent-switched",
  agent: "plan",
});

type AssistantContent = Extract<SessionMessage, { type: "assistant" }>["content"][number];

export const assistant = (...content: AssistantContent[]): SessionMessage => ({
  id: nextID(),
  time: { created: 1 },
  type: "assistant",
  agent: "build",
  model: { id: "model", providerID: "provider" },
  content,
});

export const text = (value: string): AssistantContent => ({ type: "text", text: value });

export const question = (status: "running" | "completed"): AssistantContent => ({
  type: "tool",
  id: `call_${nextID()}`,
  name: "question",
  state:
    status === "running"
      ? { status: "running", input: {}, metadata: {} }
      : { status: "completed", input: {}, content: [{ type: "text", text: "Yes" }] },
  time: { created: 1 },
});
