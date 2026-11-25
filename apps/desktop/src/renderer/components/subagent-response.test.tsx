import { cleanup, render, screen } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import { Provider, createStore } from "jotai";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { JsonValue, PalotMessage, PalotSession } from "../../shared";
import { runtimeAtom } from "../atoms/workspace";
import {
  createSessionTranscriptProjector,
  projectTranscriptTurns,
  type TurnActivityGroup,
} from "../lib/turn-projection";
import { createRendererQueryClient } from "../lib/query-client";
import { seedCatalog } from "../test-utils/render-with-router";

const mocks = vi.hoisted(() => ({ openSession: vi.fn() }));

vi.mock("../hooks/use-navigation", () => ({
  usePalotNavigation: () => ({ openSession: mocks.openSession }),
}));

import {
  SubagentLaunch,
  SubagentReportsContext,
  statusPresentation,
  subagentReportsByChild,
} from "./subagent-activity";
import { TimelineBoundary } from "./transcript/timeline-parts";

function runtime(version: string) {
  return {
    connectionID: "disconnected",
    profileID: "profile",
    contractVersion: "test",
    phase: "connected" as const,
    connected: false,
    binaryPath: "/test/opencode2",
    version,
    pid: 1,
    managed: true,
    lastConnectedAt: 1,
    error: null,
    versionMismatch: null,
  };
}

const child: PalotSession = {
  id: "child-1",
  parentID: "parent",
  projectID: "project",
  title: "Map the sidebar (@explore subagent)",
  agent: "explore",
  model: null,
  location: { directory: "/repo" },
  createdAt: 5_000,
  updatedAt: 10_000,
  archivedAt: null,
  cost: null,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
};

function launch(state: { [key: string]: JsonValue }): TurnActivityGroup {
  const part = {
    type: "tool",
    id: "call",
    name: "subagent",
    time: { created: 5_000, completed: 5_010 },
    state,
  };
  const message: PalotMessage = {
    id: "assistant",
    type: "assistant",
    createdAt: 5_000,
    completedAt: 5_020,
    text: null,
    agent: null,
    model: null,
    tokens: null,
    finish: "stop",
    content: [part],
    data: null,
  };
  return {
    id: "call",
    kind: "subagent-tool",
    title: "Delegated work",
    status: "completed",
    entries: [{ message, part, index: 0 }],
  };
}

function report(id: string, createdAt: number, text: string, state = "completed"): PalotMessage {
  return {
    id,
    type: "synthetic",
    createdAt,
    completedAt: createdAt,
    text: `<subagent sessionID="child-1" state="${state}" description="Map the sidebar">\n${text}\n</subagent>`,
    agent: null,
    model: null,
    tokens: null,
    finish: null,
    content: [],
    data: {
      description: "Map the sidebar",
      metadata: { source: "subagent", childID: "child-1", agent: "explore", state },
    },
  };
}

function renderLaunch(group: TurnActivityGroup, reports: PalotMessage[], version: string) {
  const store = createStore();
  store.set(runtimeAtom, runtime(version));
  const queryClient = createRendererQueryClient();
  seedCatalog(queryClient, { sessions: [child] });
  const projection = createSessionTranscriptProjector().project({ messages: reports });
  return render(
    <QueryClientProvider client={queryClient}>
      <Provider store={store}>
        <SubagentReportsContext.Provider
          value={subagentReportsByChild(projection.background.subagentResponses)}
        >
          <SubagentLaunch group={group} parentSessionID="parent" />
        </SubagentReportsContext.Provider>
      </Provider>
    </QueryClientProvider>,
  );
}

// OpenCode after 2.2.7: the call returns at once and the child reports each time it goes idle.
const alwaysBackground = {
  status: "completed",
  input: { agent: "explore", description: "Map the sidebar", prompt: "Map it" },
  metadata: { sessionID: "child-1", status: "running" },
  content: [
    { type: "text", text: "The subagent is working in the background (sessionID: child-1)." },
  ],
};

describe("subagent launch result", () => {
  afterEach(cleanup);

  it("shows the child's latest report as its result, with earlier ones on expand", async () => {
    const user = userEvent.setup();
    mocks.openSession.mockClear();
    renderLaunch(
      launch(alwaysBackground),
      [
        report("first", 8_000, "First pass: three files."),
        report("second", 10_000, "**Finding**\n\nUse sparse metadata."),
      ],
      "2.3.0",
    );

    // Every call is a background launch, so the chip would carry no information.
    expect(screen.queryByText("background")).toBeNull();
    // No live state: the latest report says how the child ended.
    expect(
      screen.getByRole("button", { name: "Explore subagent finished: Map the sidebar" }),
    ).toBeTruthy();
    expect(screen.queryByText("Use sparse metadata.")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Show Explore result" }));
    expect(screen.getByText("Use sparse metadata.")).toBeTruthy();
    expect(screen.queryByText("First pass: three files.")).toBeNull();
    await user.click(screen.getByRole("button", { name: /1 earlier report/ }));
    expect(screen.getByText("First pass: three files.")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Open Explore subagent task" }));
    expect(mocks.openSession).toHaveBeenCalledWith("child-1");
  });

  it("follows the latest report when the child failed after an earlier success", () => {
    renderLaunch(
      launch(alwaysBackground),
      [report("first", 8_000, "Done."), report("second", 10_000, "Model error", "error")],
      "2.3.0",
    );
    expect(
      screen.getByRole("button", { name: "Explore subagent failed: Map the sidebar" }),
    ).toBeTruthy();
  });

  it("waits on a child whose latest report lists background work still running", () => {
    // OpenCode 2.3.0 tags such a report `state="running"` but keeps `metadata.state: "completed"`.
    const waiting = report(
      "first",
      8_000,
      "Started the build.\n\nBackground work still running:\n- shell (sh_1): bun run build",
    );
    waiting.text = waiting.text!.replace('state="completed"', 'state="running"');
    const view = renderLaunch(launch(alwaysBackground), [waiting], "2.3.0");
    const row = screen.getByRole("button", {
      name: "Explore subagent waiting for background work: Map the sidebar",
    });
    expect(row.getAttribute("data-palot-subagent-state")).toBe("running");
    expect(screen.getByRole("button", { name: "Stop Explore subagent" })).toBeTruthy();
    view.unmount();

    // Its next report lists nothing still running: finished.
    renderLaunch(
      launch(alwaysBackground),
      [waiting, report("second", 10_000, "Build passed.")],
      "2.3.0",
    );
    expect(
      screen.getByRole("button", { name: "Explore subagent finished: Map the sidebar" }),
    ).toBeTruthy();
  });

  it("waits for a subagent when the work a child's report lists is its own subagent", () => {
    // OpenCode 2.3.0: the child went idle while the subagent it started waits for the user.
    const waiting = report(
      "first",
      8_000,
      "Waiting for the collector.\n\nBackground work still running:\n" +
        "- subagent (General, sessionID: grandchild): Collect the decision",
      "completed",
    );
    waiting.text = waiting.text!.replace('state="completed"', 'state="running"');
    renderLaunch(launch(alwaysBackground), [waiting], "2.3.0");
    const row = screen.getByRole("button", {
      name: "Explore subagent waiting for subagent: Map the sidebar",
    });
    expect(row.getAttribute("data-palot-subagent-state")).toBe("running");
  });

  it("does not call an idle child finished while a subagent it started still runs", () => {
    const idle = { status: "succeeded" as const, startedAt: 1, completedAt: 2 };
    // No report says so (an older server, or the report has not arrived): the family does.
    expect(statusPresentation(idle, "completed", null, true)).toEqual({
      label: "Waiting for subagent",
      running: true,
      failed: false,
    });
    expect(statusPresentation(idle, "completed", null, false).label).toBe("Finished");
    // Its own end still wins.
    expect(statusPresentation({ ...idle, status: "failed" }, "completed", null, true).label).toBe(
      "Failed",
    );
  });

  it("keeps the background chip on 2.2.7 for requested and moved background calls", () => {
    const requested = renderLaunch(
      launch({
        ...alwaysBackground,
        input: { ...alwaysBackground.input, background: true },
      }),
      [],
      "2.2.7",
    );
    expect(screen.getByText("background")).toBeTruthy();
    requested.unmount();

    // A 2.2.7 foreground call the user moved to the background has the same data as a launch.
    renderLaunch(launch(alwaysBackground), [], "2.2.7");
    expect(screen.getByText("background")).toBeTruthy();
  });

  it("shows no chip for a 2.2.7 foreground call that ran to completion", () => {
    renderLaunch(
      launch({
        status: "completed",
        input: { agent: "explore", description: "Map the sidebar", prompt: "Map it" },
        metadata: { sessionID: "child-1", status: "completed" },
      }),
      [],
      "2.2.7",
    );
    expect(screen.queryByText("background")).toBeNull();
    expect(screen.queryByRole("button", { name: "Show Explore result" })).toBeNull();
  });

  it("merges reports from subagents an earlier turn launched into one row that opens each task", async () => {
    const user = userEvent.setup();
    mocks.openSession.mockClear();
    const responses = [20_000, 25_000].map((createdAt, index): PalotMessage => ({
      id: `child-${index}`,
      type: "synthetic",
      createdAt,
      completedAt: createdAt,
      text: `<subagent sessionID="child-${index}" state="completed">Done.</subagent>`,
      agent: null,
      model: null,
      tokens: null,
      finish: null,
      content: [],
      data: {
        metadata: {
          source: "subagent",
          childID: `child-${index}`,
          agent: "explore",
          state: "completed",
        },
        description: `Inspect ${index}`,
      },
    }));
    const [turn] = projectTranscriptTurns(responses);

    render(
      <Provider store={createStore()}>
        <TimelineBoundary group={turn!.rootBoundary!} />
      </Provider>,
    );

    const row = screen.getByRole("button", { name: "Finished 2 subagents" });
    expect(screen.queryByText("Inspect 0")).toBeNull();
    await user.click(row);
    await user.click(screen.getByRole("button", { name: "Open Explore subagent task: Inspect 1" }));
    expect(mocks.openSession).toHaveBeenCalledWith("child-1");
    expect(
      screen.getByRole("button", { name: "Open Explore subagent task: Inspect 0" }),
    ).toBeTruthy();
  });
});
