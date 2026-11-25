import { Provider, createStore } from "jotai";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { Profiler } from "react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PalotMessage, PalotSession } from "../../shared";
import { messagesAtom, type SessionExecutionState } from "../atoms/workspace";
import {
  createSessionTranscriptProjector,
  projectTranscriptTurns,
  type TurnActivityGroup,
} from "../lib/turn-projection";
import { createRendererQueryClient } from "../lib/query-client";
import { openCodeReconciler } from "../lib/open-code-reconciler";
import { seedCatalog } from "../test-utils/render-with-router";
import { useOpenCodeRecords } from "../hooks/use-open-code-records";
import { setSessionRequestSnapshot } from "../lib/session-request-query";

const mocks = vi.hoisted(() => ({
  openSession: vi.fn(),
}));

vi.mock("../hooks/use-navigation", () => ({
  usePalotNavigation: () => ({ openSession: mocks.openSession }),
}));

import {
  projectBackgroundWork,
  SubagentFooterControl,
  SubagentLaunch,
  SubagentSessionDock,
} from "./subagent-activity";
import { TurnActivity } from "./transcript/activity-group";

function session(input: Partial<PalotSession> & Pick<PalotSession, "id">): PalotSession {
  return {
    parentID: null,
    projectID: "project",
    title: "Parent task",
    agent: null,
    model: null,
    location: { directory: "/repo" },
    createdAt: 1,
    updatedAt: 1,
    archivedAt: null,
    cost: null,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    ...input,
  };
}

function renderCatalog(
  element: React.ReactNode,
  store: ReturnType<typeof createStore>,
  sessions: PalotSession[] = [],
  execution: Map<string, SessionExecutionState> = new Map(),
) {
  const queryClient = createRendererQueryClient();
  seedCatalog(queryClient, { sessions });
  openCodeReconciler(queryClient).replaceActivity("disconnected", {
    activeIDs: new Set(
      [...execution].flatMap(([sessionID, state]) =>
        state.status === "running" ? [sessionID] : [],
      ),
    ),
    execution,
    statuses: new Map(),
  });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <Provider store={store}>{element}</Provider>
    </QueryClientProvider>,
  );
  return { ...view, queryClient };
}

function source(content: PalotMessage["content"]): PalotMessage {
  return {
    id: "assistant",
    type: "assistant",
    createdAt: 10,
    completedAt: 30,
    text: null,
    agent: "build",
    model: null,
    tokens: null,
    finish: "tool-calls",
    content,
    data: null,
  };
}

function launchGroup(): TurnActivityGroup {
  const part = {
    type: "tool",
    id: "task-call",
    name: "task",
    time: { created: 10, completed: 30 },
    state: {
      status: "completed",
      input: { subagent_type: "explore", description: "Map the timeline", background: true },
      metadata: { sessionId: "child-1", background: true },
    },
  };
  return {
    id: "task-call",
    kind: "subagent-tool",
    title: "Ran Explore subagent",
    status: "completed",
    entries: [{ message: source([part]), part, index: 0 }],
  };
}

describe("subagent activity", () => {
  beforeEach(() => {
    mocks.openSession.mockClear();
  });

  it("keeps a delegated task accessible at every disclosure level without splitting the parent group", async () => {
    const child = session({
      id: "child-1",
      parentID: "parent",
      title: "Map the timeline (@explore subagent)",
    });
    const assistant = {
      ...source([
        {
          type: "tool",
          id: "read",
          name: "read",
          state: { status: "completed", input: { path: "src/a.ts" } },
        },
        {
          type: "tool",
          id: "task-call",
          name: "task",
          state: {
            status: "completed",
            input: { subagent_type: "explore", description: "Map the timeline", background: true },
            metadata: { sessionId: child.id, background: true },
          },
        },
        {
          type: "tool",
          id: "edit",
          name: "edit",
          state: { status: "completed", input: { path: "src/a.ts", text: "updated" } },
        },
        { type: "text", id: "final", text: "Done" },
      ]),
      finish: "stop" as const,
    };
    const turn = projectTranscriptTurns([assistant])[0]!;
    expect(turn.activity).toHaveLength(1);
    const user = userEvent.setup();
    renderCatalog(<TurnActivity turn={turn} sessionID="parent" />, createStore(), [child]);

    const cardName = "Explore subagent finished: Map the timeline";
    const oneVisibleCard = () =>
      expect(screen.getAllByRole("button", { name: cardName })).toHaveLength(1);
    const turnSummary = screen.getByRole("button", {
      name: "Worked for 1s · changed 1 file · 1 subagent",
    });
    expect(turnSummary.getAttribute("aria-expanded")).toBe("false");
    oneVisibleCard();

    // The turn's only group shows its rows without a header of its own.
    await user.click(turnSummary);
    expect(
      screen.queryByRole("button", { name: "Changed a.ts, delegated 1 task, and read 1 file" }),
    ).toBeNull();
    oneVisibleCard();
    await user.click(screen.getByRole("button", { name: cardName }));
    expect(mocks.openSession).toHaveBeenCalledWith(child.id);
  });

  afterEach(cleanup);

  it("renders a dedicated launch card that opens the live child session", async () => {
    const store = createStore();
    const child = session({
      id: "child-1",
      parentID: "parent",
      title: "Map the timeline (@explore subagent)",
    });
    const execution = new Map([
      [
        child.id,
        {
          status: "succeeded" as const,
          startedAt: 10_000,
          completedAt: 30_000,
          parentID: "parent",
        },
      ],
    ]);

    renderCatalog(
      <SubagentLaunch group={launchGroup()} parentSessionID="parent" />,
      store,
      [child],
      execution,
    );

    const card = screen.getByRole("button", {
      name: "Explore subagent finished: Map the timeline",
    });
    expect(screen.getByText("20s")).toBeTruthy();
    await userEvent.click(card);
    expect(mocks.openSession).toHaveBeenCalledWith(child.id);
  });

  it("resolves a running foreground subagent without previewing its transcript", async () => {
    const store = createStore();
    const child = session({
      id: "child-1",
      parentID: "parent",
      title: "Map the timeline (@explore subagent)",
      createdAt: Date.now() - 5_000,
    });
    const group = launchGroup();
    const part = group.entries[0]!.part;
    part.time = { created: Date.now() - 5_000 };
    part.state = {
      status: "running",
      input: { subagent_type: "explore", description: "Map the timeline" },
      metadata: {},
    };
    group.status = "running";
    const execution = new Map([
      [
        child.id,
        { status: "running" as const, startedAt: null, completedAt: null, parentID: "parent" },
      ],
    ]);
    store.set(
      messagesAtom,
      new Map([
        [child.id, [source([{ type: "reasoning", text: "Reviewing the timeline projection" }])]],
      ]),
    );

    renderCatalog(
      <SubagentLaunch group={group} parentSessionID="parent" />,
      store,
      [child],
      execution,
    );

    const card = screen.getByRole("button", {
      name: "Explore subagent running: Map the timeline",
    });
    expect(screen.queryByText("Reviewing the timeline projection")).toBeNull();
    expect(screen.getByText(/\d+s/)).toBeTruthy();
    await userEvent.click(card);
    expect(mocks.openSession).toHaveBeenCalledWith(child.id);
  });

  it("shows active work counts and opens an active subagent", async () => {
    const interval = vi.spyOn(window, "setInterval");
    const store = createStore();
    const child = session({
      id: "child-1",
      parentID: "parent",
      title: "Map the timeline (@explore subagent)",
    });
    const execution = new Map([
      [
        "child-1",
        {
          status: "running" as const,
          startedAt: Date.now(),
          completedAt: null,
          parentID: "parent",
        },
      ],
    ]);

    renderCatalog(
      <SubagentFooterControl
        sessionID="parent"
        items={[
          {
            kind: "shell",
            id: "shell-1",
            command: "bun run test",
            startedAt: 1,
            background: false,
          },
          {
            kind: "subagent",
            id: child.id,
            agent: "Explore",
            description: "Map the timeline",
            startedAt: 1,
            fallbackStatus: "running",
            background: false,
          },
        ]}
      />,
      store,
      [child],
      execution,
    );

    expect(screen.queryByText("1 shell")).toBeNull();
    expect(interval).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "View 1 active subagent" }));
    expect(interval).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole("button", { name: /Map the timeline/ }));
    expect(mocks.openSession).toHaveBeenCalledWith(child.id);
    interval.mockRestore();
  });

  it("ignores transcript deltas and optimistic overlays while retaining lifecycle updates", async () => {
    const store = createStore();
    const group = launchGroup();
    const child = session({ id: "child-1", parentID: "parent" });
    const running: SessionExecutionState = {
      status: "running",
      startedAt: null,
      completedAt: null,
      parentID: "parent",
    };
    // No reliable start time: this fixture tests stream isolation, not clock ticks.
    group.entries[0]!.part.time = undefined;
    function TranscriptReceipt() {
      const records = useOpenCodeRecords("disconnected", "session-message");
      return (
        <output data-testid="transcript-receipt">
          {records.map((record) => record.value.text).join("|")}
        </output>
      );
    }
    const commits = vi.fn();
    const { queryClient } = renderCatalog(
      <>
        <TranscriptReceipt />
        <Profiler id="cards" onRender={commits}>
          <SubagentLaunch group={group} parentSessionID="parent" />
        </Profiler>
      </>,
      store,
      [child],
      new Map([[child.id, running]]),
    );
    await screen.findByRole("button", { name: "Explore subagent running: Map the timeline" });
    act(() => {
      setSessionRequestSnapshot(queryClient, "disconnected", child.id, {
        permissions: [],
        inbox: [],
        errors: [],
        forms: [
          {
            id: "question",
            sessionID: child.id,
            title: "Ready?",
            metadata: { kind: "question" },
            fields: [{ key: "q0", type: "string", title: "Ready?" }],
          },
        ],
      });
    });
    await screen.findByRole("button", { name: "Explore subagent needs input: Map the timeline" });
    // Flush initial subscriptions before counting stream-driven commits.
    await act(async () => {});
    commits.mockClear();
    for (let index = 0; index < 8; index++) {
      const text = `delta-${index}`;
      await act(async () => {
        openCodeReconciler(queryClient).graph.commit((writer) => {
          for (const sessionID of [child.id, "unrelated"]) {
            writer.upsert({
              kind: "session-message",
              connectionID: "disconnected",
              sessionID,
              entityID: "assistant",
              value: { ...source([]), text },
            });
          }
        });
        store.set(messagesAtom, new Map([[child.id, [{ ...source([]), text, optimistic: true }]]]));
      });
      await waitFor(() =>
        expect(screen.getByTestId("transcript-receipt").textContent).toBe(`${text}|${text}`),
      );
    }
    expect(commits).not.toHaveBeenCalled();
    act(() => {
      setSessionRequestSnapshot(queryClient, "disconnected", child.id, {
        permissions: [],
        forms: [],
        inbox: [],
        errors: [],
      });
    });
    await screen.findByRole("button", { name: "Explore subagent running: Map the timeline" });
    act(() => {
      openCodeReconciler(queryClient).replaceActivity("disconnected", {
        activeIDs: new Set(),
        statuses: new Map(),
        execution: new Map([
          [child.id, { ...running, status: "succeeded", startedAt: 10_000, completedAt: 30_000 }],
        ]),
      });
    });
    await screen.findByRole("button", { name: "Explore subagent finished: Map the timeline" });
    expect(screen.getByText("20s")).toBeTruthy();
    expect(commits).toHaveBeenCalled();
  });

  it("projects active shell commands for the footer and steer snapshot", () => {
    const shell: PalotMessage = {
      id: "shell-message",
      type: "shell",
      createdAt: Date.now() - 5_000,
      completedAt: null,
      text: null,
      agent: null,
      model: null,
      tokens: null,
      finish: null,
      content: [],
      data: { shellID: "shell-1", command: "bun run test", status: "running" },
    };

    expect(
      projectBackgroundWork({
        sessionID: "parent",
        background: {
          subagentTools: [],
          subagentResponses: [],
          shellTools: [],
          shellMessages: [shell],
        },
        runningShells: [
          {
            id: "shell-1",
            sessionID: "parent",
            command: "bun run test",
            cwd: "/repo",
            startedAt: shell.createdAt,
            status: "running",
          },
        ],
        sessions: [],
        states: new Map(),
      }),
    ).toEqual([
      {
        kind: "shell",
        id: "shell-1",
        command: "bun run test",
        startedAt: shell.createdAt,
        background: false,
      },
    ]);
  });

  it("projects active subagents from transcript background facts", () => {
    const group = launchGroup();
    const entry = group.entries[0]!;
    const child = session({
      id: "child-1",
      parentID: "parent",
      title: "Map the timeline (@explore subagent)",
    });
    const states = new Map([
      [
        child.id,
        {
          status: "running" as const,
          startedAt: 10,
          completedAt: null,
          parentID: "parent",
        },
      ],
    ]);

    expect(
      projectBackgroundWork({
        sessionID: "parent",
        background: {
          subagentTools: [
            { part: entry.part, index: entry.index, messageCreatedAt: entry.message.createdAt },
          ],
          subagentResponses: [],
          shellTools: [],
          shellMessages: [],
        },
        runningShells: [],
        sessions: [child],
        states,
      }),
    ).toEqual([
      {
        kind: "subagent",
        id: child.id,
        agent: "Explore",
        description: "Map the timeline",
        startedAt: 10,
        fallbackStatus: "complete",
        background: true,
        requestedBackground: true,
        launchOnly: false,
      },
    ]);
  });

  it("never makes a reported subagent a foreground blocker when it runs again", () => {
    // OpenCode after 2.2.7: the call returned at once, then the child reported and runs again
    // because the user wrote to it.
    const part = {
      type: "tool",
      id: "call",
      name: "subagent",
      time: { created: 10, completed: 11 },
      state: {
        status: "completed",
        input: { agent: "explore", description: "Map the timeline", prompt: "Go" },
        metadata: { sessionID: "child-1", status: "running" },
      },
    };
    const report = {
      type: "subagent-response",
      id: "report",
      name: "Map the timeline",
      text: "Done.",
      status: "completed" as const,
      data: { childID: "child-1", agent: "explore", state: "completed" },
    };
    const [item] = projectBackgroundWork({
      sessionID: "parent",
      background: {
        subagentTools: [{ part, index: 0, messageCreatedAt: 10 }],
        subagentResponses: [{ part: report, messageCreatedAt: 20 }],
        shellTools: [],
        shellMessages: [],
      },
      runningShells: [],
      sessions: [],
      states: new Map([
        ["child-1", { status: "running", startedAt: 30, completedAt: null, parentID: "parent" }],
      ]),
    });
    expect(item).toMatchObject({
      kind: "subagent",
      background: true,
      requestedBackground: false,
      launchOnly: true,
    });
  });

  describe("a three-level family (experimental.subagent_depth: 2)", () => {
    const child = session({
      id: "child-1",
      parentID: "parent",
      title: "Map the timeline (@explore subagent)",
      createdAt: 1_000,
    });
    const grandchildren = [
      session({
        id: "grand-1",
        parentID: "child-1",
        title: "Read the reducer",
        agent: "explore",
        createdAt: 2_000,
      }),
      session({
        id: "grand-2",
        parentID: "child-1",
        title: "Read the tests",
        agent: "review",
        createdAt: 3_000,
      }),
    ];
    const running = (parentID: string) => ({
      status: "running" as const,
      startedAt: Date.now() - 1_000,
      completedAt: null,
      parentID,
    });

    it("shows a running subagent's subagents under its row, indented", async () => {
      renderCatalog(
        <SubagentLaunch group={launchGroup()} parentSessionID="parent" />,
        createStore(),
        [child, ...grandchildren],
        new Map([
          [child.id, running("parent")],
          ["grand-1", running(child.id)],
        ]),
      );
      const nested = await screen.findByRole("group", { name: "Subagents of Explore" });
      expect(screen.getByRole("button", { name: "Hide 2 subagents under Explore" })).toBeTruthy();
      expect(
        within(nested).getByRole("button", { name: "Explore subagent running: Read the reducer" }),
      ).toBeTruthy();
      await userEvent.click(
        within(nested).getByRole("button", { name: "Review subagent finished: Read the tests" }),
      );
      expect(mocks.openSession).toHaveBeenCalledWith("grand-2");
    });

    it("folds a finished subagent's subagents behind a count", async () => {
      const finished = { status: "succeeded" as const, startedAt: 1_000, completedAt: 9_000 };
      renderCatalog(
        <SubagentLaunch group={launchGroup()} parentSessionID="parent" />,
        createStore(),
        [child, ...grandchildren],
        new Map([
          [child.id, { ...finished, parentID: "parent" }],
          ["grand-1", { ...finished, parentID: child.id }],
          ["grand-2", { ...finished, parentID: child.id }],
        ]),
      );
      const toggle = await screen.findByRole("button", { name: "Show 2 subagents under Explore" });
      expect(toggle.textContent).toContain("2 subagents");
      expect(screen.queryByRole("group", { name: "Subagents of Explore" })).toBeNull();
      await userEvent.click(toggle);
      expect(screen.getByRole("group", { name: "Subagents of Explore" })).toBeTruthy();
    });

    it("lists a running grandchild under its parent in the active work list", () => {
      const group = launchGroup();
      const entry = group.entries[0]!;
      const items = projectBackgroundWork({
        sessionID: "parent",
        background: {
          subagentTools: [
            { part: entry.part, index: entry.index, messageCreatedAt: entry.message.createdAt },
          ],
          subagentResponses: [],
          shellTools: [],
          shellMessages: [],
        },
        runningShells: [],
        sessions: [child, ...grandchildren],
        states: new Map([
          [child.id, { ...running("parent"), startedAt: 10 }],
          ["grand-2", { ...running(child.id), startedAt: 30 }],
          ["grand-1", { ...running(child.id), startedAt: 20 }],
          // A session outside this task's family is never listed.
          ["elsewhere", { ...running("other-task"), startedAt: 15 }],
        ]),
      });
      expect(
        items.map((item) => [item.id, item.kind === "subagent" ? (item.depth ?? 0) : null]),
      ).toEqual([
        ["child-1", 0],
        ["grand-1", 1],
        ["grand-2", 1],
      ]);
      expect(items[1]).toMatchObject({ agent: "Explore", background: true, parentID: child.id });
    });
  });

  it("steps between sibling subagents above a child session's composer", async () => {
    const store = createStore();
    const parent = session({ id: "parent" });
    const first = session({
      id: "child-1",
      parentID: parent.id,
      title: "Map the timeline (@explore subagent)",
      createdAt: 2,
    });
    const second = session({
      id: "child-2",
      parentID: parent.id,
      title: "Review the renderer (@general subagent)",
      createdAt: 3,
    });
    const execution = new Map([
      [
        first.id,
        { status: "running" as const, startedAt: 1, completedAt: null, parentID: parent.id },
      ],
      [
        second.id,
        { status: "running" as const, startedAt: 2, completedAt: null, parentID: parent.id },
      ],
    ]);
    renderCatalog(
      <SubagentSessionDock session={first} />,
      store,
      [parent, first, second],
      execution,
    );

    expect(screen.getByText(/Explore subagent · 1 of 2/)).toBeTruthy();
    expect(screen.queryByText(/Read-only session/)).toBeNull();
    expect(document.querySelector("[data-palot-subagent-state]")?.textContent).toMatch(/^Running /);
    // Parent navigation moved to the task header breadcrumb.
    expect(screen.queryByRole("button", { name: "Parent task" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Next subagent" }));
    expect(mocks.openSession).toHaveBeenCalledWith(second.id);
  });

  it("navigates completed siblings in stable order without including descendants or other parents", async () => {
    const first = session({ id: "child-1", parentID: "parent", createdAt: 2 });
    const current = session({ id: "child-2", parentID: "parent", createdAt: 2 });
    const last = session({ id: "child-3", parentID: "parent", createdAt: 3 });
    const execution = new Map<string, SessionExecutionState>([
      [first.id, { status: "succeeded", startedAt: 1, completedAt: 2, parentID: "parent" }],
      [current.id, { status: "failed", startedAt: 1, completedAt: 2, parentID: "parent" }],
      [last.id, { status: "interrupted", startedAt: 1, completedAt: 2, parentID: "parent" }],
    ]);
    renderCatalog(
      <div style={{ width: 360 }}>
        <SubagentSessionDock session={current} />
      </div>,
      createStore(),
      [
        last,
        current,
        first,
        session({ id: "grandchild", parentID: current.id }),
        session({ id: "unrelated", parentID: "other" }),
      ],
      execution,
    );

    expect(screen.getByText(/subagent · 2 of 3/)).toBeTruthy();
    expect(document.querySelector("[data-palot-subagent-state]")?.textContent).toMatch(
      /^Failed after /,
    );
    await userEvent.click(screen.getByRole("button", { name: "Previous subagent" }));
    expect(mocks.openSession).toHaveBeenLastCalledWith(first.id);
    await userEvent.click(screen.getByRole("button", { name: "Next subagent" }));
    expect(mocks.openSession).toHaveBeenLastCalledWith(last.id);
  });
});

describe("a background subagent outliving its parent's turn", () => {
  it("keeps the same card element when the parent's turn ends", () => {
    const store = createStore();
    const child = session({
      id: "child-1",
      parentID: "parent",
      title: "Timed inspection (@general subagent)",
      createdAt: Date.now() - 5_000,
    });
    const execution = new Map([
      [
        child.id,
        { status: "running" as const, startedAt: null, completedAt: null, parentID: "parent" },
      ],
    ]);
    const base = { agent: "build", model: null, tokens: null, text: null, data: null };
    const prompt: PalotMessage = {
      ...base,
      id: "prompt",
      type: "user",
      createdAt: 1_000,
      completedAt: 1_000,
      finish: null,
      content: [{ type: "text", text: "Delegate a timed inspection." }],
    };
    const launch: PalotMessage = {
      ...base,
      id: "launch",
      type: "assistant",
      createdAt: 2_000,
      completedAt: 2_500,
      finish: "tool-calls",
      content: [
        {
          type: "tool",
          id: "call",
          name: "subagent",
          time: { created: 2_000, completed: 2_100 },
          state: {
            status: "completed",
            input: { agent: "general", description: "Timed inspection", prompt: "Go" },
            metadata: { sessionID: child.id, status: "running" },
          },
        },
      ],
    };
    const reply = (done: boolean): PalotMessage => ({
      ...base,
      id: "reply",
      type: "assistant",
      createdAt: 3_000,
      completedAt: done ? 3_500 : null,
      finish: done ? "stop" : null,
      content: [{ type: "text", id: "reply-text", text: "Waiting for the timed inspection." }],
    });
    const idle: PalotMessage = {
      ...base,
      id: "idle",
      type: "idle",
      createdAt: 4_000,
      completedAt: 4_000,
      finish: null,
      content: [],
      data: { outcome: "succeeded" },
    };
    const projector = createSessionTranscriptProjector();
    const turnOf = (messages: PalotMessage[]) => projector.project({ messages }).rows[0]!.turn;
    const element = (turn: ReturnType<typeof turnOf>) => (
      <TurnActivity turn={turn} sessionID="parent" preventAutoCollapse runningSubagents={1} />
    );
    const working = turnOf([prompt, launch, reply(false)]);
    expect(working.status).toBe("working");
    const view = renderCatalog(element(working), store, [child], execution);
    const card = screen.getByRole("button", { name: "General subagent running: Timed inspection" });
    console.log(
      JSON.stringify(working.activity.map((g) => [g.id, g.kind, g.presentation, g.headerless])),
    );

    const settled = turnOf([prompt, launch, reply(true), idle]);
    expect(settled.status).not.toBe("working");
    console.log(
      JSON.stringify(settled.activity.map((g) => [g.id, g.kind, g.presentation, g.headerless])),
    );
    view.rerender(
      <QueryClientProvider client={view.queryClient}>
        <Provider store={store}>{element(settled)}</Provider>
      </QueryClientProvider>,
    );

    expect(screen.getByRole("button", { name: "Waiting for 1 subagent" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "General subagent running: Timed inspection" })).toBe(
      card,
    );
    expect(card.isConnected).toBe(true);
  });
});
