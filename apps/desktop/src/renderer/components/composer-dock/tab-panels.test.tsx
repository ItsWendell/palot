import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { BackgroundWorkPanel, GoalPanel, PlanPanel, UndoStagedPanel } from "./tab-panels";

afterEach(cleanup);

it("shows the plan's progress and names each step's state", () => {
  render(
    <PlanPanel
      items={[
        { text: "Reproduce", status: "done" },
        { text: "Run the suite", active: "Running the suite", status: "running" },
        { text: "Write the changelog", status: "pending" },
      ]}
    />,
  );
  expect(
    screen.getByRole("progressbar", { name: "Plan progress" }).getAttribute("aria-valuenow"),
  ).toBe("1");
  expect(screen.getByText("1 of 3 done")).toBeTruthy();
  expect(screen.getByText("Running the suite")).toBeTruthy();
  expect(screen.getByRole("img", { name: "In progress" })).toBeTruthy();
});

it("offers Pause while pursuing a goal, Resume when paused and Dismiss once met", async () => {
  const onPause = vi.fn();
  const user = userEvent.setup();
  const goal = { objective: "Ship it", round: 2, rounds: 5 };
  const { rerender } = render(<GoalPanel goal={{ ...goal, status: "active" }} onPause={onPause} />);
  expect(screen.getByText("Pursuing goal · round 2 of 5")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Pause goal" }));
  expect(onPause).toHaveBeenCalled();
  rerender(<GoalPanel goal={{ ...goal, status: "paused" }} />);
  expect(screen.getByRole("button", { name: "Resume goal" })).toBeTruthy();
  rerender(<GoalPanel goal={{ ...goal, status: "complete" }} />);
  expect(screen.getByRole("button", { name: "Dismiss goal" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Pause goal" })).toBeNull();
});

it("stops one piece of background work, or all of it", async () => {
  const onStop = vi.fn();
  const onStopAll = vi.fn();
  const user = userEvent.setup();
  render(
    <BackgroundWorkPanel
      items={[
        { id: "a", kind: "command", label: "bun test", elapsed: "42s" },
        { id: "b", kind: "agent", label: "explore", elapsed: "1m 5s" },
        { id: "c", kind: "terminal", label: "vp dev", finished: true },
      ]}
      onStop={onStop}
      onStopAll={onStopAll}
    />,
  );
  await user.click(screen.getByRole("button", { name: "Stop bun test" }));
  expect(onStop).toHaveBeenCalledWith("a");
  expect(screen.getByText("Finished")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Stop all" }));
  expect(onStopAll).toHaveBeenCalled();
});

it("lists the staged files with Restore and Finalize undo", async () => {
  const onRestore = vi.fn();
  const user = userEvent.setup();
  render(<UndoStagedPanel files={["a.ts", "b.ts"]} onRestore={onRestore} />);
  expect(screen.getAllByRole("listitem").map((item) => item.textContent)).toEqual(["a.ts", "b.ts"]);
  await user.click(screen.getByRole("button", { name: "Restore" }));
  expect(onRestore).toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Finalize undo" })).toBeTruthy();
});
