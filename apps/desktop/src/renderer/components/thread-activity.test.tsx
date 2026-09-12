import { Provider, createStore } from "jotai";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { PalotMessage, PalotMessageContent } from "../../shared";
import type { TurnActivityGroup, TurnPart } from "../lib/turn-projection";
import {
  ActivityGroup,
  CompactionBoundary,
  ThoughtDisclosure,
  TimelineBoundary,
  TurnActivity,
} from "./thread";

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

  it("keeps failed activity accessible without a visible failed chip", () => {
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
      title: "Running tests",
      status: "failed",
      entries: parts.map((part, index) => ({ message: source, part, index })),
    };

    render(<ActivityGroup group={group} live />);

    const trigger = screen.getByRole("button", {
      name: "Running tests Failed",
    });
    expect(trigger.querySelector('[data-slot="badge"]')).toBeNull();
    expect(screen.getByText("Failed", { selector: ".sr-only" })).toBeTruthy();
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

    const trigger = screen.getByRole("button", { name: "Reasoning · 3 steps · 33.5s" });
    expect(
      screen.queryByRole("button", { name: /Reasoning: Evaluating database options/ }),
    ).toBeNull();
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("Evaluating database options")).toBeTruthy();
    expect(screen.getByText("Designing shared database services")).toBeTruthy();
    expect(screen.getAllByText("Planning middleware layering")).toHaveLength(2);
    await user.click(trigger);
    expect(
      screen.getByRole("button", {
        name: "Reasoning: Planning middleware layering · 3 steps · 33.5s",
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
    const trigger = boundary.getByRole("button", { name: "Compaction completed" });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(boundary.queryByText("Compacted summary")).toBeNull();
    expect(boundary.queryByText("Recent context preserved")).toBeNull();
    await user.click(trigger);
    expect(boundary.getByText("Compacted summary")).toBeTruthy();
    expect(boundary.getByText(/Compaction request:.*0\.001/)).toBeTruthy();
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
    const trigger = boundary.getByRole("button", { name: "Compacting..." });
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
    const trigger = boundary.getByRole("button", { name: "Compaction failed" });
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
    expect(boundary.getByRole("button", { name: "Compaction completed" })).toBeTruthy();
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
        .getByRole("button", { name: "Running 'bun test' Failed" })
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
    const trigger = view.getByRole("button", { name: "Worked for 1s" });

    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(view.getByText("Pinned companion")).toBeTruthy();
    expect(view.queryByText("Hidden companion work")).toBeNull();

    await user.click(trigger);

    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(view.getByText("Hidden companion work")).toBeTruthy();
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

    const turnTrigger = screen.getByRole("button", { name: "Completed in 1s" });
    expect(turnTrigger.getAttribute("aria-expanded")).toBe("false");
    await user.click(turnTrigger);

    const groupTrigger = screen.getByRole("button", { name: "Read files" });
    expect(groupTrigger.getAttribute("aria-expanded")).toBe("false");
    await user.click(groupTrigger);
    expect(groupTrigger.getAttribute("aria-expanded")).toBe("true");
    await user.click(groupTrigger);
    expect(groupTrigger.getAttribute("aria-expanded")).toBe("false");
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
    await user.click(view.getByRole("button", { name: "Worked for 1s" }));
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
