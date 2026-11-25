import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider, createStore } from "jotai";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PalotMessage, PalotMessageContent } from "../../shared";
import type { SessionRuntimeStatus } from "../atoms/workspace";
import { projectTranscriptTurns, type TranscriptTurn } from "../lib/turn-projection";
import type { PendingRequestView } from "../lib/view-models";
import { ActiveTurnMeta } from "./thread";
import { ActivityGroup, TurnActivity } from "./transcript/activity-group";
import { LiveTurnContext, type LiveTurnInputs } from "./transcript/live-turn-context";

const NOW = Date.parse("2026-08-12T12:00:00.000Z");

function message(input: Partial<PalotMessage> & Pick<PalotMessage, "id" | "type">): PalotMessage {
  return {
    createdAt: NOW - 42_000,
    completedAt: 2,
    text: null,
    agent: input.type === "assistant" ? "build" : null,
    model: null,
    tokens: null,
    finish: null,
    content: [],
    data: null,
    ...input,
  };
}

const prompt = message({ id: "prompt", type: "user", text: "Fix the bug", completedAt: NOW });

/** The running turn after `content` streamed in one open step. */
function working(content: PalotMessageContent[], extra: PalotMessage[] = []): TranscriptTurn {
  return projectTranscriptTurns(
    [
      prompt,
      ...extra,
      message({
        id: "step",
        type: "assistant",
        createdAt: NOW - 30_000,
        completedAt: null,
        content,
      }),
    ],
    { status: "running", startedAt: NOW - 42_000, completedAt: null },
  ).at(-1)!;
}

function shell(id: string, command: string, ranAt = NOW): PalotMessageContent {
  return {
    type: "tool",
    id,
    name: "shell",
    time: { created: ranAt, ran: ranAt },
    state: { status: "running", input: { command } },
  };
}

function read(id: string, path: string): PalotMessageContent {
  return { type: "tool", id, name: "read", state: { status: "running", input: { path } } };
}

function request(
  type: PendingRequestView["type"],
  id: string,
  title: string,
  detail?: string,
): PendingRequestView {
  return {
    id,
    type,
    title,
    resources: [],
    savePatterns: [],
    questions: [],
    fields: [],
    ...(detail ? { detail } : {}),
  };
}

function live(overrides: Partial<LiveTurnInputs> = {}): LiveTurnInputs {
  return {
    requests: [],
    runtimeStatus: null as SessionRuntimeStatus | null,
    stopping: false,
    label: null,
    focusRequest: vi.fn(),
    moveToBackground: vi.fn(),
    ...overrides,
  };
}

function renderLine(turn: TranscriptTurn, inputs: LiveTurnInputs = live(), extra?: ReactNode) {
  return render(
    <Provider store={createStore()}>
      <LiveTurnContext.Provider value={inputs}>
        {extra}
        <ActiveTurnMeta turn={turn} />
      </LiveTurnContext.Provider>
    </Provider>,
  );
}

/** The visible words, without the screen-reader announcement. */
function line() {
  return document.querySelector("[data-palot-active-turn-status] > :not([role=status])")!;
}

describe("the live line", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("leaves the clock to the turn bar, so a running turn has one ticking clock", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const turn = working([read("read", "src/app.ts")]);

    render(
      <Provider store={createStore()}>
        <LiveTurnContext.Provider value={live()}>
          <TurnActivity turn={turn} sessionID="session" />
          <ActiveTurnMeta turn={turn} />
        </LiveTurnContext.Provider>
      </Provider>,
    );

    expect(screen.getByRole("button", { name: "Working for 42s" })).toBeTruthy();
    expect(line().textContent).not.toMatch(/\d+s/);
    expect(document.body.textContent?.match(/42s/g)).toHaveLength(1);
  });

  it("shows the elapsed time while the turn has no work to show a bar for", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    renderLine(working([{ type: "text", text: "The bug" }]));

    expect(line().textContent).toBe("Working·42s");
    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(line().textContent).toBe("Working·44s");
    expect(screen.getByRole("status").textContent).toBe("Working");
  });

  it("waits for approval with the command, and shows the request when pressed", async () => {
    const user = userEvent.setup();
    const inputs = live({
      requests: [request("permission", "p1", "bash", "bun test\n--watch")],
    });
    renderLine(working([shell("test", "bun test")]), inputs);

    expect(screen.getByRole("status").textContent).toBe("Waiting for approval, bun test");
    expect(screen.queryByRole("button", { name: "Move to background" })).toBeNull();
    await user.click(screen.getByRole("button", { name: /^Waiting for approval, bun test/ }));
    expect(inputs.focusRequest).toHaveBeenCalledWith("p1");
  });

  it("waits for an answer to a question", () => {
    renderLine(working([]), live({ requests: [request("question", "q1", "Deploy target")] }));

    expect(screen.getByRole("status").textContent).toBe("Waiting for your answer, Deploy target");
    expect(screen.getByRole("button", { name: /^Waiting for your answer/ })).toBeTruthy();
  });

  it("offers to move a lone command to the background after it ran for 5 seconds", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(NOW);
    const inputs = live();
    renderLine(working([shell("test", "bun test", NOW)]), inputs);

    expect(screen.getByRole("status").textContent).toBe("Running 'bun test'");
    expect(screen.queryByRole("button", { name: "Move to background" })).toBeNull();
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    await userEvent
      .setup({ advanceTimers: vi.advanceTimersByTime })
      .click(screen.getByRole("button", { name: "Move to background" }));
    expect(inputs.moveToBackground).toHaveBeenCalledOnce();
  });

  it("names several tools running together", () => {
    renderLine(working([read("a", "src/a.ts"), shell("test", "bun test")]));

    expect(screen.getByRole("status").textContent).toBe("Running 2 tools");
    expect(screen.queryByRole("button", { name: "Move to background" })).toBeNull();
  });

  it("shows the thought once while the agent thinks, and announces only that it works", () => {
    const turn = working([{ type: "reasoning", id: "r1", text: "Comparing the two runs." }]);
    renderLine(turn);

    expect(screen.getAllByText("Comparing the two runs.")).toHaveLength(1);
    expect(screen.getByRole("status").textContent).toBe("Working");
  });

  it("counts down to the next retry without announcing every second", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    renderLine(
      working([]),
      live({ runtimeStatus: { type: "retry", attempt: 2, message: "", next: NOW + 5_000 } }),
    );

    expect(line().textContent).toContain("Retrying·Attempt 2, next try in 5s");
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(line().textContent).toContain("next try in 4s");
    expect(screen.getByRole("status").textContent).toBe("Retrying, Attempt 2");
  });

  it("keeps the running group from repeating what the live line says", () => {
    const part = shell("test", "bun test");
    const group = {
      id: "validate",
      kind: "tools" as const,
      title: "Validating the change",
      status: "running" as const,
      currentAction: "Running 'bun test'",
      entries: [{ message: message({ id: "step", type: "assistant" }), part, index: 0 }],
    };
    const view = (label: string) => (
      <Provider store={createStore()}>
        <LiveTurnContext.Provider value={live({ label })}>
          <ActivityGroup group={group} live sessionID="session" />
        </LiveTurnContext.Provider>
      </Provider>
    );

    const { rerender } = render(view("Running 'bun test'"));
    expect(screen.getByRole("button", { name: "Validating the change" })).toBeTruthy();
    rerender(view("Stopping"));
    expect(
      screen.getByRole("button", { name: "Validating the change · Running 'bun test'" }),
    ).toBeTruthy();
  });

  it("says Stopping after Stop", () => {
    renderLine(working([shell("test", "bun test")]), live({ stopping: true }));

    expect(screen.getByRole("status").textContent).toBe("Stopping");
  });

  describe("while the answer streams", () => {
    const readDone: PalotMessageContent = {
      type: "tool",
      id: "read",
      name: "read",
      state: { status: "completed", input: { path: "src/app.ts" } },
    };
    const answering: PalotMessage = message({
      id: "answer",
      type: "assistant",
      createdAt: NOW - 10_000,
      completedAt: null,
      content: [{ type: "text", text: "The bug was" }],
    });

    function statusFor(messages: PalotMessage[]) {
      const turn = projectTranscriptTurns(messages, {
        status: "running",
        startedAt: NOW - 42_000,
        completedAt: null,
      }).at(-1)!;
      renderLine(turn);
      return screen.getByRole("status").textContent;
    }

    it("says Finishing after the turn used tools", () => {
      const explored = message({
        id: "explore",
        type: "assistant",
        createdAt: NOW - 30_000,
        completedAt: NOW - 20_000,
        finish: "tool-calls",
        content: [{ type: "text", text: "Checking." }, readDone],
      });
      expect(statusFor([prompt, explored, answering])).toBe("Finishing");
    });

    it("says Working when no step used tools", () => {
      const thought = message({
        id: "think",
        type: "assistant",
        createdAt: NOW - 30_000,
        completedAt: NOW - 20_000,
        finish: "tool-calls",
        content: [{ type: "reasoning", text: "Considering" }],
      });
      expect(statusFor([prompt, thought, answering])).toBe("Working");
    });
  });
});
