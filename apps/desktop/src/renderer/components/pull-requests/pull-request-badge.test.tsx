import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PullRequestBadge } from "./pull-request-badge";
import { pullRequestLink } from "./test-fixtures";

afterEach(cleanup);

describe("PullRequestBadge", () => {
  it.each([
    ["open", "Pull request #7, open, checks passing"],
    ["draft", "Pull request #7, draft, checks passing"],
    ["merged", "Pull request #7, merged, checks passing"],
    ["closed", "Pull request #7, closed, checks passing"],
  ] as const)("labels a %s pull request with its number and checks", (state, label) => {
    render(<PullRequestBadge links={[pullRequestLink("s1", 7, { pullRequest: { state } })]} />);
    const badge = screen.getByRole("img", { name: label });
    expect(badge.getAttribute("data-pull-request-badge")).toBe(state);
    expect(badge.textContent).toBe("#7");
  });

  it("marks failing checks, conflicts, review decisions, and an active watch", () => {
    render(
      <PullRequestBadge
        links={[
          pullRequestLink("s1", 12, {
            watch: { startedAt: 1, commentWakes: 0, readFailures: 0, lastWakeAt: null },
            pullRequest: {
              checks: "failing",
              mergeable: "conflicting",
              reviewDecision: "changes-requested",
            },
          }),
        ]}
      />,
    );
    const badge = screen.getByRole("img", {
      name: "Pull request #12, open, checks failing, changes requested, has conflicts, watching",
    });
    expect(badge.getAttribute("data-checks")).toBe("failing");
    expect(badge.hasAttribute("data-watching")).toBe(true);
  });

  it("prefers open work when a task links several pull requests", () => {
    render(
      <PullRequestBadge
        links={[
          pullRequestLink("s1", 3, { pullRequest: { state: "merged", updatedAt: 50 } }),
          pullRequestLink("s1", 4, { pullRequest: { state: "open", updatedAt: 10 } }),
        ]}
      />,
    );
    const badge = screen.getByRole("img", { name: /#4, open.*and 1 more linked/ });
    expect(badge.textContent).toBe("#4+1");
  });

  it("renders nothing without links and forwards clicks for pointer-inert rows", () => {
    const { container, rerender } = render(<PullRequestBadge links={undefined} />);
    expect(container.textContent).toBe("");
    const onActivate = vi.fn();
    rerender(<PullRequestBadge links={[pullRequestLink("s1", 1)]} onActivate={onActivate} />);
    fireEvent.click(screen.getByRole("img"));
    expect(onActivate).toHaveBeenCalledTimes(1);
  });
});
