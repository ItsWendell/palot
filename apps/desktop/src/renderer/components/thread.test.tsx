import { createStore } from "jotai";
import { act, cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PalotMessage, PalotModel, PalotSession } from "../../shared";
import { attentionTargetAtom } from "../atoms/attention";
import type { PendingRequestView } from "../lib/view-models";
import { palot } from "../services/palot";
import { renderWithRouter } from "../test-utils/render-with-router";
import type { SessionExecutionState } from "../atoms/workspace";
import { createSessionTranscriptProjector } from "../lib/turn-projection";
import { SessionThreadHeader, workingTurnIndex } from "./thread";
import { TimelineBoundary } from "./transcript/timeline-parts";
import { PendingRequests } from "./transcript/pending-requests";
import { ToolExecution } from "./tool-execution";
import { TranscriptModelsContext } from "./transcript/model-switch";
import { PendingApprovalContext, PendingApprovalStore } from "./transcript/pending-approvals";

const session: PalotSession = {
  id: "session-1",
  parentID: null,
  projectID: "project-1",
  title: "A long task title that should leave the task actions reachable in a narrow header",
  agent: null,
  model: null,
  location: { directory: "/worktrees/investigation" },
  createdAt: 1,
  updatedAt: 1,
  archivedAt: null,
  cost: null,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("SessionThreadHeader", () => {
  it("exports and copies the current task through its keyboard-accessible overflow", async () => {
    Element.prototype.getAnimations = vi.fn(() => []);
    const exportSession = vi.spyOn(palot, "exportSession").mockResolvedValue(null);
    const copy = vi.spyOn(palot, "copySessionMarkdown").mockResolvedValue(undefined);
    renderWithRouter(
      <div style={{ width: 360 }}>
        <SessionThreadHeader session={session} />
      </div>,
      createStore(),
    );
    const actions = screen.getByRole("button", { name: "Task actions" });
    actions.focus();
    await userEvent.keyboard("{Enter}");
    await userEvent.click(await screen.findByRole("menuitem", { name: "Export task" }));
    await waitFor(() =>
      expect(exportSession).toHaveBeenCalledWith(session.id, session.title, undefined),
    );
    await userEvent.click(actions);
    await userEvent.click(
      await screen.findByRole("menuitem", { name: "Copy conversation as Markdown" }),
    );
    await waitFor(() => expect(copy).toHaveBeenCalledWith(session.id, undefined));
  });
});

describe("transcript markers", () => {
  const switchRecord: PalotMessage = {
    id: "switch",
    type: "model-switched",
    createdAt: 1,
    completedAt: 1,
    text: null,
    agent: null,
    model: null,
    tokens: null,
    finish: null,
    content: [],
    data: null,
  };
  const marker = (variant?: string) => ({
    id: "switch",
    kind: "boundary" as const,
    title: "Switched to claude-opus",
    status: "completed" as const,
    entries: [
      {
        message: switchRecord,
        index: 0,
        part: {
          type: "timeline-boundary",
          id: "switch",
          name: "Switched to claude-opus",
          data: {
            kind: "model-switch",
            tone: "neutral",
            model: { id: "claude-opus", providerID: "anthropic", ...(variant ? { variant } : {}) },
            previous: { id: "gpt-5", providerID: "openai" },
          },
        },
      },
    ],
  });

  it("names a switched model from the catalog, falling back to its ID", () => {
    const models = [
      { id: "claude-opus", providerID: "anthropic", name: "Claude Opus" },
    ] as unknown as PalotModel[];
    const { rerender } = renderWithRouter(
      <TranscriptModelsContext.Provider value={models}>
        <TimelineBoundary group={marker("max")} />
      </TranscriptModelsContext.Provider>,
      createStore(),
    );
    expect(screen.getByRole("separator", { name: "Switched to Claude Opus · max" })).toBeTruthy();
    rerender(<TimelineBoundary group={marker()} />);
    expect(screen.getByRole("separator", { name: "Switched to claude-opus" })).toBeTruthy();
  });

  it("moves focus from a tool's Needs approval badge to its request", async () => {
    Element.prototype.scrollIntoView = vi.fn();
    const store = createStore();
    const approvals = new PendingApprovalStore();
    const request: PendingRequestView = {
      id: "permission-1",
      type: "permission",
      title: "Run command",
      resources: [],
      savePatterns: [],
      questions: [],
      fields: [],
      ownerMessageID: "assistant",
      toolPartID: "shell",
    };
    renderWithRouter(
      <PendingApprovalContext.Provider value={approvals}>
        <ToolExecution
          index={0}
          part={{
            type: "tool",
            id: "shell",
            name: "shell",
            state: { status: "running", input: { command: "rm -rf build" } },
          }}
        />
        <PendingRequests sessionID={session.id} requests={[request]} />
      </PendingApprovalContext.Provider>,
      store,
    );
    act(() =>
      approvals.update(new Map([["shell", request.id]]), (requestID) =>
        store.set(attentionTargetAtom, { sessionID: session.id, requestID, type: "permission" }),
      ),
    );
    await userEvent.click(screen.getByRole("button", { name: "Needs approval" }));
    const card = document.querySelector(`[data-palot-request-id="${request.id}"]`);
    await waitFor(() => expect(card?.contains(document.activeElement)).toBe(true));
    expect(store.get(attentionTargetAtom)).toBeNull();
  });
});

describe("workingTurnIndex", () => {
  const fields = { agent: null, model: null, tokens: null, finish: null, data: {} } as const;
  const user = (id: string, createdAt: number, delivery?: "queue" | "steer"): PalotMessage => ({
    ...fields,
    id,
    type: "user",
    createdAt,
    completedAt: createdAt,
    text: id,
    content: [{ type: "text", text: id }],
    ...(delivery ? { delivery, optimistic: true } : {}),
  });
  const reply: PalotMessage = {
    ...fields,
    id: "reply",
    type: "assistant",
    createdAt: 2,
    completedAt: null,
    text: null,
    content: [],
  };
  const inbox = (id: string): PendingRequestView => ({
    id,
    type: "input",
    title: "Pending input",
    detail: id,
    resources: [],
    savePatterns: [],
    questions: [],
    fields: [],
    delivery: "queue",
  });
  const running: SessionExecutionState = { status: "running", startedAt: 1, completedAt: null };
  const idle: SessionExecutionState = { status: "succeeded", startedAt: 1, completedAt: 5 };
  function rows(messages: PalotMessage[], execution: SessionExecutionState) {
    return createSessionTranscriptProjector().project({ messages, execution }).rows;
  }

  it("keeps the running turn working while prompts wait in the inbox after it", () => {
    const projected = rows(
      [user("prompt", 1), reply, user("queued-1", 3, "queue"), user("queued-2", 4, "queue")],
      running,
    );
    const index = workingTurnIndex(projected, [inbox("queued-1"), inbox("queued-2")]);
    expect(index).toBeGreaterThanOrEqual(0);
    expect(projected[index]!.turn.status).toBe("working");
    expect(projected.slice(index + 1).map((row) => row.turn.users[0]?.id)).toEqual([
      "queued-1",
      "queued-2",
    ]);
  });

  it("reports an idle task with waiting prompts as not working", () => {
    const projected = rows(
      [user("prompt", 1), { ...reply, completedAt: 5 }, user("queued-1", 6, "queue")],
      idle,
    );
    expect(workingTurnIndex(projected, [inbox("queued-1")])).toBe(-1);
  });

  it("finds the last turn as before when nothing is queued", () => {
    const working = rows([user("prompt", 1), reply], running);
    expect(workingTurnIndex(working, [])).toBe(working.length - 1);
    const done = rows([user("prompt", 1), { ...reply, completedAt: 5 }], idle);
    expect(workingTurnIndex(done, [])).toBe(-1);
  });
});
