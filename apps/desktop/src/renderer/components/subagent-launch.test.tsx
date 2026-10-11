import { QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider, createStore } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PalotMessage, PalotSession } from "../../shared";
import { runtimeAtom, type SessionExecutionState } from "../atoms/workspace";
import { openCodeReconciler } from "../lib/open-code-reconciler";
import { createRendererQueryClient } from "../lib/query-client";
import type { TurnActivityGroup } from "../lib/turn-projection";
import { seedCatalog } from "../test-utils/render-with-router";
import { SubagentLaunch } from "./subagent-activity";

const mocks = vi.hoisted(() => ({
  openSession: vi.fn(),
  client: vi.fn(),
  interrupt: vi.fn(),
}));

vi.mock("../hooks/use-navigation", () => ({
  usePalotNavigation: () => ({ openSession: mocks.openSession }),
}));
vi.mock("../services/opencode-client", () => ({
  openCodeClient: (connectionID: string) => {
    mocks.client(connectionID);
    return { session: { interrupt: mocks.interrupt } };
  },
}));

const child: PalotSession = {
  id: "child-1",
  parentID: "parent",
  projectID: "project",
  title: "Map the timeline (@explore subagent)",
  agent: null,
  model: null,
  location: { directory: "/repo" },
  createdAt: 1,
  updatedAt: 1,
  archivedAt: null,
  cost: null,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
};

function launch(status: "running" | "completed"): TurnActivityGroup {
  const part = {
    type: "tool",
    id: "task-call",
    name: "task",
    time: status === "running" ? { created: Date.now() - 4_000 } : { created: 10, completed: 30 },
    state: {
      status,
      input: { subagent_type: "explore", description: "Map the timeline" },
      metadata: { sessionId: child.id },
    },
  };
  const message: PalotMessage = {
    id: "assistant",
    type: "assistant",
    createdAt: 10,
    completedAt: status === "running" ? null : 30,
    text: null,
    agent: "build",
    model: null,
    tokens: null,
    finish: "tool-calls",
    content: [part],
    data: null,
  };
  return {
    id: "task-call",
    kind: "subagent-tool",
    title: "Delegated work",
    status,
    entries: [{ message, part, index: 0 }],
  };
}

function renderLaunch(group: TurnActivityGroup, state: SessionExecutionState) {
  const queryClient = createRendererQueryClient();
  seedCatalog(queryClient, { sessions: [child] }, "origin");
  openCodeReconciler(queryClient).replaceActivity("origin", {
    activeIDs: new Set(state.status === "running" ? [child.id] : []),
    execution: new Map([[child.id, state]]),
    statuses: new Map(),
  });
  const store = createStore();
  store.set(runtimeAtom, {
    connected: true,
    connectionID: "origin",
    profileID: "profile-origin",
  } as never);
  render(
    <QueryClientProvider client={queryClient}>
      <Provider store={store}>
        <SubagentLaunch group={group} parentSessionID="parent" />
      </Provider>
    </QueryClientProvider>,
  );
}

describe("SubagentLaunch", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(cleanup);

  it("stops a running subagent through the child-session interrupt path", async () => {
    mocks.interrupt.mockResolvedValue(undefined);
    renderLaunch(launch("running"), {
      status: "running",
      startedAt: Date.now() - 4_000,
      completedAt: null,
      parentID: "parent",
    });

    const row = screen.getByRole("button", { name: "Explore subagent running: Map the timeline" });
    expect(row.textContent).toMatch(/Explore · Map the timeline.*\ds/);
    await userEvent.click(screen.getByRole("button", { name: "Stop Explore subagent" }));

    await waitFor(() => expect(mocks.interrupt).toHaveBeenCalledWith({ sessionID: child.id }));
    expect(mocks.client).toHaveBeenCalledWith("origin");
    expect(mocks.openSession).not.toHaveBeenCalled();
  });

  it("reports a failed stop without leaving the row", async () => {
    mocks.interrupt.mockRejectedValue(new Error("Session is not running"));
    renderLaunch(launch("running"), {
      status: "running",
      startedAt: Date.now(),
      completedAt: null,
      parentID: "parent",
    });

    await userEvent.click(screen.getByRole("button", { name: "Stop Explore subagent" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Session is not running");
  });

  it("shows the final duration and no stop control once the subagent finished", () => {
    renderLaunch(launch("completed"), {
      status: "succeeded",
      startedAt: 10_000,
      completedAt: 30_000,
      parentID: "parent",
    });

    expect(
      screen.getByRole("button", { name: "Explore subagent finished: Map the timeline" }),
    ).toBeTruthy();
    expect(screen.getByText("20s")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Stop/ })).toBeNull();
  });
});
