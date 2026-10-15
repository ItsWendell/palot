import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import type { JsonValue, PalotMessage } from "../../../shared";
import { PlanCard, resetPlanDisclosuresForTest } from "./plan-card";

type Status = "pending" | "in_progress" | "completed" | "cancelled";

let messageSerial = 0;

function planCall(todos: Array<[string, Status]>, status = "completed"): PalotMessage {
  messageSerial += 1;
  return {
    id: `assistant-${messageSerial}`,
    type: "assistant",
    createdAt: messageSerial,
    completedAt: messageSerial,
    text: null,
    agent: "build",
    model: null,
    tokens: null,
    finish: "tool-calls",
    content: [
      {
        type: "tool",
        id: `todo-${messageSerial}`,
        name: "todowrite",
        state: {
          status,
          input: {
            todos: todos.map(([content, state], index) => ({
              id: `${index + 1}`,
              content,
              status: state,
              priority: "high",
            })),
          },
        } as JsonValue,
      },
    ],
    data: null,
  };
}

const ACTIVE: Array<[string, Status]> = [
  ["Read the reducer", "completed"],
  ["Map compaction events", "completed"],
  ["Render the rows", "completed"],
  ["Write tests", "in_progress"],
  ["Update E2E", "pending"],
  ["Document the change", "pending"],
  ["Drop the legacy path", "cancelled"],
  ["Run checks", "pending"],
];

afterEach(() => {
  cleanup();
  resetPlanDisclosuresForTest();
});

describe("PlanCard", () => {
  it("is hidden without a plan, or when the latest call cleared it", () => {
    const view = render(<PlanCard sessionID="session" messages={[]} />);
    expect(screen.queryByRole("region", { name: "Plan" })).toBeNull();
    view.rerender(<PlanCard sessionID="session" messages={[planCall(ACTIVE), planCall([])]} />);
    expect(screen.queryByRole("region", { name: "Plan" })).toBeNull();
  });

  it("counts done items, excludes cancelled ones, and lists every status", () => {
    render(<PlanCard sessionID="session" messages={[planCall(ACTIVE)]} />);
    const card = within(screen.getByRole("region", { name: "Plan" }));
    const trigger = card.getByRole("button", { name: /Plan · 3\/7 done/ });
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(card.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("43");

    const items = card.getAllByRole("listitem");
    expect(items.map((item) => item.textContent)).toEqual([
      "Read the reducerDone",
      "Map compaction eventsDone",
      "Render the rowsDone",
      "Write testsIn progress",
      "Update E2EPending",
      "Document the changePending",
      "Drop the legacy pathCancelled",
      "Run checksPending",
    ]);
  });

  it("follows the newest plan call and ignores one whose input is still streaming", () => {
    const streaming = planCall([], "streaming");
    streaming.content[0]!.state = { status: "streaming", input: '{"todos":[' };
    render(
      <PlanCard
        sessionID="session"
        messages={[planCall([["Old step", "pending"]]), planCall(ACTIVE), streaming]}
      />,
    );
    expect(screen.getByRole("button", { name: /Plan · 3\/7 done/ })).toBeTruthy();
    expect(screen.queryByText("Old step")).toBeNull();
  });

  it("auto-collapses when everything is done and remembers a manual choice per task", async () => {
    const user = userEvent.setup();
    const done = ACTIVE.map(([content, status]): [string, Status] => [
      content,
      status === "cancelled" ? status : "completed",
    ]);
    const view = render(<PlanCard sessionID="session" messages={[planCall(ACTIVE)]} />);
    const trigger = () => screen.getByRole("button", { name: /^Plan · / });

    await user.click(trigger());
    expect(trigger().getAttribute("aria-expanded")).toBe("false");
    // Collapsed, the header names the step in progress.
    expect(trigger().textContent).toContain("Write tests");

    view.unmount();
    const remounted = render(<PlanCard sessionID="session" messages={[planCall(ACTIVE)]} />);
    expect(trigger().getAttribute("aria-expanded")).toBe("false");

    await user.click(trigger());
    expect(trigger().getAttribute("aria-expanded")).toBe("true");
    remounted.rerender(<PlanCard sessionID="session" messages={[planCall(done)]} />);
    expect(trigger().getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByRole("button", { name: /Plan · 7\/7 done/ })).toBeTruthy();
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("100");

    remounted.unmount();
    render(<PlanCard sessionID="other" messages={[planCall(ACTIVE)]} />);
    expect(trigger().getAttribute("aria-expanded")).toBe("true");
  });
});
