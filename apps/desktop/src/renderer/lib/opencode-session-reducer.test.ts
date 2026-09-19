import { describe, expect, it } from "vitest";
import type { PalotEvent, PalotMessage } from "../../shared";
import type { SessionExecutionState } from "../atoms/workspace";
import { mapMessage } from "../services/opencode-mappers";
import { mergeMessages } from "./message-reconcile";
import {
  applyExecutionEvents,
  applyShellEvents,
  applyOpenCodeEvents,
  applySessionStatusEvents,
  needsSessionReconcile,
  needsMissingMessageRecovery,
  sessionReconcileTargets,
  reconcileExecutionSnapshot,
  reconcileShellSnapshot,
  needsWorkspaceReconcile,
} from "./opencode-session-reducer";
import { projectToolExecution } from "./tool-executions";

describe("needsSessionReconcile", () => {
  it("uses provider dispatch time for each assistant attempt, including retries", () => {
    const first = applyOpenCodeEvents([], "session", [
      event(
        "session.step.started",
        { sessionID: "session", assistantMessageID: "message", started: 10 },
        20,
      ),
    ]);
    expect(first[0]?.createdAt).toBe(10);
    const retry = applyOpenCodeEvents(first, "session", [
      event(
        "session.step.started",
        { sessionID: "session", assistantMessageID: "message", started: 30 },
        40,
      ),
    ]);
    expect(retry[0]?.createdAt).toBe(30);
  });

  it("leaves nested form creation refresh to Query", () => {
    expect(
      needsSessionReconcile(
        [event("form.created", { form: { id: "form_1", sessionID: "session", fields: [] } })],
        "session",
      ),
    ).toBe(false);
  });

  it("reconciles after a question tool terminates without a reply event", () => {
    expect(
      needsSessionReconcile(
        [event("session.tool.success", { sessionID: "session", id: "question-call" })],
        "session",
      ),
    ).toBe(true);
  });
});

describe("needsWorkspaceReconcile", () => {
  it.each([
    "permission.asked",
    "permission.replied",
    "form.created",
    "form.replied",
    "form.cancelled",
  ] satisfies PalotEvent["type"][])("leaves %s to the request cache", (type) => {
    expect(needsWorkspaceReconcile([event(type, { sessionID: "background-session" })])).toBe(false);
  });

  it("refreshes workspace locations for worktree updates", () => {
    expect(needsWorkspaceReconcile([event("worktree.updated", { projectID: "project" })])).toBe(
      true,
    );
  });
});

describe("inbox reconciliation", () => {
  it.each([
    "session.inbox.enqueued",
    "session.inbox.cancelled",
    "session.inbox.delivered",
    "session.inbox.delivery.changed",
  ] satisfies PalotEvent["type"][])("leaves pending input refresh to Query for %s", (type) => {
    expect(sessionReconcileTargets([event(type, { sessionID: "session-1" })], "session-1")).toEqual(
      { messages: true, requests: false, diffs: false },
    );
  });
});

describe("sessionReconcileTargets", () => {
  it("leaves permission refresh to Query", () => {
    expect(
      sessionReconcileTargets([event("permission.asked", { sessionID: "session-1" })], "session-1"),
    ).toEqual({ messages: false, requests: false, diffs: false });
  });

  it("targets transcript recovery after a tool settles", () => {
    expect(
      sessionReconcileTargets(
        [event("session.tool.success", { sessionID: "session-1" })],
        "session-1",
      ),
    ).toEqual({ messages: true, requests: false, diffs: false });
  });

  it("refreshes diffs for staged reverts and messages after commit", () => {
    expect(
      sessionReconcileTargets(
        [event("session.revert.staged", { sessionID: "session-1", revert: { messageID: "m1" } })],
        "session-1",
      ),
    ).toEqual({ messages: false, requests: false, diffs: true });
    expect(
      sessionReconcileTargets(
        [event("session.revert.committed", { sessionID: "session-1", to: "m1" })],
        "session-1",
      ),
    ).toEqual({ messages: true, requests: false, diffs: true });
  });
});

describe("needsMissingMessageRecovery", () => {
  it("recovers immediately when a delta references an unknown assistant message", () => {
    expect(
      needsMissingMessageRecovery([], "session-1", [
        event("session.text.delta", { sessionID: "session-1", assistantMessageID: "missing" }),
      ]),
    ).toBe(true);
  });

  it("does not recover for the step event that creates the assistant message", () => {
    expect(
      needsMissingMessageRecovery([], "session-1", [
        event("session.step.started", { sessionID: "session-1", assistantMessageID: "new" }),
      ]),
    ).toBe(false);
  });

  it("does not recover when the same batch starts the assistant before its delta", () => {
    expect(
      needsMissingMessageRecovery([], "session-1", [
        event("session.step.started", {
          sessionID: "session-1",
          assistantMessageID: "new",
        }),
        event("session.text.delta", {
          sessionID: "session-1",
          assistantMessageID: "new",
          ordinal: 0,
          delta: "Hello",
        }),
      ]),
    ).toBe(false);
  });
});

function event(type: PalotEvent["type"], data: unknown, createdAt = 2): PalotEvent {
  return {
    id: `${type}-${createdAt}`,
    type,
    data,
    created: createdAt,
    createdAt,
    receiveSequence: createdAt,
  } as PalotEvent;
}

function assistant(id: string, text: string): PalotMessage {
  return {
    id,
    type: "assistant",
    createdAt: 1,
    completedAt: null,
    text: null,
    agent: "build",
    model: { id: "model", providerID: "provider" },
    tokens: null,
    finish: null,
    content: [{ type: "text", id: `${id}:text:0`, text }],
    data: null,
  };
}

describe("applyOpenCodeEvents", () => {
  it.each(["text", "reasoning"] as const)(
    "bounds the live %s annotation to a part lifecycle and retry",
    (type) => {
      const address = { sessionID: "session", assistantMessageID: "active", ordinal: 0 };
      const live = applyOpenCodeEvents([], "session", [
        event(`session.${type}.started`, address, 1),
        event(`session.${type}.delta`, { ...address, delta: "Old prefix" }, 2),
      ]);
      expect(live[0]?.content[0]).toMatchObject({ text: "Old prefix", streaming: true });
      const ended = applyOpenCodeEvents(live, "session", [
        event(`session.${type}.ended`, { ...address, text: "" }, 3),
      ]);
      expect(ended[0]?.content[0]).toMatchObject({ text: "", streaming: false });
      if (type === "text") expect(ended[0]?.text).toBe("");
      expect(
        applyOpenCodeEvents(ended, "session", [
          event(`session.${type}.delta`, { ...address, delta: "late" }, 4),
        ]),
      ).toBe(ended);
      const completed = [{ ...live[0]!, completedAt: 3 }];
      expect(
        applyOpenCodeEvents(completed, "session", [
          event(`session.${type}.delta`, { ...address, delta: "late" }, 4),
        ]),
      ).toBe(completed);

      const restarted = applyOpenCodeEvents(live, "session", [
        event(
          "session.step.started",
          {
            sessionID: "session",
            assistantMessageID: "active",
            agent: "build",
            model: { id: "model", providerID: "provider" },
          },
          4,
        ),
      ]);
      expect(restarted[0]?.content[0]?.streaming).toBe(false);
      expect(restarted[0]?.firstTokenAt).toBeUndefined();
      const reused = applyOpenCodeEvents(restarted, "session", [
        event(`session.${type}.started`, address, 5),
        event(`session.${type}.delta`, { ...address, delta: "New prefix" }, 6),
      ]);
      expect(reused[0]?.content).toHaveLength(1);
      expect(reused[0]?.content[0]).toMatchObject({
        text: "New prefix",
        streaming: true,
        time: { created: 5 },
      });
      expect(reused[0]?.firstTokenAt).toBe(6);
    },
  );

  it("projects durable timeline boundary events with stable message IDs", () => {
    const next = applyOpenCodeEvents([], "session", [
      {
        ...event(
          "session.synthetic",
          {
            sessionID: "session",
            text: "The server restarted while you were working.",
            description: "Continuing after restart",
          },
          10,
        ),
        id: "evt_restart",
      },
      {
        ...event(
          "session.agent.selected",
          {
            sessionID: "session",
            agent: "build",
            previous: "plan",
          },
          11,
        ),
        id: "evt_agent",
      },
      {
        ...event(
          "session.model.selected",
          {
            sessionID: "session",
            model: { id: "gpt-5", providerID: "openai", variant: "high" },
            previous: { id: "gpt-5", providerID: "openai", variant: "low" },
          },
          12,
        ),
        id: "evt_model",
      },
      {
        ...event(
          "session.skill.activated",
          {
            sessionID: "session",
            id: "diagnosing-bugs",
            name: "Diagnosing bugs",
            text: "Skill instructions",
          },
          13,
        ),
        id: "evt_skill",
      },
    ]);

    expect(next.map((message) => [message.id, message.type])).toEqual([
      ["msg_restart", "synthetic"],
      ["msg_agent", "agent-switched"],
      ["msg_model", "model-switched"],
      ["msg_skill", "skill"],
    ]);
  });

  it("projects live first-class shell messages and completion output", () => {
    const running = applyOpenCodeEvents([], "session", [
      {
        ...event(
          "session.shell.started",
          {
            sessionID: "session",
            shell: {
              id: "shell-1",
              status: "running",
              command: "bun test",
              cwd: "/repo",
              time: { started: 5 },
            },
          },
          10,
        ),
        id: "evt_shell",
      },
    ]);
    const completed = applyOpenCodeEvents(running, "session", [
      event(
        "session.shell.ended",
        {
          sessionID: "session",
          shell: {
            id: "shell-1",
            status: "exited",
            command: "bun test",
            exit: 0,
            time: { started: 5, completed: 18 },
          },
          output: { output: "passed", cursor: 6, size: 6, truncated: false },
        },
        20,
      ),
    ]);

    expect(completed[0]).toMatchObject({
      id: "msg_shell",
      type: "shell",
      createdAt: 5,
      completedAt: 18,
      data: {
        shellID: "shell-1",
        status: "exited",
        output: { output: "passed" },
      },
    });
  });

  it("projects retry scheduling and clears it on a terminal step", () => {
    const source = assistant("assistant", "");
    const retrying = applyOpenCodeEvents([source], "session", [
      event(
        "session.retry.scheduled",
        {
          sessionID: "session",
          assistantMessageID: "assistant",
          attempt: 2,
          at: 50,
          error: { type: "ProviderError", message: "Rate limited" },
        },
        20,
      ),
    ]);
    const failed = applyOpenCodeEvents(retrying, "session", [
      event(
        "session.step.failed",
        {
          sessionID: "session",
          assistantMessageID: "assistant",
          error: { type: "ProviderError", message: "Unavailable" },
        },
        30,
      ),
    ]);

    expect(retrying[0]?.data).toMatchObject({ retry: { attempt: 2, at: 50 } });
    expect(failed[0]).toMatchObject({
      completedAt: 30,
      finish: "error",
      data: { error: { type: "ProviderError", message: "Unavailable" }, retry: null },
    });
  });

  it("clears stale retry and error state when the next step starts", () => {
    const source = {
      ...assistant("assistant", ""),
      completedAt: 20,
      finish: "error" as const,
      data: {
        retry: { attempt: 2, at: 30, error: { type: "ProviderError", message: "Retry" } },
        error: { type: "ProviderError", message: "Failed" },
      },
    };

    const next = applyOpenCodeEvents([source], "session", [
      event(
        "session.step.started",
        {
          sessionID: "session",
          assistantMessageID: "assistant",
          agent: "build",
          model: { id: "model", providerID: "provider" },
        },
        40,
      ),
    ]);

    expect(next[0]).toMatchObject({
      completedAt: null,
      finish: null,
      data: { retry: null, error: null },
    });
  });

  it("creates an unseeded assistant message on the first streaming delta", () => {
    const next = applyOpenCodeEvents([], "session", [
      event("session.text.started", {
        sessionID: "session",
        assistantMessageID: "active",
        ordinal: 0,
      }),
      event("session.text.delta", {
        sessionID: "session",
        assistantMessageID: "active",
        ordinal: 0,
        delta: "First tokens",
      }),
    ]);
    expect(next).toHaveLength(1);
    expect(next[0]?.id).toBe("active");
    expect(next[0]?.type).toBe("assistant");
    expect(next[0]?.content[0]?.text).toBe("First tokens");
  });

  it("appends a literal delta only to the addressed message and preserves history", () => {
    const history = assistant("history", "Done");
    const active = assistant("active", "Hello");
    const next = applyOpenCodeEvents([history, active], "session", [
      event("session.text.delta", {
        sessionID: "session",
        assistantMessageID: "active",
        ordinal: 0,
        delta: " world",
      }),
    ]);
    expect(next[0]).toBe(history);
    expect(next[1]?.content[0]?.text).toBe("Hello world");
  });

  it("uses the terminal text snapshot without duplicating prior deltas", () => {
    const next = applyOpenCodeEvents([assistant("active", "Hello")], "session", [
      event("session.text.delta", {
        sessionID: "session",
        assistantMessageID: "active",
        ordinal: 0,
        delta: " world",
      }),
      event("session.text.ended", {
        sessionID: "session",
        assistantMessageID: "active",
        ordinal: 0,
        text: "Hello world",
      }),
    ]);
    expect(next[0]?.content[0]?.text).toBe("Hello world");
  });

  it("replaces shell progress snapshots and reconciles final output without duplication", () => {
    const next = applyOpenCodeEvents([assistant("active", "")], "session", [
      event("session.tool.called", {
        sessionID: "session",
        assistantMessageID: "active",
        id: "shell-1",
        name: "shell",
        input: { command: "bun run test" },
      }),
      event("session.tool.progress", {
        sessionID: "session",
        assistantMessageID: "active",
        id: "shell-1",
        metadata: { output: "first" },
      }),
      event("session.tool.progress", {
        sessionID: "session",
        assistantMessageID: "active",
        id: "shell-1",
        metadata: { output: "first\nsecond" },
      }),
      event("session.tool.success", {
        sessionID: "session",
        assistantMessageID: "active",
        id: "shell-1",
        content: [{ type: "text", text: "first\nsecond\ndone" }],
        metadata: { exit: 0 },
      }),
    ]);

    expect(next[0]?.content.find((part) => part.id === "shell-1")?.state).toMatchObject({
      status: "completed",
      content: [{ type: "text", text: "first\nsecond\ndone" }],
      metadata: { output: "first\nsecond", exit: 0 },
    });
  });

  it("retains bounded streamed shell output when the command fails", () => {
    const output = `start\n${"x".repeat(300_000)}`;
    const next = applyOpenCodeEvents([assistant("active", "")], "session", [
      event("session.tool.called", {
        sessionID: "session",
        assistantMessageID: "active",
        id: "shell-1",
        name: "shell",
        input: { command: "bun run test" },
      }),
      event("session.tool.progress", {
        sessionID: "session",
        assistantMessageID: "active",
        id: "shell-1",
        metadata: { output },
      }),
      event("session.tool.failed", {
        sessionID: "session",
        assistantMessageID: "active",
        id: "shell-1",
        error: "Command exited with code 1",
        metadata: { exit: 1 },
      }),
    ]);
    const state = next[0]?.content.find((part) => part.id === "shell-1")?.state as
      | Record<string, unknown>
      | undefined;
    const metadata = state?.metadata as Record<string, unknown> | undefined;

    expect(state).toMatchObject({
      status: "error",
      error: "Command exited with code 1",
      metadata: { exit: 1, truncated: true },
    });
    expect(metadata?.output).toEqual(expect.stringMatching(/^\[Earlier output truncated]/));
    const boundedOutput = metadata?.output;
    expect(typeof boundedOutput).toBe("string");
    expect((boundedOutput as string).length).toBeLessThan(257_000);
  });

  it("creates and completes an assistant step from lifecycle events", () => {
    const next = applyOpenCodeEvents([], "session", [
      event("session.step.started", {
        sessionID: "session",
        assistantMessageID: "active",
        agent: "build",
        model: { id: "model", providerID: "provider" },
      }),
      event(
        "session.text.delta",
        {
          sessionID: "session",
          assistantMessageID: "active",
          ordinal: 0,
          delta: "Do",
        },
        2,
      ),
      event(
        "session.text.delta",
        {
          sessionID: "session",
          assistantMessageID: "active",
          ordinal: 0,
          delta: "ne",
        },
        3,
      ),
      event(
        "session.text.ended",
        {
          sessionID: "session",
          assistantMessageID: "active",
          ordinal: 0,
          text: "Done",
        },
        4,
      ),
      event(
        "session.step.streamed",
        {
          sessionID: "session",
          assistantMessageID: "active",
        },
        4.5,
      ),
      event(
        "session.step.ended",
        {
          sessionID: "session",
          assistantMessageID: "active",
          finish: "stop",
          rawFinish: "end_turn",
          providerState: { signature: "provider-state" },
          tokens: {
            input: 10,
            output: 2,
            reasoning: 1,
            cache: { read: 3, write: 0 },
          },
        },
        5,
      ),
    ]);
    expect(next[0]).toMatchObject({
      id: "active",
      firstTokenAt: 2,
      streamedAt: 4.5,
      completedAt: 5,
      finish: "stop",
      rawFinish: "end_turn",
      providerState: { signature: "provider-state" },
    });
    expect(next[0]?.content[0]?.text).toBe("Done");
  });

  it("clears stale streamed timing when a step restarts and restores the new timing", () => {
    const current: PalotMessage = {
      ...assistant("active", "Old response"),
      streamedAt: 10,
      completedAt: 11,
      finish: "stop",
    };

    const restarted = applyOpenCodeEvents([current], "session", [
      event("session.step.started", {
        sessionID: "session",
        assistantMessageID: "active",
        agent: "build",
        model: { id: "model", providerID: "provider" },
      }),
    ]);
    expect(restarted[0]?.streamedAt).toBeUndefined();

    const streamed = applyOpenCodeEvents(restarted, "session", [
      event("session.step.streamed", { sessionID: "session", assistantMessageID: "active" }, 20),
    ]);
    expect(streamed[0]?.streamedAt).toBe(20);
  });

  it("records when assistant text starts and preserves changed files", () => {
    const next = applyOpenCodeEvents([], "session", [
      event("session.step.started", {
        sessionID: "session",
        assistantMessageID: "active",
        agent: "build",
        model: { id: "model", providerID: "provider" },
      }),
      event(
        "session.text.started",
        { sessionID: "session", assistantMessageID: "active", ordinal: 0 },
        12,
      ),
      event(
        "session.step.ended",
        {
          sessionID: "session",
          assistantMessageID: "active",
          finish: "stop",
          files: ["src/app.ts", "src/thread.tsx"],
        },
        20,
      ),
    ]);

    expect(next[0]?.content[0]?.time).toEqual({ created: 12 });
    expect(next[0]?.data).toMatchObject({ retry: null });
  });

  it("preserves explicit reasoning presentation metadata", () => {
    const next = applyOpenCodeEvents([assistant("active", "")], "session", [
      event(
        "session.reasoning.started",
        {
          sessionID: "session",
          assistantMessageID: "active",
          ordinal: 0,
          state: { presentation: "preamble" },
        },
        12,
      ),
      event(
        "session.reasoning.ended",
        {
          sessionID: "session",
          assistantMessageID: "active",
          ordinal: 0,
          text: "I am checking the repository.",
          state: { presentation: "preamble" },
        },
        16,
      ),
    ]);

    expect(next[0]?.content.find((part) => part.type === "reasoning")).toMatchObject({
      presentation: "preamble",
      text: "I am checking the repository.",
    });
  });

  it("streams compaction text and retains the completed summary", () => {
    const next = applyOpenCodeEvents([], "session", [
      event("session.compaction.started", {
        sessionID: "session",
        inputID: "input-1",
        reason: "auto",
        recent: "Recent context",
      }),
      event("session.compaction.delta", { sessionID: "session", text: "Partial" }, 3),
      event(
        "session.compaction.ended",
        {
          sessionID: "session",
          reason: "auto",
          model: { id: "claude-sonnet-4", providerID: "anthropic" },
          providerState: { checkpoint: "state-1" },
          text: "Full compacted summary",
          recent: "Recent context",
        },
        4,
      ),
    ]);

    expect(next).toEqual([
      expect.objectContaining({
        id: "input-1",
        type: "compaction",
        completedAt: 4,
        model: { id: "claude-sonnet-4", providerID: "anthropic" },
        providerState: { checkpoint: "state-1" },
        content: [
          expect.objectContaining({
            type: "compaction",
            status: "completed",
            reason: "auto",
            text: "Full compacted summary",
            recent: "Recent context",
          }),
        ],
      }),
    ]);
  });

  it("preserves hydrated compaction identity when completion arrives after the snapshot", () => {
    const started = applyOpenCodeEvents([], "session", [
      event("session.compaction.started", {
        sessionID: "session",
        inputID: "msg_compaction",
        reason: "manual",
        recent: "",
      }),
    ]);
    const completed = mapMessage({
      id: "msg_compaction",
      type: "compaction",
      time: { created: 3 },
      status: "completed",
      reason: "manual",
      summary: "Canonical summary",
      recent: "",
    });
    const hydrated = mergeMessages([completed], started, false);
    const ended = event(
      "session.compaction.ended",
      { sessionID: "session", reason: "manual", text: "Canonical summary", recent: "" },
      4,
    );

    expect(applyOpenCodeEvents(hydrated, "session", [ended])).toEqual([completed]);
    expect(sessionReconcileTargets([ended], "session").messages).toBe(true);
  });

  it.each(["session.compaction.ended", "session.compaction.failed"] as const)(
    "preserves %s request usage through live completion, duplicate delivery, and hydration",
    (type) => {
      const usage = { input: 1200, output: 100, reasoning: 20, cache: { read: 800, write: 40 } };
      const completion = event(
        type,
        {
          sessionID: "session",
          reason: "manual",
          text: "Summary",
          recent: "",
          error: { type: "error", message: "Failed" },
          cost: 0.012345,
          tokens: usage,
        },
        4,
      );
      const live = applyOpenCodeEvents([], "session", [
        event("session.compaction.started", {
          sessionID: "session",
          inputID: "compaction-usage",
          reason: "manual",
        }),
        completion,
      ]);
      expect(live).toHaveLength(1);
      expect(live[0]?.tokens).toBeNull();
      expect(live[0]?.content[0]).toMatchObject({ cost: 0.012345, tokens: usage });
      expect(applyOpenCodeEvents(live, "session", [completion])).toEqual(live);

      const hydrated = mapMessage({
        id: "compaction-usage",
        type: "compaction",
        status: type === "session.compaction.ended" ? "completed" : "failed",
        reason: "manual",
        time: { created: 4 },
        summary: "Summary",
        recent: "",
        error: { type: "error", message: "Failed" },
        cost: 0.012345,
        tokens: usage,
      });
      const merged = mergeMessages([hydrated], live, false);
      expect(merged).toEqual([hydrated]);
      expect(merged[0]?.tokens).toBeNull();
      expect(merged[0]?.content[0]).toMatchObject({ cost: 0.012345, tokens: usage });
    },
  );

  it.each(["session.compaction.ended", "session.compaction.failed"] as const)(
    "hydrates %s without inventing an identity or modifying an earlier compaction",
    (type) => {
      const previous = mapMessage({
        id: "msg_previous_compaction",
        type: "compaction",
        time: { created: 1 },
        status: "completed",
        reason: "manual",
        summary: "Previous summary",
        recent: "",
      });
      const completion = event(
        type,
        { sessionID: "session", reason: "auto", text: "New summary", recent: "" },
        4,
      );

      expect(applyOpenCodeEvents([], "session", [completion])).toEqual([]);
      expect(applyOpenCodeEvents([previous], "session", [completion])).toEqual([previous]);
      expect(sessionReconcileTargets([completion], "session").messages).toBe(true);
    },
  );

  it("preserves cross-type stream order when text and reasoning reuse ordinals", () => {
    const next = applyOpenCodeEvents([], "session", [
      event("session.step.started", {
        sessionID: "session",
        assistantMessageID: "active",
        agent: "build",
        model: { id: "model", providerID: "provider" },
      }),
      event("session.reasoning.started", {
        sessionID: "session",
        assistantMessageID: "active",
        ordinal: 0,
      }),
      event("session.reasoning.ended", {
        sessionID: "session",
        assistantMessageID: "active",
        ordinal: 0,
        text: "First thought.",
      }),
      event("session.tool.called", {
        sessionID: "session",
        assistantMessageID: "active",
        id: "read-1",
        name: "read",
        input: { file: "package.json" },
      }),
      event("session.reasoning.started", {
        sessionID: "session",
        assistantMessageID: "active",
        ordinal: 1,
      }),
      event("session.reasoning.ended", {
        sessionID: "session",
        assistantMessageID: "active",
        ordinal: 1,
        text: "Second thought.",
      }),
      event("session.text.started", {
        sessionID: "session",
        assistantMessageID: "active",
        ordinal: 0,
      }),
      event("session.text.ended", {
        sessionID: "session",
        assistantMessageID: "active",
        ordinal: 0,
        text: "Final answer.",
      }),
    ]);

    expect(next[0]?.content.map((part) => [part.type, part.id, part.text])).toEqual([
      ["reasoning", "active:reasoning:0", "First thought."],
      ["tool", "read-1", undefined],
      ["reasoning", "active:reasoning:1", "Second thought."],
      ["text", "active:text:0", "Final answer."],
    ]);
  });

  it("preserves provider execution state on live tool events", () => {
    const next = applyOpenCodeEvents([assistant("active", "")], "session", [
      event(
        "session.tool.called",
        {
          sessionID: "session",
          assistantMessageID: "active",
          id: "search-1",
          name: "grep",
          input: { pattern: "ToolRow" },
          executed: true,
          state: { provider: "call" },
        },
        1_000,
      ),
      event(
        "session.tool.success",
        {
          sessionID: "session",
          assistantMessageID: "active",
          id: "search-1",
          content: [{ type: "text", text: "Found 0 matches" }],
          metadata: { matches: 0 },
          executed: true,
          resultState: { provider: "result" },
        },
        2_250,
      ),
    ]);

    expect(next[0]?.content.find((part) => part.type === "tool")).toMatchObject({
      executed: true,
      providerState: { provider: "call" },
      providerResultState: { provider: "result" },
      time: { created: 1_000, ran: 1_000, completed: 2_250 },
    });
  });

  it("projects patch file targets while JSON input is streaming", () => {
    const input = JSON.stringify({
      patchText: "*** Begin Patch\n*** Update File: src/a.ts\n*** Add File: src/b.ts\n",
    });
    const next = applyOpenCodeEvents([assistant("active", "")], "session", [
      event("session.tool.input.started", {
        sessionID: "session",
        assistantMessageID: "active",
        id: "patch-1",
        name: "patch",
      }),
      event("session.tool.input.delta", {
        sessionID: "session",
        assistantMessageID: "active",
        id: "patch-1",
        delta: input.slice(0, 45),
      }),
      event("session.tool.input.delta", {
        sessionID: "session",
        assistantMessageID: "active",
        id: "patch-1",
        delta: input.slice(45),
      }),
    ]);

    expect(next[0]?.content.find((part) => part.type === "tool")?.state).toMatchObject({
      status: "streaming",
      input: {
        patchText: "*** Begin Patch\n*** Update File: src/a.ts\n*** Add File: src/b.ts\n",
      },
    });
    const part = next[0]!.content.find((part) => part.type === "tool")!;
    expect(projectToolExecution(part, 0)).toMatchObject({
      targetFiles: ["src/a.ts", "src/b.ts"],
      inputStreaming: true,
      patchDocument: {
        text: "*** Begin Patch\n*** Update File: src/a.ts\n*** Add File: src/b.ts\n",
      },
    });
  });

  it.each([true, false])(
    "keeps the patch visible through input.ended and tool.called (final payload: %s)",
    (finalPayload) => {
      const data = { sessionID: "session", assistantMessageID: "active", id: "patch-1" };
      const patchText = [
        "*** Begin Patch",
        "*** Update File: src/a.ts",
        "*** Move to: src/b.ts",
        ...Array.from({ length: 180 }, (_, index) => `+line ${index}`),
        "*** End Patch",
      ].join("\n");
      const input = { patchText };
      const json = JSON.stringify(input);
      const streaming = applyOpenCodeEvents([assistant("active", "")], "session", [
        event("session.tool.input.started", { ...data, name: "apply_patch" }),
        event("session.tool.input.delta", { ...data, delta: json.slice(0, 150) }),
      ]);
      const snapshot = JSON.stringify(streaming);
      const finished = applyOpenCodeEvents(streaming, "session", [
        event("session.tool.input.delta", { ...data, delta: json.slice(150) }),
      ]);
      const ended = applyOpenCodeEvents(finished, "session", [
        event("session.tool.input.ended", { ...data, ...(finalPayload ? { text: json } : {}) }),
      ]);
      const called = applyOpenCodeEvents(ended, "session", [
        event("session.tool.called", {
          ...data,
          name: "apply_patch",
          ...(finalPayload ? { input } : {}),
        }),
      ]);
      for (const messages of [finished, ended, called]) {
        const part = messages[0]!.content.find((part) => part.type === "tool")!;
        const view = projectToolExecution(part, 0);
        expect(view).toMatchObject({
          kind: "file-change",
          patchDocument: { text: patchText, tail: "*** End Patch" },
          targetFiles: ["src/a.ts", "src/b.ts"],
          inputStreaming: messages === finished,
          rawInput: input,
          files: [],
        });
      }
      expect(JSON.stringify(streaming)).toBe(snapshot);

      const success = applyOpenCodeEvents(called, "session", [
        event("session.tool.success", {
          ...data,
          metadata: {
            files: [
              { file: "src/b.ts", before: "old\n", after: "new\n", additions: 1, deletions: 1 },
            ],
          },
        }),
      ]);
      expect(
        projectToolExecution(
          success[0]!.content.find((part) => part.type === "tool")!,
          0,
        ),
      ).toMatchObject({
        status: "complete",
        patchDocument: { text: patchText },
        files: [{ file: "src/b.ts", before: "old\n", after: "new\n", additions: 1, deletions: 1 }],
      });
    },
  );

  it("retains streamed patch input when a called event has no patch arguments", () => {
    const data = { sessionID: "session", assistantMessageID: "active", id: "patch-1" };
    const patchText = "*** Begin Patch\n*** Add File: a.ts\n+new\n*** End Patch";
    const next = applyOpenCodeEvents([], "session", [
      event("session.tool.input.started", { ...data, name: "patch" }),
      event("session.tool.input.delta", { ...data, delta: JSON.stringify({ patchText }) }),
      event("session.tool.called", { ...data, name: "patch", input: {} }),
    ]);
    expect(projectToolExecution(next[0]!.content[0]!, 0)).toMatchObject({
      kind: "file-change",
      patchDocument: { text: patchText },
      inputStreaming: false,
    });
  });

  it("tracks enqueued input and delivers it into the active run", () => {
    const next = applyOpenCodeEvents([], "session", [
      event("session.inbox.enqueued", {
        sessionID: "session",
        inboxID: "user-1",
        item: {
          type: "user",
          delivery: "steer",
          payload: {
            text: "External prompt",
            files: [
              {
                data: "",
                mime: "text/plain",
                name: "example.ts",
                source: { type: "uri", uri: "file:///tmp/example.ts" },
              },
            ],
          },
        },
      }),
      event("session.inbox.delivered", { sessionID: "session", inboxID: "user-1" }, 3),
      event("session.execution.started", { sessionID: "session" }, 4),
    ]);

    expect(next[0]).toMatchObject({
      id: "user-1",
      type: "user",
      optimistic: true,
      text: "External prompt",
      delivery: "steer",
      promotedAt: 3,
      runStartedAt: 4,
      files: [{ name: "example.ts", uri: "file:///tmp/example.ts" }],
    });
  });

  it("keeps a locally submitted inbox item optimistic until transcript history contains it", () => {
    const optimistic: PalotMessage = {
      id: "user-1",
      type: "user",
      optimistic: true,
      createdAt: 1,
      completedAt: 1,
      text: "Continue now",
      agent: null,
      model: null,
      tokens: null,
      finish: null,
      content: [],
      data: null,
      delivery: "steer",
      runStartedAt: 1,
    };

    const next = applyOpenCodeEvents([optimistic], "session", [
      event("session.inbox.enqueued", {
        sessionID: "session",
        inboxID: "user-1",
        item: { type: "user", delivery: "steer", payload: { text: "Continue now" } },
      }),
    ]);

    expect(next[0]).toMatchObject({
      id: "user-1",
      optimistic: true,
      delivery: "steer",
      runStartedAt: 1,
    });
  });

  it("attaches a promoted steer to the running work block and settles all its inputs", () => {
    const first: PalotMessage = {
      id: "first",
      type: "user",
      createdAt: 1,
      completedAt: 1,
      text: "Start",
      agent: null,
      model: null,
      tokens: null,
      finish: null,
      content: [],
      data: null,
      delivery: "steer",
      promotedAt: 1,
      runStartedAt: 2,
    };
    const next = applyOpenCodeEvents([first], "session", [
      event("session.inbox.enqueued", {
        sessionID: "session",
        inboxID: "steer",
        item: { type: "user", delivery: "steer", payload: { text: "Change direction" } },
      }),
      event("session.inbox.delivered", { sessionID: "session", inboxID: "steer" }, 3),
      event("session.execution.succeeded", { sessionID: "session" }, 10),
    ]);

    expect(next).toMatchObject([
      { id: "first", runStartedAt: 2, runCompletedAt: 10 },
      { id: "steer", delivery: "steer", promotedAt: 3, runStartedAt: 2, runCompletedAt: 10 },
    ]);
  });

  it("moves pending input in and out of the active run when delivery changes", () => {
    const first: PalotMessage = {
      id: "first",
      type: "user",
      createdAt: 1,
      completedAt: 1,
      text: "Start",
      agent: null,
      model: null,
      tokens: null,
      finish: null,
      content: [],
      data: null,
      delivery: "steer",
      runStartedAt: 2,
    };
    const pending: PalotMessage = {
      ...first,
      id: "pending",
      createdAt: 3,
      completedAt: 3,
      text: "Change direction",
      runStartedAt: 2,
    };

    const queued = applyOpenCodeEvents([first, pending], "session", [
      event(
        "session.inbox.delivery.changed",
        { sessionID: "session", inboxID: "pending", delivery: "queue" },
        4,
      ),
    ]);
    expect(queued[1]).toMatchObject({ id: "pending", delivery: "queue" });
    expect(queued[1]?.runStartedAt).toBeUndefined();

    const steered = applyOpenCodeEvents(queued, "session", [
      event(
        "session.inbox.delivery.changed",
        { sessionID: "session", inboxID: "pending", delivery: "steer" },
        5,
      ),
    ]);
    expect(steered[1]).toMatchObject({ id: "pending", delivery: "steer", runStartedAt: 2 });
  });

  it("records reasoning part timing independently from the assistant message", () => {
    const next = applyOpenCodeEvents([assistant("active", "")], "session", [
      event(
        "session.reasoning.started",
        { sessionID: "session", assistantMessageID: "active", ordinal: 0 },
        4,
      ),
      event(
        "session.reasoning.delta",
        { sessionID: "session", assistantMessageID: "active", ordinal: 0, delta: "Inspecting" },
        5,
      ),
      event(
        "session.reasoning.ended",
        {
          sessionID: "session",
          assistantMessageID: "active",
          ordinal: 0,
          text: "Inspecting",
        },
        9,
      ),
    ]);

    expect(next[0]?.content.find((part) => part.type === "reasoning")).toMatchObject({
      type: "reasoning",
      text: "Inspecting",
      time: { created: 4, completed: 9 },
    });
  });

  it("projects enqueued workspace and skill references separately from attachments", () => {
    const next = applyOpenCodeEvents([], "session", [
      event("session.inbox.enqueued", {
        sessionID: "session",
        inboxID: "user-2",
        item: {
          type: "user",
          delivery: "steer",
          payload: {
            text: "Review @src/auth.ts with $code-review",
            files: [
              {
                data: "",
                mime: "text/plain",
                name: "auth.ts",
                source: { type: "uri", uri: "file:///repo/src/auth.ts" },
                mention: { start: 7, end: 19, text: "@src/auth.ts" },
              },
            ],
            skills: [
              {
                id: "code-review",
                name: "Code review",
                text: "Skill body",
                mention: { start: 25, end: 37, text: "$code-review" },
              },
            ],
          },
        },
      }),
    ]);

    expect(next[0]).toMatchObject({
      files: undefined,
      fileReferences: [
        {
          uri: "file:///repo/src/auth.ts",
          name: "auth.ts",
          mention: { start: 7, end: 19, text: "@src/auth.ts" },
        },
      ],
      skillReferences: [
        {
          id: "code-review",
          mention: { start: 25, end: 37, text: "$code-review" },
        },
      ],
    });
  });
});

describe("applySessionStatusEvents", () => {
  it("preserves identity for an equivalent status event", () => {
    const current = new Map([["session", { type: "busy" } as const]]);
    const next = applySessionStatusEvents(current, [
      event("session.status", { sessionID: "session", status: { type: "busy" } }),
    ]);

    expect(next).toBe(current);
    expect(next.get("session")).toBe(current.get("session"));
  });

  it("tracks retry, busy, and idle states independently from execution state", () => {
    const retrying = applySessionStatusEvents(new Map(), [
      event("session.status", {
        sessionID: "session",
        status: { type: "retry", attempt: 2, message: "Rate limited", next: 100 },
      }),
    ]);
    const busy = applySessionStatusEvents(retrying, [
      event("session.status", { sessionID: "session", status: { type: "busy" } }),
    ]);
    const idle = applySessionStatusEvents(busy, [
      event("session.execution.succeeded", { sessionID: "session" }),
    ]);

    expect(retrying.get("session")).toEqual({
      type: "retry",
      attempt: 2,
      message: "Rate limited",
      next: 100,
    });
    expect(busy.get("session")).toEqual({ type: "busy" });
    expect(idle.get("session")).toEqual({ type: "idle" });
  });

  it("clears retry status as soon as the next step starts", () => {
    const retrying = new Map([
      ["session", { type: "retry", attempt: 2, message: "Rate limited", next: 100 } as const],
    ]);

    const next = applySessionStatusEvents(retrying, [
      event("session.step.started", { sessionID: "session", assistantMessageID: "assistant" }),
    ]);

    expect(next.get("session")).toEqual({ type: "busy" });
  });
});

describe("execution errors", () => {
  it("retains structured execution failure details for fallback projection", () => {
    const next = applyExecutionEvents(new Map(), [
      event("session.execution.started", { sessionID: "session" }, 10),
      event(
        "session.execution.failed",
        {
          sessionID: "session",
          error: { name: "ProviderError", data: { message: "Unavailable" } },
        },
        20,
      ),
    ]);

    expect(next.get("session")).toMatchObject({
      status: "failed",
      error: { type: "ProviderError", message: "Unavailable" },
    });
  });
});

describe("applyExecutionEvents", () => {
  it("preserves identity for an equivalent execution event", () => {
    const current = new Map<string, SessionExecutionState>([
      ["session", { status: "running", startedAt: 10, completedAt: null }],
    ]);
    const next = applyExecutionEvents(current, [
      event("session.execution.started", { sessionID: "session" }, 10),
    ]);

    expect(next).toBe(current);
    expect(next.get("session")).toBe(current.get("session"));
  });

  it("keeps execution running across completed model steps", () => {
    const running = applyExecutionEvents(new Map(), [
      event("session.execution.started", { sessionID: "session" }, 10),
    ]);
    const afterStep = applyExecutionEvents(running, [
      event("session.step.ended", { sessionID: "session", assistantMessageID: "assistant" }, 20),
    ]);
    const succeeded = applyExecutionEvents(afterStep, [
      event("session.execution.succeeded", { sessionID: "session" }, 30),
    ]);

    expect(afterStep.get("session")?.status).toBe("running");
    expect(succeeded.get("session")).toEqual({
      status: "succeeded",
      startedAt: 10,
      completedAt: 30,
    });
  });

  it("keeps a settled parent working while a foreground child session runs", () => {
    const childRunning = applyExecutionEvents(new Map(), [
      event("session.execution.started", { sessionID: "parent" }, 10),
      event("session.created", { sessionID: "child", parentID: "parent" }, 20),
      event("session.execution.started", { sessionID: "child" }, 30),
      event("session.execution.succeeded", { sessionID: "parent" }, 40),
    ]);
    const childSettled = applyExecutionEvents(childRunning, [
      event("session.execution.succeeded", { sessionID: "child" }, 50),
    ]);

    expect(childRunning.get("parent")?.status).toBe("running");
    expect(childSettled.get("parent")).toEqual({
      status: "succeeded",
      startedAt: 10,
      completedAt: 40,
    });
  });

  it("defers a background parent's terminal state until all child sessions settle", () => {
    const parentSettled = applyExecutionEvents(new Map(), [
      event("session.execution.started", { sessionID: "parent" }, 10),
      event("session.created", { sessionID: "child-1", parentID: "parent" }, 20),
      event("session.created", { sessionID: "child-2", parentID: "parent" }, 30),
      event("session.execution.succeeded", { sessionID: "parent" }, 40),
    ]);
    const running = applyExecutionEvents(parentSettled, [
      event("session.execution.started", { sessionID: "child-1" }, 50),
      event("session.execution.started", { sessionID: "child-2" }, 60),
    ]);
    const oneChildSettled = applyExecutionEvents(running, [
      event("session.execution.succeeded", { sessionID: "child-1" }, 70),
    ]);
    const allChildrenSettled = applyExecutionEvents(oneChildSettled, [
      event("session.execution.succeeded", { sessionID: "child-2" }, 80),
    ]);

    expect(running.get("parent")?.status).toBe("running");
    expect(oneChildSettled.get("parent")?.status).toBe("running");
    expect(allChildrenSettled.get("parent")).toEqual({
      status: "succeeded",
      startedAt: 10,
      completedAt: 40,
    });
  });

  it("preserves a child failure on the parent after delegated work settles", () => {
    const running = applyExecutionEvents(new Map(), [
      event("session.execution.started", { sessionID: "parent" }, 10),
      event("session.created", { sessionID: "child", parentID: "parent" }, 20),
      event("session.execution.started", { sessionID: "child" }, 30),
      event("session.execution.succeeded", { sessionID: "parent" }, 40),
    ]);
    const failed = applyExecutionEvents(running, [
      event("session.execution.failed", { sessionID: "child" }, 50),
    ]);

    expect(failed.get("parent")).toMatchObject({
      status: "failed",
      startedAt: 10,
      completedAt: 50,
      settled: { status: "succeeded", completedAt: 40 },
    });
  });

  it("preserves a child interruption on the parent after delegated work settles", () => {
    const running = applyExecutionEvents(new Map(), [
      event("session.execution.started", { sessionID: "parent" }, 10),
      event("session.created", { sessionID: "child", parentID: "parent" }, 20),
      event("session.execution.started", { sessionID: "child" }, 30),
      event("session.execution.succeeded", { sessionID: "parent" }, 40),
    ]);
    const interrupted = applyExecutionEvents(running, [
      event("session.execution.interrupted", { sessionID: "child" }, 50),
    ]);

    expect(interrupted.get("parent")).toMatchObject({
      status: "interrupted",
      completedAt: 50,
      settled: { status: "succeeded", completedAt: 40 },
    });
  });

  it("does not carry a historical child failure into a later parent execution", () => {
    const first = applyExecutionEvents(new Map(), [
      event("session.execution.started", { sessionID: "parent" }, 10),
      event("session.created", { sessionID: "child", parentID: "parent" }, 20),
      event("session.execution.started", { sessionID: "child" }, 30),
      event("session.execution.succeeded", { sessionID: "parent" }, 40),
      event("session.execution.failed", { sessionID: "child" }, 50),
    ]);
    const second = applyExecutionEvents(first, [
      event("session.execution.started", { sessionID: "parent" }, 60),
      event("session.execution.succeeded", { sessionID: "parent" }, 70),
    ]);

    expect(second.get("parent")).toEqual({
      status: "succeeded",
      startedAt: 60,
      completedAt: 70,
    });
  });

  it("ignores a historical child failure without a recorded start time", () => {
    const states = new Map([
      ["parent", { status: "running" as const, startedAt: 60, completedAt: null }],
      [
        "child",
        {
          status: "failed" as const,
          startedAt: null,
          completedAt: 50,
          parentID: "parent",
        },
      ],
    ]);

    const next = applyExecutionEvents(states, [
      event("session.execution.succeeded", { sessionID: "parent" }, 70),
    ]);

    expect(next.get("parent")).toEqual({
      status: "succeeded",
      startedAt: 60,
      completedAt: 70,
    });
  });

  it("settles the parent when reconciliation finds no active child sessions", () => {
    const running = applyExecutionEvents(new Map(), [
      event("session.execution.started", { sessionID: "parent" }, 10),
      event("session.created", { sessionID: "child", parentID: "parent" }, 20),
      event("session.execution.started", { sessionID: "child" }, 30),
      event("session.execution.succeeded", { sessionID: "parent" }, 40),
    ]);

    const reconciled = reconcileExecutionSnapshot(running, [], ["parent"]);

    expect(reconciled.get("child")).toMatchObject({ status: "inactive", parentID: "parent" });
    expect(reconciled.get("parent")).toEqual({
      status: "succeeded",
      startedAt: 10,
      completedAt: 40,
    });
  });

  it("restores parent working state from hydrated child relationships", () => {
    const next = reconcileExecutionSnapshot(
      new Map(),
      ["child"],
      [
        { id: "parent", parentID: null },
        { id: "child", parentID: "parent" },
      ],
    );

    expect(next.get("child")).toMatchObject({ status: "running", parentID: "parent" });
    expect(next.get("parent")?.status).toBe("running");
  });

  it("reconciles missed execution events with the upstream active-session snapshot", () => {
    const running = { status: "running", startedAt: 10, completedAt: null } as const;
    const succeeded = { status: "succeeded", startedAt: 1, completedAt: 5 } as const;
    const current = new Map<string, SessionExecutionState>([
      ["still-running", running],
      ["missed-terminal", running],
      ["completed", succeeded],
      ["restarted", succeeded],
    ]);

    const next = reconcileExecutionSnapshot(
      current,
      ["still-running", "restarted", "new"],
      ["still-running", "missed-terminal", "completed", "restarted", "inactive"],
    );

    expect(next.get("still-running")).toBe(running);
    expect(next.get("missed-terminal")).toEqual({
      status: "inactive",
      startedAt: null,
      completedAt: null,
    });
    expect(next.get("completed")).toBe(succeeded);
    expect(next.get("restarted")).toEqual({
      status: "running",
      startedAt: null,
      completedAt: null,
    });
    expect(next.get("new")).toEqual({
      status: "running",
      startedAt: null,
      completedAt: null,
    });
    expect(next.get("inactive")).toEqual({
      status: "inactive",
      startedAt: null,
      completedAt: null,
    });
  });

  it("does not overwrite execution events received during snapshot hydration", () => {
    const interrupted = { status: "interrupted", startedAt: 10, completedAt: 20 } as const;
    const running = { status: "running", startedAt: 30, completedAt: null } as const;
    const current = new Map<string, SessionExecutionState>([
      ["terminal-event", interrupted],
      ["started-event", running],
    ]);

    const next = reconcileExecutionSnapshot(
      current,
      ["terminal-event"],
      ["terminal-event", "started-event"],
      new Set(["terminal-event", "started-event"]),
    );

    expect(next.get("terminal-event")).toBe(interrupted);
    expect(next.get("started-event")).toBe(running);
  });
});

describe("shell state", () => {
  it("tracks current shell lifecycle events", () => {
    const running = applyShellEvents(new Map(), [
      event("session.shell.started", {
        sessionID: "session",
        shell: { id: "shell-1", status: "running" },
      }),
    ]);
    const settled = applyShellEvents(running, [
      event("session.shell.ended", {
        sessionID: "session",
        shell: { id: "shell-1", status: "exited" },
      }),
    ]);

    expect(running.get("session")).toEqual(new Set(["shell-1"]));
    expect(settled.get("session")).toBeUndefined();
  });

  it("restores running shells from hydrated session messages", () => {
    const shell = (id: string, shellID: string, status: string): PalotMessage => ({
      ...assistant(id, ""),
      type: "shell",
      data: { shellID, status },
    });
    const runningShell = shell("running-shell", "shell-1", "running");
    const completedShell = shell("completed-shell", "shell-2", "exited");

    const next = reconcileShellSnapshot(
      new Map([["session", new Set(["stale-shell"])]]),
      "session",
      [runningShell, completedShell],
    );

    expect(next.get("session")).toEqual(new Set(["shell-1"]));
  });
});
