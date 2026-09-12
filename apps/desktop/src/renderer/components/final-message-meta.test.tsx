import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PalotMessage } from "../../shared";
import type { TranscriptTurn } from "../lib/turn-projection";

const mocks = vi.hoisted(() => ({ forkSession: vi.fn() }));

vi.mock("../hooks/use-session-fork", () => ({
  useSessionFork: () => mocks.forkSession,
}));

import { FinalMessageMeta } from "./thread";

describe("FinalMessageMeta", () => {
  beforeEach(() => {
    mocks.forkSession.mockReset();
    mocks.forkSession.mockResolvedValue(undefined);
  });

  afterEach(cleanup);

  it("shows how long the completed turn took", () => {
    const message: PalotMessage = {
      id: "assistant",
      type: "assistant",
      createdAt: 1_000,
      completedAt: 43_000,
      text: "Done",
      agent: null,
      model: null,
      tokens: null,
      finish: "stop",
      content: [{ type: "text", text: "Done" }],
      data: {},
    };
    const turn: TranscriptTurn = {
      id: "turn",
      user: null,
      users: [],
      activity: [],
      blockingRequests: [],
      final: { message, part: message.content[0]!, index: 0 },
      postFinal: [],
      tokensPerSecond: null,
      status: "completed",
      startedAt: 1_000,
      finalStartedAt: 40_000,
      workCompletedAt: 40_000,
      completedAt: 43_000,
      canCollapse: false,
      shouldAutoCollapse: false,
    };

    const result = render(<FinalMessageMeta turn={turn} models={[]} sessionID="session" />);

    expect(screen.getByTitle("Worked for 39s").textContent).toBe("39s");
    expect(result.container.firstElementChild?.classList.contains("opacity-0")).toBe(true);
  });

  it("shows output TPS with one decimal and provider-stream semantics", () => {
    const message: PalotMessage = {
      id: "assistant",
      type: "assistant",
      createdAt: 1_000,
      completedAt: 3_000,
      text: "Done",
      agent: null,
      model: null,
      tokens: null,
      finish: "stop",
      content: [{ type: "text", text: "Done" }],
      data: {},
    };
    const turn: TranscriptTurn = {
      id: "turn",
      user: null,
      users: [],
      activity: [],
      blockingRequests: [],
      final: { message, part: message.content[0]!, index: 0 },
      postFinal: [],
      tokensPerSecond: 131.4,
      status: "completed",
      startedAt: 1_000,
      finalStartedAt: 2_000,
      workCompletedAt: 2_000,
      completedAt: 3_000,
      canCollapse: false,
      shouldAutoCollapse: false,
    };

    render(<FinalMessageMeta turn={turn} models={[]} sessionID="session" />);

    expect(
      screen.getByLabelText("131.4 output tokens per second over provider stream duration")
        .textContent,
    ).toBe("131.4 tok/s");
    expect(
      screen.getByTitle("Output tokens per second over provider stream duration"),
    ).toBeTruthy();
  });

  it("opens response details for the displayed assistant message", () => {
    const onOpenDetails = vi.fn();
    const message: PalotMessage = {
      id: "assistant-details",
      type: "assistant",
      createdAt: 1_000,
      completedAt: 3_000,
      text: "Done",
      agent: null,
      model: null,
      tokens: null,
      finish: "stop",
      content: [{ type: "text", text: "Done" }],
      data: {},
    };
    const turn: TranscriptTurn = {
      id: "turn",
      user: null,
      users: [],
      activity: [],
      blockingRequests: [],
      final: { message, part: message.content[0]!, index: 0 },
      postFinal: [],
      tokensPerSecond: null,
      status: "completed",
      startedAt: 1_000,
      finalStartedAt: 2_000,
      workCompletedAt: 2_000,
      completedAt: 3_000,
      canCollapse: false,
      shouldAutoCollapse: false,
    };

    render(
      <FinalMessageMeta
        turn={turn}
        models={[]}
        sessionID="session"
        onOpenDetails={onOpenDetails}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Response details" }));

    expect(onOpenDetails).toHaveBeenCalledWith("assistant-details");
  });

  it("uses total-duration copy when historical final-start timing is unavailable", () => {
    const message: PalotMessage = {
      id: "assistant",
      type: "assistant",
      createdAt: 1_000,
      completedAt: 43_000,
      text: "Done",
      agent: null,
      model: null,
      tokens: null,
      finish: "stop",
      content: [{ type: "text", text: "Done" }],
      data: {},
    };
    const turn: TranscriptTurn = {
      id: "turn",
      user: null,
      users: [],
      activity: [],
      blockingRequests: [],
      final: { message, part: message.content[0]!, index: 0 },
      postFinal: [],
      tokensPerSecond: null,
      status: "completed",
      startedAt: 1_000,
      finalStartedAt: null,
      workCompletedAt: null,
      completedAt: 43_000,
      canCollapse: false,
      shouldAutoCollapse: false,
    };

    render(<FinalMessageMeta turn={turn} models={[]} sessionID="session" />);

    expect(screen.getByTitle("Completed in 42s").textContent).toBe("42s");
  });

  it("forks the session after this response", async () => {
    const message: PalotMessage = {
      id: "assistant",
      type: "assistant",
      createdAt: 1_000,
      completedAt: 3_000,
      text: "Done",
      agent: null,
      model: null,
      tokens: null,
      finish: "stop",
      content: [{ type: "text", text: "Done" }],
      data: {},
    };
    const turn: TranscriptTurn = {
      id: "turn",
      user: null,
      users: [],
      activity: [],
      blockingRequests: [],
      final: { message, part: message.content[0]!, index: 0 },
      postFinal: [],
      tokensPerSecond: null,
      status: "completed",
      startedAt: 1_000,
      finalStartedAt: 2_000,
      workCompletedAt: 2_000,
      completedAt: 3_000,
      canCollapse: false,
      shouldAutoCollapse: false,
    };

    render(
      <FinalMessageMeta
        turn={turn}
        models={[]}
        sessionID="session"
        forkBeforeMessageID="next-user"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Fork from this response" }));

    await waitFor(() =>
      expect(mocks.forkSession).toHaveBeenCalledWith({
        sessionID: "session",
        beforeMessageID: "next-user",
      }),
    );
  });
});
