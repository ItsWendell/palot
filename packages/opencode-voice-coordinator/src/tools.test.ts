import { describe, expect, it, vi } from "vitest";
import { COORDINATOR_AGENT } from "./agent";
import { assistant, sessionInfo, user } from "./test-fixtures";
import { type CoordinatorContext, registerTools } from "./tools";

type Tool = {
  name: string;
  execute: (input: unknown, context: unknown) => Promise<{ content?: unknown }>;
};

function setup() {
  const calls: string[] = [];
  const ctx = {
    location: { project: { id: "prj_palot", directory: "/work/palot" } },
    permission: {
      assert: vi.fn(async () => void calls.push("assert")),
      list: vi.fn(async () => [] as unknown[]),
    },
    session: {
      create: vi.fn(async (input: { location: { directory: string } }) => {
        calls.push("create");
        return sessionInfo({ id: "ses_new", location: input.location });
      }),
      prompt: vi.fn(async () => {
        calls.push("prompt");
        return { id: "msg_1", delivery: "steer" };
      }),
      get: vi.fn(async ({ sessionID }: { sessionID: string }) => sessionInfo({ id: sessionID })),
      context: vi.fn(async () => [user("go"), assistant()]),
      wait: vi.fn(() => new Promise<void>(() => {})),
    },
    storage: { set: vi.fn(async () => void calls.push("record")) },
    event: { subscribe: vi.fn(async function* () {}) },
    worktree: { list: vi.fn(async () => []) },
  };
  const tools = new Map<string, Tool>();
  registerTools(
    ctx as unknown as CoordinatorContext,
    {
      add: (tool: Tool) => tools.set(tool.name, tool),
    } as unknown as Parameters<typeof registerTools>[1],
  );
  const run = (name: string, input: unknown, agent = COORDINATOR_AGENT) =>
    tools.get(name)!.execute(input, {
      sessionID: "ses_coordinator",
      agent,
      messageID: "msg_call",
      id: "call_1",
      signal: new AbortController().signal,
      progress: async () => {},
    });
  return { ctx, calls, run };
}

describe("voice tools", () => {
  it("asks permission before creating a session, then records and prompts it", async () => {
    const { ctx, calls, run } = setup();
    const result = await run("voice_create_session", {
      directory: "/work/palot/",
      prompt: "Fix the login bug",
    });

    expect(calls).toEqual(["assert", "create", "record", "prompt"]);
    expect(ctx.permission.assert).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionID: "ses_coordinator",
        action: "voice_create_session",
        resources: ["/work/palot"],
        source: { type: "tool", messageID: "msg_call", id: "call_1" },
      }),
    );
    expect(ctx.session.prompt).toHaveBeenCalledWith({
      sessionID: "ses_new",
      text: "Fix the login bug",
    });
    expect(JSON.parse(String(result.content))).toMatchObject({
      sessionID: "ses_new",
      directory: "/work/palot",
    });
  });

  it("creates nothing when the user rejects the permission", async () => {
    const { ctx, run } = setup();
    ctx.permission.assert.mockRejectedValueOnce(new Error("rejected"));
    await expect(
      run("voice_create_session", { directory: "/work/palot", prompt: "x" }),
    ).rejects.toThrow("rejected");
    expect(ctx.session.create).not.toHaveBeenCalled();
  });

  it("rejects relative directories before prompting for permission", async () => {
    const { ctx, run } = setup();
    await expect(run("voice_create_session", { directory: "palot", prompt: "x" })).rejects.toThrow(
      "absolute",
    );
    expect(ctx.permission.assert).not.toHaveBeenCalled();
  });

  it("refuses to message the coordinator's own session", async () => {
    const { ctx, run } = setup();
    await expect(
      run("voice_send_message", { sessionID: "ses_coordinator", text: "hi" }),
    ).rejects.toThrow("own session");
    expect(ctx.session.prompt).not.toHaveBeenCalled();
  });

  it("only runs for the voice coordinator agent", async () => {
    const { ctx, run } = setup();
    await expect(run("voice_read_session", { sessionID: "ses_task" }, "build")).rejects.toThrow(
      COORDINATOR_AGENT,
    );
    expect(ctx.session.get).not.toHaveBeenCalled();
  });

  it("returns at once when a listed session already needs approval", async () => {
    const { ctx, run } = setup();
    ctx.permission.list.mockImplementation(async (input?: unknown) =>
      (input as { sessionID: string }).sessionID === "ses_b" ? [{ id: "per_1" }] : [],
    );
    const result = await run("voice_wait_sessions", {
      sessionIDs: ["ses_a", "ses_b"],
      timeoutMs: 120_000,
    });

    const body = JSON.parse(String(result.content));
    expect(body).toMatchObject({ reason: "needs_input", sessionID: "ses_b" });
    expect(body.sessions.map((session: { status: string }) => session.status)).toEqual([
      "busy",
      "needs_input",
    ]);
    expect(ctx.session.wait).not.toHaveBeenCalled();
  });
});
