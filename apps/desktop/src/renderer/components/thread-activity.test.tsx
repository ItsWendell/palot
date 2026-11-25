import { QueryClientProvider } from "@tanstack/react-query";
import { Provider, createStore } from "jotai";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { PalotMessage, PalotMessageContent } from "../../shared";
import { createRendererQueryClient } from "../lib/query-client";
import {
  createSessionTranscriptProjector,
  type TurnActivityGroup,
  type TurnPart,
} from "../lib/turn-projection";
import { CompactionBoundary } from "./transcript/compaction-row";
import { ActivityGroup, TurnActivity } from "./transcript/activity-group";
import { ThoughtDisclosure, TimelineBoundary } from "./transcript/timeline-parts";

const catalog = vi.hoisted(() => ({
  sessions: [
    { id: "ses_source", title: "Source task" },
    { id: "ses_fork", title: "Source task (fork #1)", forkedFrom: "ses_source" },
  ],
}));
vi.mock("../hooks/use-session-catalog", () => ({
  useSessionCatalogSelector: (select: (sessions: typeof catalog.sessions) => unknown) =>
    select(catalog.sessions),
}));

function message(content: PalotMessageContent[]): PalotMessage {
  return {
    id: "assistant-1",
    type: "assistant",
    createdAt: 1,
    completedAt: 2,
    text: null,
    agent: null,
    model: null,
    tokens: null,
    finish: "error",
    content,
    data: {},
  };
}

function reasoningEntry(part: PalotMessageContent): TurnPart {
  const source = message([part]);
  return { message: source, part, index: 0 };
}

describe("ActivityGroup", () => {
  it("renders a compact adjacent read disclosure across different files and preserves its fold choice as more reads arrive", async () => {
    const user = userEvent.setup();
    const parts: PalotMessageContent[] = ["one", "two", "three"].map((name) => ({
      type: "tool",
      id: name,
      name: "read",
      state: {
        status: "completed",
        input: { path: `src/${name}.ts` },
        content: [{ type: "text", text: `1: ${name} contents` }],
      },
    }));
    const source = message(parts);
    const group: TurnActivityGroup = {
      id: "adjacent",
      kind: "tools",
      status: "completed",
      title: "Read files",
      entries: parts.slice(0, 2).map((part, index) => ({ message: source, part, index })),
    };
    const store = createStore();
    const renderGroup = (value: TurnActivityGroup) => (
      <Provider store={store}>
        <ActivityGroup group={value} live={false} defaultOpen sessionID="adjacent-reads" />
      </Provider>
    );
    const view = render(renderGroup(group));
    const trigger = screen.getByRole("button", { name: "Read 2 files" });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    await user.click(trigger);
    expect(screen.getByRole("button", { name: /one.ts/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /two.ts/ })).toBeTruthy();
    await user.click(trigger);
    view.rerender(
      renderGroup({
        ...group,
        entries: parts.map((part, index) => ({ message: source, part, index })),
      }),
    );
    expect(screen.getByRole("button", { name: "Read 3 files" }).getAttribute("aria-expanded")).toBe(
      "false",
    );
    view.unmount();
  });
  it("shows a background command's returned output in its original tool details", async () => {
    const user = userEvent.setup();
    const assistant: PalotMessage = {
      ...message([
        {
          type: "tool",
          id: "background-command",
          name: "shell",
          state: {
            status: "completed",
            input: { command: "python sample.py", background: true },
            metadata: { shellID: "job-1", status: "running" },
          },
        },
      ]),
      finish: "tool-calls",
    };
    const returned: PalotMessage = {
      ...message([]),
      id: "return",
      type: "synthetic",
      createdAt: 3,
      text: '<shell id="job-1" state="completed" command="python sample.py">\nFinished sample\n</shell>',
      data: {
        description: "python sample.py",
        metadata: { source: "shell", shellID: "job-1", state: "completed", exit: 0 },
      },
    };
    const group = createSessionTranscriptProjector().project({
      messages: [assistant, returned],
    }).rows[0]!.turn.activity[0]!;

    render(<ActivityGroup group={group} live={false} defaultOpen sessionID="background-fixture" />);

    expect(screen.queryByRole("status", { name: "python sample.py" })).toBeNull();
    await user.click(screen.getByRole("button", { name: /Ran python sample\.py/ }));
    expect(screen.getByText("Finished sample")).toBeTruthy();
  });

  it("renders a described synthetic message as a static inline update", () => {
    const part: PalotMessageContent = {
      type: "timeline-boundary",
      id: "restart",
      name: "Continuing after restart",
      data: { kind: "synthetic", tone: "neutral" },
    };
    const source = message([part]);

    render(
      <TimelineBoundary
        group={{
          id: "restart",
          kind: "boundary",
          title: "Continuing after restart",
          status: "completed",
          entries: [{ message: source, part, index: 0 }],
        }}
      />,
    );

    expect(screen.getByRole("status", { name: "Continuing after restart" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Continuing after restart" })).toBeNull();
    expect(screen.queryByText("The server restarted while you were working.")).toBeNull();
  });

  it("renders goal, restart, instructions, image and watch notices as their own quiet rows", async () => {
    const user = userEvent.setup();
    const notice = (id: string, data: Record<string, unknown>, type = "synthetic") =>
      ({
        ...message([]),
        id,
        type,
        createdAt: 10,
        text: "body",
        data,
      }) as PalotMessage;
    const groups = [
      notice("goal", { description: "Goal: Ship it", metadata: { source: "goal", goalID: "g" } }),
      notice("restart", {
        description: "Continuing after restart",
        metadata: { notice: "restart" },
      }),
      notice("instructions", {
        description: "Loaded AGENTS.md, apps/AGENTS.md",
        metadata: { instruction: { paths: ["/r/AGENTS.md", "/r/apps/AGENTS.md"] } },
      }),
      notice("image", {
        description: "Image generation",
        metadata: {
          source: "experimental_image_generate",
          jobID: "j",
          state: "completed",
          path: "a.png",
        },
      }),
      notice("watch", { description: "CI failed on main", metadata: { source: "console.watch" } }),
    ].map((value) => {
      const turn = createSessionTranscriptProjector().project({ messages: [value] }).rows[0]!.turn;
      return turn.rootBoundary!;
    });

    render(
      <>
        {groups.map((group) => (
          <TimelineBoundary key={group.id} group={group} />
        ))}
      </>,
    );

    expect(screen.getByRole("status", { name: "Goal: Ship it" })).toBeTruthy();
    expect(screen.getByRole("status", { name: "Image generation" })).toBeTruthy();
    expect(screen.getByRole("status", { name: "CI failed on main" })).toBeTruthy();
    expect(screen.queryByText("body")).toBeNull();
    await user.click(screen.getByRole("button", { name: "OpenCode restarted" }));
    expect(screen.getAllByText("Continuing after restart").length).toBeGreaterThan(0);
    await user.click(screen.getByRole("button", { name: "Loaded instructions" }));
    expect(screen.getAllByText("AGENTS.md, apps/AGENTS.md").length).toBeGreaterThan(0);
  });

  it("names the source task on a fork notice and keeps the model-facing text out", () => {
    const text =
      "<fork-notice>\nThis conversation is a fork of another conversation.\n</fork-notice>";
    const notice = (id: string) =>
      ({
        ...message([]),
        id,
        type: "synthetic",
        createdAt: 10,
        text,
        data: { description: "Fork notice" },
      }) as PalotMessage;
    const groups = [notice("msg_fork_notice_ses_fork"), notice("msg_copied")].map(
      (value) =>
        createSessionTranscriptProjector().project({ messages: [value] }).rows[0]!.turn
          .rootBoundary!,
    );

    render(
      <>
        {groups.map((group) => (
          <TimelineBoundary key={group.id} group={group} />
        ))}
      </>,
    );

    expect(screen.getByRole("status", { name: "Forked from Source task" })).toBeTruthy();
    // A notice copied from an earlier fork has a new ID, so its source is unknown.
    expect(screen.getByRole("status", { name: "Forked from another task" })).toBeTruthy();
    expect(screen.queryByText(/fork of another conversation/)).toBeNull();
    expect(screen.queryByRole("button", { name: /Forked from/ })).toBeNull();
  });

  it("merges finished background commands into one row that lists them", async () => {
    const user = userEvent.setup();
    const report = (id: string, createdAt: number) =>
      ({
        ...message([]),
        id,
        type: "synthetic",
        createdAt,
        text: `<shell id="${id}" state="completed" command="make ${id}">\nfailed\n</shell>`,
        data: {
          description: `make ${id}`,
          metadata: { source: "shell", shellID: id, state: "completed", exit: 2 },
        },
      }) as PalotMessage;
    const group = createSessionTranscriptProjector().project({
      messages: [report("build", 10), report("lint", 11)],
    }).rows[0]!.turn.rootBoundary!;

    render(<TimelineBoundary group={group} />);

    const row = screen.getByRole("button", { name: "2 commands failed" });
    expect(screen.queryByText("make build")).toBeNull();
    await user.click(row);
    expect(screen.getByText("make build")).toBeTruthy();
    expect(screen.getByText("make lint")).toBeTruthy();
    expect(screen.getAllByText("exit 2")).toHaveLength(2);
  });

  it("renders retry and failure boundaries with live semantics", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const retry: PalotMessageContent = {
      type: "timeline-boundary",
      id: "retry",
      name: "Retrying response, attempt 2",
      text: "Rate limited",
      status: "running",
      data: { kind: "retry", tone: "progress", at: 4_000 },
    };
    const source = message([retry]);
    const result = render(
      <TimelineBoundary
        group={{
          id: "retry",
          kind: "boundary",
          title: retry.name!,
          status: "running",
          entries: [{ message: source, part: retry, index: 0 }],
        }}
      />,
    );

    expect(screen.getByRole("status", { name: "Retrying response, attempt 2 in 3s" })).toBeTruthy();
    expect(screen.getByText("Rate limited")).toBeTruthy();

    result.rerender(
      <TimelineBoundary
        group={{
          id: "error",
          kind: "boundary",
          title: "Response failed",
          status: "failed",
          entries: [
            {
              message: source,
              index: 0,
              part: {
                type: "timeline-boundary",
                name: "Response failed",
                text: "Provider unavailable",
                status: "failed",
                data: { kind: "error", tone: "error" },
              },
            },
          ],
        }}
      />,
    );

    expect(screen.getByRole("alert", { name: "Response failed" })).toBeTruthy();
    vi.useRealTimers();
  });

  it("counts down a usage-limit retry inside its label", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const retry: PalotMessageContent = {
      type: "timeline-boundary",
      id: "retry",
      name: "Usage limit reached · retrying (attempt 2)",
      text: "5-hour limit reached",
      status: "running",
      data: {
        kind: "retry",
        tone: "warning",
        limit: "Usage limit reached",
        attempt: 2,
        at: 41_000,
      },
    };
    render(
      <TimelineBoundary
        group={{
          id: "retry",
          kind: "boundary",
          title: retry.name!,
          status: "running",
          entries: [{ message: message([retry]), part: retry, index: 0 }],
        }}
      />,
    );
    expect(
      screen.getByRole("status", { name: "Usage limit reached · retrying in 40s (attempt 2)" }),
    ).toBeTruthy();
    vi.useRealTimers();
  });

  it("renders interruptions as a neutral compact status", () => {
    const interrupted: PalotMessageContent = {
      type: "timeline-boundary",
      id: "interrupted",
      name: "Response interrupted",
      text: "The active step stopped before a response was completed.",
      status: "interrupted",
      data: { kind: "interrupted", tone: "neutral" },
    };
    const source = message([interrupted]);

    render(
      <TimelineBoundary
        group={{
          id: "interrupted",
          kind: "boundary",
          title: interrupted.name!,
          status: "interrupted",
          entries: [{ message: source, part: interrupted, index: 0 }],
        }}
      />,
    );

    const status = screen.getByRole("separator", { name: "Response interrupted" });
    expect(status.className).toContain("rounded-lg");
    expect(
      screen.getByText("The active step stopped before a response was completed."),
    ).toBeTruthy();
  });

  it("shows how many calls failed beside the group title", () => {
    const parts: PalotMessageContent[] = [
      {
        type: "reasoning",
        id: "reasoning-1",
        text: "Inspecting the command failure.",
      },
      {
        type: "tool",
        id: "shell-1",
        name: "shell",
        state: {
          status: "error",
          input: { command: "bun test" },
          error: "Tests failed",
        },
      },
    ];
    const source = message(parts);
    const group: TurnActivityGroup = {
      id: "activity-1",
      kind: "tools",
      title: "Ran 1 command",
      status: "failed",
      entries: parts.map((part, index) => ({ message: source, part, index })),
    };

    render(<ActivityGroup group={group} live={false} />);

    const trigger = screen.getByRole("button", { name: /^Ran 1 command\s*· 1 failed$/ });
    expect(trigger.querySelector('[data-slot="badge"]')).toBeNull();
    expect(within(trigger).getByText("· 1 failed")).toBeTruthy();
  });

  it("keeps a newly running tool group collapsed until the user opens it", () => {
    const part: PalotMessageContent = {
      type: "tool",
      id: "shell-running",
      name: "shell",
      state: { status: "running", input: { command: "bun test" } },
    };
    const source = message([part]);
    source.completedAt = null;

    render(
      <ActivityGroup
        group={{
          id: "running-process",
          kind: "tools",
          title: "Running 'bun test'",
          status: "running",
          entries: [{ message: source, part, index: 0 }],
        }}
        live
      />,
    );

    expect(
      screen.getByRole("button", { name: "Running 'bun test'" }).getAttribute("aria-expanded"),
    ).toBe("false");
  });

  it("groups consecutive reasoning entries into one summarized disclosure", async () => {
    const user = userEvent.setup();
    const parts: PalotMessageContent[] = [
      {
        type: "reasoning",
        id: "reasoning-1",
        text: "**Evaluating database options**",
        presentation: "thought",
        time: { created: 10, completed: 1_010 },
      },
      {
        type: "reasoning",
        id: "reasoning-2",
        text: "**Designing shared database services**",
        presentation: "thought",
        time: { created: 1_010, completed: 3_010 },
      },
      {
        type: "reasoning",
        id: "reasoning-3",
        text: "**Planning middleware layering**",
        presentation: "thought",
        time: { created: 3_010, completed: 33_510 },
      },
    ];
    const source = message(parts);

    render(
      <ActivityGroup
        group={{
          id: "reasoning-group",
          kind: "reasoning",
          title: "Planning middleware layering",
          status: "completed",
          entries: parts.map((part, index) => ({ message: source, part, index })),
        }}
        live={false}
        defaultOpen
      />,
    );

    const trigger = screen.getByRole("button", { name: "Reasoning · 3 steps · 33s" });
    expect(
      screen.queryByRole("button", { name: /Reasoning: Evaluating database options/ }),
    ).toBeNull();
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("Evaluating database options")).toBeTruthy();
    expect(screen.getByText("Designing shared database services")).toBeTruthy();
    expect(screen.getAllByText("Planning middleware layering")).toHaveLength(2);
    // Every step reads as one train of thought in a single scroll region.
    const steps = screen.getByLabelText("Reasoning steps");
    expect(within(steps).getByText("Evaluating database options")).toBeTruthy();
    expect(within(steps).getByText("Designing shared database services")).toBeTruthy();
    expect(within(steps).getByText("Planning middleware layering")).toBeTruthy();
    await user.click(trigger);
    expect(
      screen.getByRole("button", {
        name: "Reasoning: Planning middleware layering · 3 steps · 33s",
      }),
    ).toBeTruthy();
  });

  it("renders completed compaction as a closed disclosure with its payload", async () => {
    const user = userEvent.setup();
    const part: PalotMessageContent = {
      type: "compaction",
      id: "compaction",
      status: "completed",
      text: "Compacted summary",
      recent: "Recent context preserved",
      cost: 0.001,
    };
    const source = message([part]);
    const result = render(
      <CompactionBoundary
        group={{
          id: "compaction-group",
          kind: "compaction",
          title: "Compacting context",
          status: "completed",
          entries: [{ message: source, part, index: 0 }],
        }}
      />,
    );

    const boundary = within(result.container);
    const trigger = boundary.getByRole("button", { name: "Context compacted" });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(boundary.queryByText("Compacted summary")).toBeNull();
    expect(boundary.queryByText("Recent context preserved")).toBeNull();
    await user.click(trigger);
    expect(boundary.getByText("Compacted summary")).toBeTruthy();
    expect(boundary.getByText(/^Summarizing used .*0\.001/)).toBeTruthy();
    expect(boundary.queryByText("Recent context preserved")).toBeNull();
    const recentTrigger = boundary.getByRole("button", {
      name: "Approximately 6 tokens of recent context are kept verbatim",
    });
    expect(recentTrigger.getAttribute("aria-expanded")).toBe("false");
    await user.click(recentTrigger);
    expect(boundary.getByText("Recent context preserved")).toBeTruthy();
  });

  it("keeps running compaction closed while streaming inspectable content", async () => {
    const user = userEvent.setup();
    const part: PalotMessageContent = {
      type: "compaction",
      id: "compaction",
      status: "running",
      text: "Partial streamed summary",
    };
    const source = message([part]);

    const result = render(
      <CompactionBoundary
        group={{
          id: "compaction-group",
          kind: "compaction",
          title: "Compacting context",
          status: "running",
          entries: [{ message: source, part, index: 0 }],
        }}
      />,
    );

    const boundary = within(result.container);
    const trigger = boundary.getByRole("button", { name: "Compacting context" });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(boundary.queryByText("Partial streamed summary")).toBeNull();
    await user.click(trigger);
    expect(boundary.getByText("Partial streamed summary")).toBeTruthy();
  });

  it("keeps failed compaction details available in its disclosure", async () => {
    const user = userEvent.setup();
    const part: PalotMessageContent = {
      type: "compaction",
      id: "compaction",
      status: "failed",
      text: "Partial summary",
      recent: "Recent context",
      error: "Context is too large",
    };
    const source = message([part]);

    const result = render(
      <CompactionBoundary
        group={{
          id: "compaction-group",
          kind: "compaction",
          title: "Compacting context",
          status: "failed",
          entries: [{ message: source, part, index: 0 }],
        }}
      />,
    );

    const boundary = within(result.container);
    const trigger = boundary.getByRole("button", { name: "Context compaction failed" });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(boundary.queryByText("Context is too large")).toBeNull();
    expect(boundary.queryByText("Partial summary")).toBeNull();
    expect(boundary.queryByText("Recent context")).toBeNull();
    await user.click(trigger);
    expect(boundary.getByText("Context is too large")).toBeTruthy();
    expect(boundary.getByText("Partial summary")).toBeTruthy();
    expect(boundary.queryByText("Recent context")).toBeNull();
    await user.click(
      boundary.getByRole("button", {
        name: "Approximately 4 tokens of recent context are kept verbatim",
      }),
    );
    expect(boundary.getByText("Recent context")).toBeTruthy();
  });

  it("renders a compaction-only turn without a nested disclosure", () => {
    const part: PalotMessageContent = {
      type: "compaction",
      id: "compaction",
      status: "completed",
      text: "Hydrated summary",
    };
    const source = message([part]);

    const result = render(
      <TurnActivity
        turn={{
          id: "compaction-turn",
          user: null,
          users: [],
          activity: [
            {
              id: "compaction-group",
              kind: "compaction",
              title: "Compacting context",
              status: "completed",
              entries: [{ message: source, part, index: 0 }],
            },
          ],
          blockingRequests: [],
          final: null,
          postFinal: [],
          tokensPerSecond: null,
          status: "completed",
          startedAt: 1,
          finalStartedAt: null,
          workCompletedAt: null,
          completedAt: 2,
          canCollapse: false,
          shouldAutoCollapse: false,
        }}
        sessionID="session-1"
      />,
    );

    const boundary = within(result.container);
    expect(boundary.getByRole("button", { name: "Context compacted" })).toBeTruthy();
    expect(boundary.getAllByRole("button")).toHaveLength(1);
    expect(boundary.queryByText("Hydrated summary")).toBeNull();
  });

  it("keeps grouped details open when the owning turn must remain revealed", () => {
    const parts: PalotMessageContent[] = [
      { type: "reasoning", id: "reasoning", text: "Inspecting the failure." },
      {
        type: "tool",
        id: "shell",
        name: "shell",
        state: {
          status: "error",
          input: { command: "bun test" },
          error: "Tests failed",
        },
      },
    ];
    const source = message(parts);

    const result = render(
      <ActivityGroup
        group={{
          id: "failed-process",
          kind: "tools",
          title: "Running 'bun test'",
          status: "failed",
          entries: parts.map((part, index) => ({
            message: source,
            part,
            index,
          })),
        }}
        live={false}
        defaultOpen
      />,
    );

    expect(
      screen
        .getByRole("button", { name: /^Running 'bun test'\s*· 1 failed$/ })
        .getAttribute("aria-expanded"),
    ).toBe("true");
    expect(result.container.querySelectorAll("button").length).toBeGreaterThan(1);
  });

  it("does not change disclosure state when a tool group settles", async () => {
    const user = userEvent.setup();
    const part: PalotMessageContent = {
      type: "tool",
      id: "shell",
      name: "shell",
      state: { status: "running", input: { command: "bun test" } },
    };
    const source = message([part]);
    source.completedAt = null;
    const group = {
      id: "stable-shell-group",
      kind: "tools" as const,
      title: "Running 'bun test'",
      status: "running" as const,
      entries: [{ message: source, part, index: 0 }],
    };
    const result = render(<ActivityGroup group={group} live />);
    const trigger = within(result.container).getByRole("button", { name: "Running 'bun test'" });

    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    await user.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");

    result.rerender(
      <ActivityGroup
        group={{
          ...group,
          status: "completed",
          entries: [
            {
              message: { ...source, completedAt: 20 },
              part: { ...part, state: { status: "completed", input: { command: "bun test" } } },
              index: 0,
            },
          ],
        }}
        live={false}
      />,
    );

    expect(trigger.getAttribute("aria-expanded")).toBe("true");
  });

  it("respects a manual collapse while the current group keeps updating", async () => {
    const user = userEvent.setup();
    const part: PalotMessageContent = {
      type: "tool",
      id: "shell",
      name: "shell",
      state: { status: "running", input: { command: "bun test" } },
    };
    const source = message([part]);
    source.completedAt = null;
    const group: TurnActivityGroup = {
      id: "stable-active-group",
      kind: "tools",
      title: "Validating the change",
      currentAction: "Running 'bun test'",
      status: "running",
      entries: [{ message: source, part, index: 0 }],
      defaultOpen: true,
    };
    const result = render(<ActivityGroup group={group} live defaultOpen />);
    const trigger = within(result.container).getByRole("button", {
      name: "Validating the change · Running 'bun test'",
    });

    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    await user.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");

    result.rerender(
      <ActivityGroup
        group={{ ...group, currentAction: "Running 'bun test --watch'" }}
        live
        defaultOpen
      />,
    );
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  it("forces failed activity open even after a manual collapse", async () => {
    const store = createStore();
    const user = userEvent.setup();
    const part: PalotMessageContent = {
      type: "tool",
      id: "failed-shell",
      name: "shell",
      state: { status: "running", input: { command: "bun test" } },
    };
    const source = message([part]);
    source.completedAt = null;
    const group: TurnActivityGroup = {
      id: "forced-failure-group",
      kind: "tools",
      title: "Validating the change",
      status: "running",
      entries: [{ message: source, part, index: 0 }],
      defaultOpen: true,
    };
    const result = render(
      <Provider store={store}>
        <ActivityGroup group={group} live defaultOpen sessionID="forced-session" />
      </Provider>,
    );
    const trigger = within(result.container).getByRole("button", {
      name: "Validating the change",
    });

    await user.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");

    result.rerender(
      <Provider store={store}>
        <ActivityGroup
          group={{ ...group, status: "failed", forceOpen: true }}
          live={false}
          defaultOpen={false}
          sessionID="forced-session"
        />
      </Provider>,
    );
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
  });
});

describe("TurnActivity", () => {
  it("does not start an unused duration timer for revealed working activity", () => {
    const interval = vi.spyOn(window, "setInterval");
    try {
      render(
        <TurnActivity
          turn={{
            id: "working-turn",
            user: null,
            users: [],
            activity: [],
            blockingRequests: [],
            final: null,
            postFinal: [],
            tokensPerSecond: null,
            status: "working",
            startedAt: 1,
            finalStartedAt: null,
            workCompletedAt: null,
            completedAt: null,
            canCollapse: false,
            shouldAutoCollapse: false,
          }}
          sessionID="session-working"
        />,
      );

      expect(interval).not.toHaveBeenCalled();
    } finally {
      interval.mockRestore();
    }
  });

  it("does not auto-collapse while a subagent remains active", () => {
    const part: PalotMessageContent = {
      type: "tool",
      id: "task",
      name: "task",
      state: { status: "completed" },
    };
    const source = message([part]);

    const result = render(
      <TurnActivity
        turn={{
          id: "subagent-turn",
          user: null,
          users: [],
          activity: [
            {
              id: "tools",
              kind: "tools",
              title: "Delegated work",
              status: "completed",
              entries: [{ message: source, part, index: 0 }],
            },
          ],
          blockingRequests: [],
          final: {
            message: source,
            part: { type: "text", text: "Streaming" },
            index: 1,
          },
          postFinal: [],
          tokensPerSecond: null,
          status: "working",
          startedAt: 1,
          finalStartedAt: 2,
          workCompletedAt: 2,
          completedAt: null,
          canCollapse: true,
          shouldAutoCollapse: true,
        }}
        sessionID="session-1"
        preventAutoCollapse
      />,
    );

    expect(result.container.querySelector("button")?.getAttribute("aria-expanded")).toBe("true");
  });

  it("keeps pinned activity visible while disclosing the remaining groups separately", async () => {
    const user = userEvent.setup();
    const pinnedPart: PalotMessageContent = {
      type: "tool",
      id: "pinned",
      name: "task",
      state: { status: "completed" },
    };
    const hiddenPart: PalotMessageContent = {
      type: "tool",
      id: "hidden",
      name: "read",
      state: { status: "completed" },
    };
    const source = message([pinnedPart, hiddenPart]);
    const result = render(
      <TurnActivity
        turn={{
          id: "pinned-turn",
          user: null,
          users: [],
          activity: [
            {
              id: "pinned",
              kind: "tools",
              title: "Pinned companion",
              status: "completed",
              pinned: true,
              entries: [{ message: source, part: pinnedPart, index: 0 }],
            },
            {
              id: "hidden",
              kind: "tools",
              title: "Hidden companion work",
              status: "completed",
              entries: [{ message: source, part: hiddenPart, index: 1 }],
            },
          ],
          blockingRequests: [],
          final: null,
          postFinal: [],
          tokensPerSecond: null,
          status: "completed",
          startedAt: 1,
          finalStartedAt: null,
          workCompletedAt: 2,
          completedAt: 2,
          canCollapse: true,
          shouldAutoCollapse: true,
        }}
        sessionID="session-pinned"
      />,
    );
    const view = within(result.container);
    const trigger = view.getByRole("button", { name: "Worked for 1s · 1 subagent" });

    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(view.getByText("Pinned companion")).toBeTruthy();
    expect(view.queryByText("Hidden companion work")).toBeNull();

    await user.click(trigger);

    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(view.getByText("Hidden companion work")).toBeTruthy();
  });

  it("folds a finished prompt's work behind one duration and keeps its steer in view", async () => {
    const user = userEvent.setup();
    const base = { agent: null, model: null, tokens: null, data: {} };
    const prompt: PalotMessage = {
      ...base,
      id: "prompt",
      type: "user",
      createdAt: 1_000,
      completedAt: 1_000,
      finish: null,
      text: "Fix the parser",
      content: [{ type: "text", text: "Fix the parser" }],
    };
    const explore: PalotMessage = {
      ...base,
      id: "explore",
      type: "assistant",
      createdAt: 2_000,
      completedAt: 3_000,
      finish: "tool-calls",
      text: null,
      content: [
        {
          type: "tool",
          id: "read",
          name: "read",
          state: { status: "completed", input: { path: "src/parser.ts" } },
        },
      ],
    };
    const steer: PalotMessage = {
      ...prompt,
      id: "steer",
      createdAt: 4_000,
      completedAt: 4_000,
      text: "Keep the old API",
      content: [{ type: "text", text: "Keep the old API" }],
    };
    const answer: PalotMessage = {
      ...base,
      id: "answer",
      type: "assistant",
      createdAt: 5_000,
      completedAt: 6_000,
      finish: "stop",
      text: null,
      content: [{ type: "text", id: "answer-text", text: "Done.", time: { created: 5_000 } }],
    };
    const idle: PalotMessage = {
      ...base,
      id: "idle",
      type: "idle",
      createdAt: 7_000,
      completedAt: 7_000,
      finish: null,
      text: null,
      content: [],
      data: { outcome: "succeeded" },
    };
    const [turn] = createSessionTranscriptProjector().project({
      messages: [prompt, explore, steer, answer, idle],
    }).rows;
    const result = render(<TurnActivity turn={turn!.turn} sessionID="session-steer" />);
    const view = within(result.container);
    const trigger = view.getByRole("button", { name: "Worked for 6s" });

    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(view.getByText("Steer")).toBeTruthy();
    expect(view.getByText("Keep the old API")).toBeTruthy();
    expect(view.queryByText("Read 1 file")).toBeNull();

    await user.click(trigger);

    // The turn's only group shows its row directly under the bar.
    expect(view.queryByText("Read 1 file")).toBeNull();
    expect(view.getByText(/parser\.ts/)).toBeTruthy();
  });

  it("folds a completed turn that ended on its work behind the whole run's duration", () => {
    const base = { agent: null, model: null, tokens: null, text: null, data: {} };
    const messages: PalotMessage[] = [
      {
        ...base,
        id: "prompt",
        type: "user",
        createdAt: 1_000,
        completedAt: 1_000,
        finish: null,
        content: [{ type: "text", text: "Check the parser" }],
      },
      {
        ...base,
        id: "explore",
        type: "assistant",
        createdAt: 2_000,
        completedAt: 3_000,
        finish: "tool-calls",
        content: [
          { type: "text", id: "plan", text: "Checking." },
          {
            type: "tool",
            id: "read",
            name: "read",
            state: { status: "completed", input: { path: "src/parser.ts" } },
          },
        ],
      },
      {
        ...base,
        id: "idle",
        type: "idle",
        createdAt: 9_000,
        completedAt: 9_000,
        finish: null,
        content: [],
        data: { outcome: "succeeded" },
      },
    ];
    const [row] = createSessionTranscriptProjector().project({ messages }).rows;
    const result = render(<TurnActivity turn={row!.turn} sessionID="session-no-answer" />);

    const trigger = within(result.container).getByRole("button", { name: "Worked for 8s" });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(within(result.container).queryByText("Checking.")).toBeNull();
  });

  it("holds a settled turn's outcome while the task's subagents still run", () => {
    const messages: PalotMessage[] = [
      {
        id: "prompt",
        type: "user",
        createdAt: 1_000,
        completedAt: 1_000,
        text: "Explore",
        agent: null,
        model: null,
        tokens: null,
        finish: null,
        content: [],
        data: null,
      },
      {
        ...message([{ type: "tool", id: "read", name: "read", state: { status: "completed" } }]),
        id: "work",
        createdAt: 2_000,
        completedAt: 3_000,
        finish: "tool-calls",
      },
      {
        ...message([]),
        id: "idle",
        type: "idle",
        createdAt: 9_000,
        completedAt: 9_000,
        finish: null,
        data: { outcome: "succeeded" },
      },
    ];
    const [row] = createSessionTranscriptProjector().project({ messages }).rows;
    const waiting = render(
      <TurnActivity turn={row!.turn} sessionID="session-waiting" runningSubagents={2} />,
    );
    expect(
      within(waiting.container).getByRole("button", { name: "Waiting for 2 subagents" }),
    ).toBeTruthy();
    waiting.unmount();

    const settled = render(<TurnActivity turn={row!.turn} sessionID="session-settled" />);
    expect(within(settled.container).getByRole("button", { name: /^Worked for 8s/ })).toBeTruthy();
  });

  it("collapses prior work while the final response is streaming", () => {
    const part: PalotMessageContent = {
      type: "tool",
      id: "read",
      name: "read",
      state: { status: "completed" },
    };
    const source = message([part]);
    source.completedAt = null;
    const result = render(
      <TurnActivity
        turn={{
          id: "streaming-turn",
          user: null,
          users: [],
          activity: [
            {
              id: "tools",
              kind: "tools",
              title: "Read files",
              status: "completed",
              entries: [{ message: source, part, index: 0 }],
            },
          ],
          blockingRequests: [],
          final: {
            message: source,
            part: { type: "text", text: "Streaming" },
            index: 1,
          },
          postFinal: [],
          tokensPerSecond: null,
          status: "working",
          startedAt: 1,
          finalStartedAt: 2,
          workCompletedAt: 2,
          completedAt: null,
          canCollapse: true,
          shouldAutoCollapse: true,
        }}
        sessionID="session-1"
      />,
    );

    expect(result.container.querySelector("button")?.getAttribute("aria-expanded")).toBe("false");
  });

  it("keeps completed tool groups collapsed and independently toggleable", async () => {
    const store = createStore();
    const user = userEvent.setup();
    const part: PalotMessageContent = {
      type: "tool",
      id: "read",
      name: "read",
      state: { status: "completed" },
    };
    const source = message([part]);

    render(
      <Provider store={store}>
        <TurnActivity
          turn={{
            id: "completed-tool-turn",
            user: null,
            users: [],
            activity: [
              {
                id: "tools",
                kind: "tools",
                title: "Read files",
                status: "completed",
                entries: [{ message: source, part, index: 0 }],
              },
            ],
            blockingRequests: [],
            final: {
              message: source,
              part: { type: "text", text: "Done" },
              index: 1,
            },
            postFinal: [],
            tokensPerSecond: null,
            status: "completed",
            startedAt: 1,
            finalStartedAt: 2,
            workCompletedAt: null,
            completedAt: 3,
            canCollapse: true,
            shouldAutoCollapse: true,
          }}
          sessionID="session-completed-tools"
        />
      </Provider>,
    );

    const turnTrigger = screen.getByRole("button", { name: "Worked for 1s" });
    expect(turnTrigger.getAttribute("aria-expanded")).toBe("false");
    await user.click(turnTrigger);

    const groupTrigger = screen.getByRole("button", { name: "Read files" });
    expect(groupTrigger.getAttribute("aria-expanded")).toBe("false");
    await user.click(groupTrigger);
    expect(groupTrigger.getAttribute("aria-expanded")).toBe("true");
    await user.click(groupTrigger);
    expect(groupTrigger.getAttribute("aria-expanded")).toBe("false");
  });

  it("keeps a published artifact's card in view when its activity folds", async () => {
    const user = userEvent.setup();
    const parts: PalotMessageContent[] = [
      { type: "tool", id: "read", name: "read", state: { status: "completed" } },
      {
        type: "tool",
        id: "publish",
        name: "execute",
        state: {
          status: "completed",
          input: { code: "return await tools.opencode.artifact_create({...})" },
          content: [{ type: "text", text: "null" }],
          metadata: {
            toolCalls: [
              {
                tool: "opencode.artifact_create",
                status: "completed",
                input: { title: "Coverage report", files: { "index.html": "" } },
              },
            ],
          },
        },
      },
    ];
    const source = message(parts);
    const view = render(
      <QueryClientProvider client={createRendererQueryClient()}>
        <Provider store={createStore()}>
          <TurnActivity
            turn={{
              id: "artifact-turn",
              user: null,
              users: [],
              activity: [
                {
                  id: "tools",
                  kind: "tools",
                  title: "Explored",
                  status: "completed",
                  presentation: "grouped",
                  entries: parts.map((part, index) => ({ message: source, part, index })),
                },
              ],
              blockingRequests: [],
              final: { message: source, part: { type: "text", text: "Done" }, index: 2 },
              postFinal: [],
              tokensPerSecond: null,
              status: "completed",
              startedAt: 1,
              finalStartedAt: 2,
              workCompletedAt: null,
              completedAt: 3,
              canCollapse: true,
              shouldAutoCollapse: true,
            }}
            sessionID="session-artifact"
          />
        </Provider>
      </QueryClientProvider>,
    );

    const scope = within(view.container);
    const turnTrigger = scope.getByRole("button", { name: "Worked for 1s" });
    expect(turnTrigger.getAttribute("aria-expanded")).toBe("false");
    expect(scope.getByRole("group", { name: "Artifact: Coverage report" })).toBeTruthy();
    await user.click(turnTrigger);
    const groupTrigger = scope.getByRole("button", { name: "Explored" });
    expect(groupTrigger.getAttribute("aria-expanded")).toBe("false");
    expect(scope.getAllByRole("group", { name: "Artifact: Coverage report" })).toHaveLength(1);
    await user.click(groupTrigger);
    expect(scope.getAllByRole("group", { name: "Artifact: Coverage report" })).toHaveLength(1);
    view.unmount();
  });

  it("uses the turn summary as the only top-level activity disclosure", async () => {
    const user = userEvent.setup();
    const parts: PalotMessageContent[] = [
      { type: "tool", id: "read", name: "read", state: { status: "completed" } },
      {
        type: "tool",
        id: "shell",
        name: "shell",
        state: { status: "completed", input: { command: "bun test" } },
      },
    ];
    const source = message(parts);
    const result = render(
      <TurnActivity
        turn={{
          id: "expand-all-turn",
          user: null,
          users: [],
          activity: parts.map((part, index) => ({
            id: part.id!,
            kind: "tools" as const,
            title: index === 0 ? "Read files" : "Ran tests",
            status: "completed" as const,
            entries: [{ message: source, part, index }],
            presentation: "grouped" as const,
            detailsDefaultOpen: false,
          })),
          blockingRequests: [],
          final: { message: source, part: { type: "text", text: "Done" }, index: 2 },
          postFinal: [],
          tokensPerSecond: null,
          status: "completed",
          startedAt: 1,
          finalStartedAt: 2,
          workCompletedAt: 2,
          completedAt: 3,
          canCollapse: true,
          shouldAutoCollapse: true,
        }}
        sessionID="session-expand-all"
      />,
    );

    const view = within(result.container);
    expect(view.queryByRole("button", { name: "Expand all activity" })).toBeNull();
    await user.click(view.getByRole("button", { name: "Worked for 1s · ran 1 command" }));
    expect(view.getByRole("button", { name: "Read files" }).getAttribute("aria-expanded")).toBe(
      "false",
    );
    expect(view.getByRole("button", { name: "Ran tests" }).getAttribute("aria-expanded")).toBe(
      "false",
    );
  });

  it("lets an active turn collapse behind its live duration summary", async () => {
    const user = userEvent.setup();
    const part: PalotMessageContent = {
      type: "tool",
      id: "shell-active",
      name: "shell",
      state: { status: "running", input: { command: "bun test" } },
    };
    const source = message([part]);
    source.completedAt = null;
    const result = render(
      <TurnActivity
        turn={{
          id: "active-expand-all-turn",
          user: null,
          users: [],
          activity: [
            {
              id: "active-group",
              kind: "tools",
              title: "Validating the change",
              status: "running",
              entries: [{ message: source, part, index: 0 }],
              presentation: "grouped",
              defaultOpen: false,
            },
          ],
          blockingRequests: [],
          final: null,
          postFinal: [],
          tokensPerSecond: null,
          status: "working",
          startedAt: 1,
          finalStartedAt: null,
          workCompletedAt: null,
          completedAt: null,
          canCollapse: false,
          shouldAutoCollapse: false,
        }}
        sessionID="active-expand-all-session"
      />,
    );
    const view = within(result.container);
    const turnTrigger = view.getByRole("button", { name: /^Working for / });

    expect(view.queryByRole("button", { name: "Expand all activity" })).toBeNull();
    expect(turnTrigger.getAttribute("aria-expanded")).toBe("true");
    expect(turnTrigger.querySelector(".animate-spin")).toBeNull();
    expect(turnTrigger.querySelectorAll("svg")).toHaveLength(1);
    await user.click(turnTrigger);
    expect(turnTrigger.getAttribute("aria-expanded")).toBe("false");
  });

  it("persists a manual expansion across remounts", async () => {
    window.localStorage.clear();
    const user = userEvent.setup();
    const part: PalotMessageContent = {
      type: "tool",
      id: "read",
      name: "read",
      state: { status: "completed" },
    };
    const source = message([part]);
    const turn = {
      id: "turn-1",
      user: null,
      users: [],
      activity: [
        {
          id: "tools",
          kind: "tools" as const,
          title: "Read files",
          status: "completed" as const,
          entries: [{ message: source, part, index: 0 }],
        },
      ],
      blockingRequests: [],
      final: {
        message: source,
        part: { type: "text", text: "Done" },
        index: 1,
      },
      postFinal: [],
      tokensPerSecond: null,
      status: "completed" as const,
      startedAt: 1,
      finalStartedAt: 2,
      workCompletedAt: 2,
      completedAt: 3,
      canCollapse: true,
      shouldAutoCollapse: true,
    };
    const props = {
      turn,
      sessionID: "session-1",
    };
    const first = render(<TurnActivity {...props} />);
    const trigger = first.container.querySelector<HTMLButtonElement>("button");
    expect(trigger).not.toBeNull();
    if (!trigger) return;
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    await user.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    first.unmount();

    const second = render(<TurnActivity {...props} />);
    expect(second.container.querySelector("button")?.getAttribute("aria-expanded")).toBe("true");
  });

  describe("group headers in a settled turn", () => {
    const base = { agent: null, model: null, tokens: null, text: null, data: {} };
    const prompt: PalotMessage = {
      ...base,
      id: "prompt",
      type: "user",
      createdAt: 1_000,
      completedAt: 1_000,
      finish: null,
      content: [{ type: "text", text: "Check the repo" }],
    };
    const shell = (id: string, command: string, failed = false): PalotMessageContent => ({
      type: "tool",
      id,
      name: "shell",
      state: failed
        ? { status: "error", input: { command }, error: "exit 1" }
        : { status: "completed", input: { command }, output: `${command} ok` },
    });
    const thought = (id: string, text: string): PalotMessageContent => ({
      type: "reasoning",
      id,
      text,
      time: { created: 2_000, completed: 2_100 },
    });
    const assistant = (
      id: string,
      content: PalotMessageContent[],
      options: { createdAt: number; running?: boolean },
    ): PalotMessage => ({
      ...base,
      id,
      type: "assistant",
      createdAt: options.createdAt,
      completedAt: options.running ? null : options.createdAt + 500,
      finish: options.running ? null : "tool-calls",
      content,
    });
    const answer: PalotMessage = {
      ...base,
      id: "answer",
      type: "assistant",
      createdAt: 9_000,
      completedAt: 9_500,
      finish: "stop",
      content: [{ type: "text", id: "answer-text", text: "All good." }],
    };
    const idle: PalotMessage = {
      ...base,
      id: "idle",
      type: "idle",
      createdAt: 10_000,
      completedAt: 10_000,
      finish: null,
      content: [],
      data: { outcome: "succeeded" },
    };
    const renderTurn = (messages: PalotMessage[], sessionID: string) => {
      const [row] = createSessionTranscriptProjector().project({ messages }).rows;
      const result = render(<TurnActivity turn={row!.turn} sessionID={sessionID} />);
      return { turn: row!.turn, view: within(result.container) };
    };
    const expandedButtons = (view: ReturnType<typeof within>) =>
      view
        .queryAllByRole("button")
        .filter((button: HTMLElement) => button.hasAttribute("aria-expanded"));

    it("shows a single group's commands one click after the turn bar", async () => {
      const user = userEvent.setup();
      const work = assistant(
        "work",
        [
          thought("t1", "Checking the tree"),
          shell("s1", "git status"),
          thought("t2", "Now the log"),
          shell("s2", "git log -1"),
          shell("s3", "ls"),
        ],
        { createdAt: 2_000 },
      );
      const { turn, view } = renderTurn([prompt, work, answer, idle], "session-flat-single");
      expect(turn.activity.filter((group) => group.kind === "tools")).toHaveLength(1);

      const bar = view.getByRole("button", { name: /^Worked for .* · ran 3 commands$/ });
      expect(view.queryByRole("button", { name: /Ran git status/ })).toBeNull();
      await user.click(bar);

      expect(view.queryByRole("button", { name: /^Ran 3 commands/ })).toBeNull();
      for (const command of ["git status", "git log -1", "ls"]) {
        expect(view.getByRole("button", { name: new RegExp(`Ran ${command}`) })).toBeTruthy();
      }
      // Every remaining disclosure controls content that exists.
      for (const button of expandedButtons(view)) {
        const controls = button.getAttribute("aria-controls");
        if (controls) expect(document.getElementById(controls)).not.toBeNull();
      }
    });

    it("flattens a small group and keeps a large group's collapsed header", async () => {
      const user = userEvent.setup();
      const small = assistant("small", [shell("a1", "git status"), shell("a2", "git diff")], {
        createdAt: 2_000,
      });
      const commentary = assistant(
        "commentary",
        [{ type: "text", id: "note", text: "Now the full test matrix." }],
        { createdAt: 3_000 },
      );
      const large = assistant(
        "large",
        [
          thought("p1", "Running the matrix"),
          ...["one", "two", "three", "four", "five"].map((name) =>
            shell(`b-${name}`, `bun test ${name}`),
          ),
        ],
        { createdAt: 4_000 },
      );
      large.content[0] = { ...large.content[0]!, presentation: "preamble" } as PalotMessageContent;
      const { turn, view } = renderTurn(
        [prompt, small, commentary, large, answer, idle],
        "session-flat-mixed",
      );
      const processGroups = turn.activity.filter((group) => group.kind === "tools");
      expect(processGroups).toHaveLength(2);

      await user.click(view.getByRole("button", { name: /^Worked for / }));

      expect(view.getByRole("button", { name: /Ran git status/ })).toBeTruthy();
      expect(view.getByRole("button", { name: /Ran git diff/ })).toBeTruthy();
      expect(view.getByText("Now the full test matrix.")).toBeTruthy();
      const header = view.getByRole("button", { name: processGroups[1]!.title });
      expect(header.getAttribute("aria-expanded")).toBe("false");
      expect(view.queryByRole("button", { name: /Ran bun test one/ })).toBeNull();

      await user.click(header);
      expect(view.getByRole("button", { name: /Ran bun test one/ })).toBeTruthy();
    });

    it("keeps a failed small group's failure visible without its header", async () => {
      const user = userEvent.setup();
      const failing = assistant("failing", [shell("f1", "bun test", true)], { createdAt: 2_000 });
      const recovery = assistant(
        "recovery",
        [
          thought("p1", "Fixing the test"),
          ...["one", "two", "three", "four"].map((name) => shell(`r-${name}`, `bun test ${name}`)),
        ],
        { createdAt: 3_000 },
      );
      recovery.content[0] = {
        ...recovery.content[0]!,
        presentation: "preamble",
      } as PalotMessageContent;
      const { view } = renderTurn([prompt, failing, recovery, answer, idle], "session-flat-failed");

      const bar = view.getByRole("button", { name: /^Worked for .* · 1 failed$/ });
      await user.click(bar);

      expect(view.queryByRole("button", { name: /· 1 failed$/ })).toBe(bar);
      const row = view.getByRole("button", { name: /bun test/ });
      expect(within(row).getByText("Failed")).toBeTruthy();
    });

    it("keeps a running turn's live group header", () => {
      const work = assistant("work", [shell("s1", "git status"), shell("s2", "git log -1")], {
        createdAt: 2_000,
        running: true,
      });
      work.content[1] = {
        type: "tool",
        id: "s2",
        name: "shell",
        state: { status: "running", input: { command: "git log -1" } },
      };
      const { turn, view } = renderTurn([prompt, work], "session-flat-running");
      expect(turn.status).toBe("working");
      const group = turn.activity.find((candidate) => candidate.kind === "tools")!;
      expect(group.headerless).toBeUndefined();
      expect(view.getByRole("button", { name: new RegExp(group.title) })).toBeTruthy();
    });

    it("keeps a lone command row's element when the turn settles and drops its header", () => {
      const running = assistant("work", [shell("s1", "git status")], {
        createdAt: 2_000,
        running: true,
      });
      running.content[0] = {
        type: "tool",
        id: "s1",
        name: "shell",
        state: { status: "running", input: { command: "git status" } },
      };
      const projector = createSessionTranscriptProjector();
      const turnOf = (messages: PalotMessage[]) => projector.project({ messages }).rows[0]!.turn;
      const working = turnOf([prompt, running]);
      const result = render(
        <TurnActivity turn={working} sessionID="session-flat-transition" preventAutoCollapse />,
      );
      const view = within(result.container);
      expect(
        view.getByRole("button", { name: new RegExp(working.activity[0]!.title) }),
      ).toBeTruthy();
      // The group header names the command too; the row comes after it.
      const row = view.getAllByRole("button", { name: /git status/ }).at(-1);

      const settled = turnOf([
        prompt,
        assistant("work", [shell("s1", "git status")], { createdAt: 2_000 }),
        answer,
        idle,
      ]);
      expect(settled.activity.find((group) => group.kind === "tools")?.headerless).toBe(true);
      result.rerender(
        <TurnActivity turn={settled} sessionID="session-flat-transition" preventAutoCollapse />,
      );

      expect(view.getByRole("button", { name: /Ran git status/ })).toBe(row);
    });
  });
});

describe("ThoughtDisclosure", () => {
  it("renders an explicit heading separately from the full reasoning body and duration", async () => {
    const user = userEvent.setup();
    const entry = reasoningEntry({
      type: "reasoning",
      id: "reasoning",
      text: "**Inspecting frontend and TUI code**\n\nComparing the two implementations.",
      time: { created: 10, completed: 17 },
    });

    render(<ThoughtDisclosure entry={entry} live={false} />);

    const trigger = screen.getByRole("button", {
      name: "Reasoning: Inspecting frontend and TUI code 7ms",
    });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    await user.click(trigger);
    expect(screen.getByText("Comparing the two implementations.")).toBeTruthy();
  });

  it("keeps a one-line running thought compact without a disclosure", () => {
    const store = createStore();
    const entry = reasoningEntry({
      type: "reasoning",
      id: "reasoning",
      text: "Inspecting the project.",
      time: { created: 10 },
    });
    const result = render(
      <Provider store={store}>
        <ThoughtDisclosure entry={entry} live />
      </Provider>,
    );

    expect(within(result.container).queryByRole("button")).toBeNull();
    expect(within(result.container).getByText("Reasoning: Inspecting the project.")).toBeTruthy();
    result.rerender(
      <Provider store={store}>
        <ThoughtDisclosure entry={entry} live defaultOpen />
      </Provider>,
    );
    expect(within(result.container).queryByRole("button")).toBeNull();
  });

  it("preserves explicit update and recap presentation labels", () => {
    const update = reasoningEntry({
      type: "reasoning",
      id: "update",
      text: "Inspecting the project.",
      presentation: "preamble",
    });
    const recap = reasoningEntry({
      type: "reasoning",
      id: "recap",
      text: "The implementation is understood.",
      presentation: "recap",
    });

    render(
      <>
        <ThoughtDisclosure entry={update} live={false} />
        <ThoughtDisclosure entry={recap} live={false} />
      </>,
    );

    expect(screen.getByText("Update: Inspecting the project.")).toBeTruthy();
    expect(screen.getByText("Recap: The implementation is understood.")).toBeTruthy();
  });
});
