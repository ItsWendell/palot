import type { FileDiffInfo } from "@opencode/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider, createStore } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PalotMessage } from "../../shared";
import type { SessionExecutionState } from "../atoms/workspace";
import { createRendererQueryClient } from "../lib/query-client";
import { createSessionTranscriptProjector } from "../lib/turn-projection";
import { ASK_FOR_REVIEW_PROMPT, reviewOfferUserMessageID } from "../lib/turn-review-offer";
import { TurnReviewOffer } from "./turn-review-offer";

const mocks = vi.hoisted(() => ({
  listTurnDiffs: vi.fn(),
  sendComposerPrompt: vi.fn(),
}));

vi.mock("../services/palot", () => ({
  palot: {
    listTurnDiffs: mocks.listTurnDiffs,
    sendComposerPrompt: mocks.sendComposerPrompt,
  },
}));

const diff: FileDiffInfo = {
  file: "src/app.ts",
  patch: "@@ -1 +1 @@\n-old\n+new",
  additions: 3,
  deletions: 1,
} as FileDiffInfo;

function message(input: Partial<PalotMessage> & Pick<PalotMessage, "id" | "type">): PalotMessage {
  return {
    createdAt: 1,
    completedAt: 2,
    text: null,
    agent: null,
    model: null,
    tokens: null,
    finish: null,
    content: [],
    data: null,
    ...input,
  };
}

function rows(execution: SessionExecutionState | null, completed = true) {
  return createSessionTranscriptProjector().project({
    messages: [
      message({ id: "u1", type: "user", text: "Fix it" }),
      message({
        id: "a1",
        type: "assistant",
        createdAt: 2,
        completedAt: completed ? 3 : null,
        finish: completed ? "stop" : null,
        content: [{ type: "text", text: "Fixed" }],
      }),
    ],
    execution,
  }).rows;
}

describe("review offer eligibility", () => {
  it("targets the latest settled prompt only while the task is idle", () => {
    const succeeded: SessionExecutionState = { status: "succeeded", startedAt: 1, completedAt: 3 };
    expect(reviewOfferUserMessageID(rows(succeeded), succeeded, { type: "idle" })).toBe("u1");
    expect(reviewOfferUserMessageID(rows(null), null, null)).toBe("u1");

    const running: SessionExecutionState = { status: "running", startedAt: 1, completedAt: null };
    expect(reviewOfferUserMessageID(rows(running, false), running, { type: "busy" })).toBeNull();
    expect(reviewOfferUserMessageID(rows(succeeded), succeeded, { type: "busy" })).toBeNull();
    expect(reviewOfferUserMessageID([], null, null)).toBeNull();
  });
});

describe("TurnReviewOffer", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(cleanup);

  function renderOffer(onReview = vi.fn(), onAsked = vi.fn()) {
    const queryClient = createRendererQueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <Provider store={createStore()}>
          <TurnReviewOffer
            connectionID="origin"
            sessionID="session"
            userMessageID="u1"
            available
            onReview={onReview}
            onAsked={onAsked}
          />
        </Provider>
      </QueryClientProvider>,
    );
    return { onReview, onAsked };
  }

  it("offers both review actions for a turn that changed files", async () => {
    mocks.listTurnDiffs.mockResolvedValue([diff]);
    mocks.sendComposerPrompt.mockResolvedValue({ id: "u2" });
    const { onReview, onAsked } = renderOffer();

    const offer = await screen.findByRole("group", { name: "Review this turn's changes" });
    expect(mocks.listTurnDiffs).toHaveBeenCalledWith("session", "u1", expect.anything(), "origin");
    expect(offer.textContent).toContain("1 file changed");

    await userEvent.click(screen.getByRole("button", { name: "Review changes" }));
    expect(onReview).toHaveBeenCalledWith("u1");

    await userEvent.click(screen.getByRole("button", { name: "Ask for review" }));
    expect(mocks.sendComposerPrompt).toHaveBeenCalledWith({
      sessionID: "session",
      text: ASK_FOR_REVIEW_PROMPT,
      delivery: "steer",
    });
    await waitFor(() => expect(onAsked).toHaveBeenCalledOnce());
    expect(screen.queryByRole("group", { name: "Review this turn's changes" })).toBeNull();
  });

  it("stays hidden for a turn without changed files", async () => {
    mocks.listTurnDiffs.mockResolvedValue([]);
    renderOffer();
    await waitFor(() => expect(mocks.listTurnDiffs).toHaveBeenCalled());
    expect(screen.queryByRole("group", { name: "Review this turn's changes" })).toBeNull();
  });

  it("can be dismissed", async () => {
    mocks.listTurnDiffs.mockResolvedValue([diff]);
    renderOffer();
    await userEvent.click(await screen.findByRole("button", { name: "Dismiss review suggestion" }));
    expect(screen.queryByRole("group", { name: "Review this turn's changes" })).toBeNull();
    expect(mocks.sendComposerPrompt).not.toHaveBeenCalled();
  });
});
