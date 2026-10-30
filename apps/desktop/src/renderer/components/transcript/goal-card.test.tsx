import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "jotai";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionGoal } from "../../lib/session-goal";
import { palot } from "../../services/palot";
import { GoalCard } from "./goal-card";

const state = vi.hoisted(() => ({ goal: null as SessionGoal | null }));
vi.mock("../../hooks/use-session-goal", () => ({ useSessionGoal: () => state.goal }));

const goal = (overrides: Partial<SessionGoal> = {}): SessionGoal => ({
  id: "goal-1",
  objective: "Make the integration tests pass",
  status: "active",
  reason: "Two tests still fail.",
  rounds: 3,
  maxRounds: 50,
  updatedAt: Date.now(),
  ...overrides,
});

function renderCard() {
  return render(
    <Provider>
      <GoalCard sessionID="s1" location={{ directory: "/repo" }} />
    </Provider>,
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  state.goal = null;
});

describe("GoalCard", () => {
  it("shows nothing without a goal", () => {
    const { container } = renderCard();
    expect(container.textContent).toBe("");
  });

  it("names a running goal with its round and objective, and pauses it", async () => {
    const run = vi.spyOn(palot, "runCommand").mockResolvedValue(undefined);
    state.goal = goal();
    renderCard();
    const card = screen.getByRole("region", { name: "Goal" });
    expect(card.textContent).toContain("Pursuing goal");
    expect(card.textContent).toContain("round 3 of 50");
    expect(card.textContent).toContain("Make the integration tests pass");
    await userEvent.click(screen.getByRole("button", { name: "Pause goal" }));
    await waitFor(() =>
      expect(run).toHaveBeenCalledWith(
        { sessionID: "s1", command: "goal", arguments: "pause" },
        undefined,
      ),
    );
  });

  it("leads a paused goal with why it paused, and resumes it", async () => {
    const run = vi.spyOn(palot, "runCommand").mockResolvedValue(undefined);
    state.goal = goal({ status: "paused", reason: "Not making progress: tests still fail" });
    renderCard();
    const card = screen.getByRole("region", { name: "Goal" });
    expect(card.textContent).toContain("Goal paused");
    expect(card.textContent).toContain("Not making progress: tests still fail");
    expect(card.textContent).not.toContain("round 3");
    await userEvent.click(screen.getByRole("button", { name: "Resume goal" }));
    await waitFor(() =>
      expect(run).toHaveBeenCalledWith(
        { sessionID: "s1", command: "goal", arguments: "resume" },
        undefined,
      ),
    );
  });

  it("keeps a met goal with the reviewer's reason until it is dismissed", async () => {
    const run = vi.spyOn(palot, "runCommand").mockResolvedValue(undefined);
    state.goal = goal({ status: "complete", reason: "All 42 tests pass." });
    renderCard();
    expect(screen.getByRole("region", { name: "Goal" }).textContent).toContain("Goal met");
    expect(screen.queryByRole("button", { name: /Pause|Resume/ })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /Goal met/ }));
    expect(await screen.findByText("Reviewer: All 42 tests pass.")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    await waitFor(() =>
      expect(run).toHaveBeenCalledWith(
        { sessionID: "s1", command: "goal", arguments: "clear" },
        undefined,
      ),
    );
  });
});
