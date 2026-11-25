import { act, cleanup, render, screen } from "@testing-library/react";
import { Provider, createStore } from "jotai";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { JsonValue, PalotMessage, PalotMessageContent } from "../../../shared";
import type { TranscriptTurn } from "../../lib/turn-projection";
import { TurnActivity } from "./activity-group";

function message(content: PalotMessageContent[]): PalotMessage {
  return {
    id: "assistant-1",
    type: "assistant",
    createdAt: 1_000,
    completedAt: 2_000,
    text: null,
    agent: "build",
    model: null,
    tokens: null,
    finish: "tool-calls",
    content,
    data: {},
  };
}

function tool(
  id: string,
  name: string,
  status: string,
  input: Record<string, JsonValue>,
  extra: Record<string, JsonValue> = {},
): PalotMessageContent {
  return { type: "tool", id, name, state: { status, input, ...extra } };
}

const parts: PalotMessageContent[] = [
  tool(
    "edit",
    "edit",
    "completed",
    { path: "src/a.ts", oldString: "a", newString: "b" },
    {
      metadata: {
        files: [
          { file: "src/a.ts", patch: "@@", status: "modified", additions: 40, deletions: 12 },
        ],
      },
    },
  ),
  tool("test", "shell", "completed", { command: "bun test" }),
  tool("lint", "shell", "error", { command: "bun run lint" }, { error: "exit 1" }),
];

function turn(overrides: Partial<TranscriptTurn>, content = parts): TranscriptTurn {
  const source = message(content);
  return {
    id: "turn",
    user: null,
    users: [],
    activity: [
      {
        id: "tools",
        kind: "tools",
        title: "Edited a.ts",
        status: "completed",
        presentation: "grouped",
        entries: content.map((part, index) => ({ message: source, part, index })),
      },
    ],
    blockingRequests: [],
    final: null,
    postFinal: [],
    tokensPerSecond: null,
    status: "completed",
    startedAt: 1_000,
    finalStartedAt: null,
    workCompletedAt: null,
    completedAt: 126_000,
    canCollapse: true,
    shouldAutoCollapse: true,
    ...overrides,
  };
}

function renderBar(value: TranscriptTurn) {
  return render(
    <Provider store={createStore()}>
      <TurnActivity turn={value} sessionID="session" />
    </Provider>,
  );
}

describe("turn bar", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("says how long a finished turn worked and what it did", () => {
    renderBar(turn({}));

    expect(
      screen.getByRole("button", {
        name: "Worked for 2m 5s · changed 1 file +40 −12 · ran 2 commands · 1 failed",
      }),
    ).toBeTruthy();
  });

  it("measures a finished turn to its end, not to its answer", () => {
    renderBar(turn({ finalStartedAt: 31_000, workCompletedAt: 31_000 }));

    expect(screen.getByRole("button", { name: /^Worked for 2m 5s · / })).toBeTruthy();
  });

  it("says the user stopped the turn", () => {
    renderBar(turn({ status: "interrupted", canCollapse: false, shouldAutoCollapse: false }));

    expect(
      screen.getByRole("button", { name: /^You stopped after 2m 5s · changed 1 file/ }),
    ).toBeTruthy();
  });

  it("says the turn failed", () => {
    renderBar(turn({ status: "failed", canCollapse: false, shouldAutoCollapse: false }));

    expect(
      screen.getByRole("button", { name: /^Failed after 2m 5s · .* · 1 failed$/ }),
    ).toBeTruthy();
  });

  it("shows only the duration when the work has nothing to count", () => {
    renderBar(turn({}, [tool("read", "read", "completed", { path: "src/a.ts" })]));

    expect(screen.getByRole("button", { name: "Worked for 2m 5s" })).toBeTruthy();
  });

  it("ticks while the turn runs, also after its answer started, and counts nothing yet", () => {
    vi.useFakeTimers();
    vi.setSystemTime(43_000);
    renderBar(
      turn({
        status: "working",
        completedAt: null,
        finalStartedAt: 30_000,
        workCompletedAt: 30_000,
        canCollapse: true,
        shouldAutoCollapse: false,
      }),
    );

    expect(screen.getByRole("button", { name: "Working for 42s" })).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(screen.getByRole("button", { name: "Working for 44s" })).toBeTruthy();
  });

  it("shows no bar for a turn without work", () => {
    const { container } = renderBar(turn({ activity: [] }));

    expect(container.textContent).toBe("");
  });
});
