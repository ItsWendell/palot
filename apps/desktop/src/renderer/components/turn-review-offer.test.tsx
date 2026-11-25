import type { FileDiffInfo } from "@opencode/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider, createStore } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenCodeRuntimeStatus, PalotMessage } from "../../shared";
import { runtimeAtom, type SessionExecutionState } from "../atoms/workspace";
import { createRendererQueryClient } from "../lib/query-client";
import { createSessionTranscriptProjector, type TranscriptTurn } from "../lib/turn-projection";
import { ASK_FOR_REVIEW_PROMPT, reviewOfferUserMessageID } from "../lib/turn-review-offer";
import { TurnChangesCard, type TurnChangesScope } from "./thread";

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

describe("changed-files card", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listTurnDiffs.mockReturnValue(new Promise(() => {}));
    // Cards load their diff once near the viewport; here they always are.
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(private readonly callback: IntersectionObserverCallback) {}
        observe() {
          this.callback(
            [{ isIntersecting: true } as IntersectionObserverEntry],
            this as unknown as IntersectionObserver,
          );
        }
        disconnect() {}
      },
    );
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  /** One prompt whose step changed `files`, settled unless `running`. */
  function changedTurn(files: string[], running = false): TranscriptTurn {
    return createSessionTranscriptProjector().project({
      messages: [
        message({ id: "u1", type: "user", text: "Fix it" }),
        message({
          id: "a1",
          type: "assistant",
          createdAt: 2,
          completedAt: running ? null : 3,
          finish: running ? null : "stop",
          content: [{ type: "text", text: "Fixed" }],
          data: { snapshot: { files } },
        }),
      ],
      execution: running ? { status: "running", startedAt: 1, completedAt: null } : null,
    }).rows[0]!.turn;
  }

  function renderCard(turn: TranscriptTurn, scope: Partial<TurnChangesScope> = {}) {
    const store = createStore();
    store.set(runtimeAtom, {
      connected: true,
      profileID: "profile",
      connectionID: "origin",
    } as OpenCodeRuntimeStatus);
    const value: TurnChangesScope = {
      profileID: "profile",
      connectionID: "origin",
      reviewUserMessageID: null,
      open: vi.fn(),
      onAsked: vi.fn(),
      ...scope,
    };
    render(
      <QueryClientProvider client={createRendererQueryClient()}>
        <Provider store={store}>
          <TurnChangesCard turn={turn} sessionID="session" scope={value} />
        </Provider>
      </QueryClientProvider>,
    );
    return value;
  }

  const card = () => screen.queryByRole("group", { name: "Files changed in this turn" });

  it("sits under a finished turn that changed files, without review follow-ups", async () => {
    const scope = renderCard(changedTurn(["src/app.ts"]));

    expect(card()?.textContent).toContain("Changed app.ts");
    expect(screen.queryByRole("button", { name: "Ask for review" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Review changes" }));
    expect(scope.open).toHaveBeenLastCalledWith("u1", undefined);
    // A file row opens the same turn's diff at that file.
    await userEvent.click(screen.getByRole("button", { name: /^src\/app\.ts/ }));
    expect(scope.open).toHaveBeenLastCalledWith("u1", "src/app.ts");
  });

  it("is absent while the turn works and for a finished turn without changes", () => {
    renderCard(changedTurn(["src/app.ts"], true));
    expect(card()).toBeNull();
    cleanup();
    renderCard(changedTurn([]));
    expect(card()).toBeNull();
  });

  it("offers Ask for review on the latest turn, and dismissing keeps the card", async () => {
    mocks.sendComposerPrompt.mockResolvedValue({ id: "u2" });
    const scope = renderCard(changedTurn(["src/app.ts"]), { reviewUserMessageID: "u1" });

    await userEvent.click(screen.getByRole("button", { name: "Ask for review" }));
    expect(mocks.sendComposerPrompt).toHaveBeenCalledWith({
      sessionID: "session",
      text: ASK_FOR_REVIEW_PROMPT,
      delivery: "steer",
    });
    await waitFor(() => expect(scope.onAsked).toHaveBeenCalledOnce());
    expect(screen.queryByRole("button", { name: "Ask for review" })).toBeNull();
    expect(card()).toBeTruthy();
  });

  it("lets the latest turn's suggestion be dismissed", async () => {
    renderCard(changedTurn(["src/app.ts"]), { reviewUserMessageID: "u1" });

    await userEvent.click(screen.getByRole("button", { name: "Dismiss review suggestion" }));
    expect(screen.queryByRole("button", { name: "Ask for review" })).toBeNull();
    expect(card()).toBeTruthy();
    expect(mocks.sendComposerPrompt).not.toHaveBeenCalled();
  });

  it("asks the diff for the files of a latest turn without snapshot data", async () => {
    mocks.listTurnDiffs.mockResolvedValue([diff]);
    renderCard(changedTurn([]), { reviewUserMessageID: "u1" });

    expect(await screen.findByRole("button", { name: "src/app.ts, +3 −1" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Ask for review" })).toBeTruthy();
  });
});
