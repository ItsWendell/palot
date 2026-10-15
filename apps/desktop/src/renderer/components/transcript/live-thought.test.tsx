import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { PalotMessage, PalotMessageContent } from "../../../shared";
import { createSessionTranscriptProjector, type TranscriptTurn } from "../../lib/turn-projection";
import { SESSION_PROJECTION_PRESETS } from "../../lib/session-projection-policy";
import { ActiveTurnMeta } from "../thread";
import { latestTurnThought } from "./live-thought";

function assistant(
  content: PalotMessageContent[],
  completedAt: number | null = null,
): PalotMessage {
  return {
    id: "assistant-1",
    type: "assistant",
    createdAt: 2,
    completedAt,
    text: null,
    agent: "build",
    model: null,
    tokens: null,
    finish: null,
    content,
    data: null,
  };
}

const user: PalotMessage = {
  id: "user-1",
  type: "user",
  createdAt: 1,
  completedAt: 1,
  text: "Investigate the flaky test",
  agent: null,
  model: null,
  tokens: null,
  finish: null,
  content: [],
  data: null,
};

function workingTurn(
  content: PalotMessageContent[],
  showReasoningSummaries = true,
): TranscriptTurn {
  const preset = SESSION_PROJECTION_PRESETS.compact;
  const projection = createSessionTranscriptProjector().project({
    messages: [user, assistant(content)],
    execution: { status: "running", startedAt: 1, completedAt: null },
    policy: { ...preset, showReasoningSummaries },
  });
  return projection.rows.at(-1)!.turn;
}

function StatusLine({ turn }: { turn: TranscriptTurn }) {
  return <ActiveTurnMeta startedAt={turn.startedAt} thought={latestTurnThought(turn)} />;
}

afterEach(cleanup);

describe("latest thought in the running status", () => {
  it("follows the newest streamed reasoning while the turn runs", () => {
    const first = workingTurn([
      { type: "reasoning", id: "r1", text: "Reading the test harness first." },
    ]);
    const view = render(<StatusLine turn={first} />);
    expect(screen.getByText("Reading the test harness first.")).toBeTruthy();

    const next = workingTurn([
      { type: "reasoning", id: "r1", text: "Reading the test harness first." },
      {
        type: "tool",
        id: "read",
        name: "read",
        state: { status: "completed", input: { path: "src/test.ts" } },
      },
      {
        type: "reasoning",
        id: "r2",
        text: "**Checking `retry` timing**\n\nThe timer may race the assertion.",
      },
    ]);
    view.rerender(<StatusLine turn={next} />);
    expect(screen.getByText("Checking retry timing")).toBeTruthy();
    expect(screen.queryByText("Reading the test harness first.")).toBeNull();
    // The live region keeps announcing only the status, not each thought.
    expect(screen.getByRole("status").textContent).not.toContain("Checking");
  });

  it("stays hidden without reasoning, after the turn ends, or when summaries are hidden", () => {
    expect(
      latestTurnThought(
        workingTurn([
          {
            type: "tool",
            id: "read",
            name: "read",
            state: { status: "running", input: { path: "src/test.ts" } },
          },
        ]),
      ),
    ).toBeNull();

    const reasoning: PalotMessageContent[] = [
      { type: "reasoning", id: "r1", text: "Comparing the two runs." },
    ];
    expect(latestTurnThought(workingTurn(reasoning, false))).toBeNull();
    expect(latestTurnThought({ ...workingTurn(reasoning), status: "completed" })).toBeNull();

    render(<ActiveTurnMeta startedAt={1} thought={null} />);
    expect(document.querySelector("[data-palot-active-turn-thought]")).toBeNull();
  });
});
