import { Provider, createStore } from "jotai";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { Profiler } from "react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PalotMessage, PalotSession } from "../../shared";
import { messagesAtom, type SessionExecutionState } from "../atoms/workspace";
import type { TurnActivityGroup } from "../lib/turn-projection";
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
  BackgroundWorkPrompt,
  projectBackgroundWork,
  SubagentFooterControl,
  SubagentLaunch,
  SubagentResponse,
  SubagentSessionDock,
  type BackgroundWorkItem,
} from "./subagent-activity";

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
    const response: TurnActivityGroup = {
      id: "response",
      kind: "subagent",
      title: "Result",
      status: "completed",
      entries: [
        {
          message: source([]),
          index: 0,
          part: { type: "subagent-response", data: { childID: child.id }, text: "Final result" },
        },
      ],
    };
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
          <SubagentResponse group={response} />
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
    expect(screen.getAllByText("20s")).toHaveLength(2);
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
      },
    ]);
  });

  it("prompts to background the work delaying a steer", async () => {
    const onBackground = vi.fn();
    const items: BackgroundWorkItem[] = [
      {
        kind: "subagent",
        id: "child-1",
        agent: "Explore",
        description: "Map the timeline",
        startedAt: 1,
        fallbackStatus: "running",
        background: false,
      },
    ];

    render(
      <BackgroundWorkPrompt
        items={items}
        backgrounding={false}
        retry={false}
        error={null}
        onBackground={onBackground}
      />,
    );

    expect(
      screen.getByText(
        "The subagent 'Map the timeline' is blocking your message from steering this turn.",
      ),
    ).toBeTruthy();
    await userEvent.click(
      screen.getByRole("button", {
        name: "Send blocking work to background so the message can steer this turn",
      }),
    );
    expect(onBackground).toHaveBeenCalledOnce();
  });

  it("replaces the composer with parent and sibling navigation in a child session", async () => {
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
    expect(screen.getByText(/Read-only session/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Parent task" }));
    await userEvent.click(screen.getByRole("button", { name: "Next subagent" }));
    expect(mocks.openSession).toHaveBeenCalledWith(parent.id);
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
    await userEvent.click(screen.getByRole("button", { name: "Previous subagent" }));
    expect(mocks.openSession).toHaveBeenLastCalledWith(first.id);
    await userEvent.click(screen.getByRole("button", { name: "Next subagent" }));
    expect(mocks.openSession).toHaveBeenLastCalledWith(last.id);
    await userEvent.click(screen.getByRole("button", { name: "Parent task" }));
    expect(mocks.openSession).toHaveBeenLastCalledWith("parent");
  });
});
