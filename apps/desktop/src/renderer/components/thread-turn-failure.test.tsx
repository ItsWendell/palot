import type { SessionMessageInfo } from "@opencode/client";
import { Provider, createStore } from "jotai";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import type { SessionExecutionState } from "../atoms/workspace";
import { projectTranscriptMessages } from "../hooks/use-session-transcript";
import { withPersistedTurnFailures } from "../lib/persisted-turn-failures";
import { createSessionTranscriptProjector } from "../lib/turn-projection";
import { TurnActivity } from "./thread";

afterEach(cleanup);

// A reloaded transcript as the server lists it, including the newer Idle.error field.
const wire = [
  { id: "msg_user", type: "user", text: "Fix the build", time: { created: 1_000 } },
  {
    id: "msg_step",
    type: "assistant",
    agent: "build",
    model: { id: "model", providerID: "provider" },
    content: [
      {
        type: "tool",
        id: "call_read",
        name: "read",
        time: { created: 2_000, completed: 2_500 },
        state: { status: "completed", input: { path: "src/app.ts" }, content: [] },
      },
    ],
    finish: "tool-calls",
    time: { created: 2_000, completed: 3_000 },
  },
  {
    id: "msg_idle",
    type: "idle",
    outcome: "failed",
    error: { type: "ProviderError", message: "Rate limited by provider" },
    time: { created: 4_000 },
  },
] as unknown as SessionMessageInfo[];

function renderReloaded(execution: SessionExecutionState | null = null) {
  // The same mapping the transcript query applies to a freshly loaded page.
  const messages = withPersistedTurnFailures(projectTranscriptMessages(wire));
  const { presentationRows } = createSessionTranscriptProjector().project({ messages, execution });
  render(
    <Provider store={createStore()}>
      {presentationRows.map((row) =>
        row.kind === "activity" ? (
          <TurnActivity key={row.id} turn={row.turn} sessionID="failed-session" />
        ) : null,
      )}
    </Provider>,
  );
}

it("keeps a failed turn's error after a reload hydrates the transcript", () => {
  renderReloaded();
  const card = screen.getByRole("alert", { name: "Response failed" });
  expect(card.textContent).toContain("Rate limited by provider");
});

it("shows one failure card when the live execution error is still known", () => {
  renderReloaded({
    status: "failed",
    startedAt: 1_000,
    completedAt: 4_000,
    error: { type: "ProviderError", message: "Rate limited by provider" },
  });
  expect(screen.getAllByRole("alert", { name: "Response failed" })).toHaveLength(1);
});
