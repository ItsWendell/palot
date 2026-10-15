import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CompactionUsage } from "./compaction-usage";

describe("CompactionUsage", () => {
  it("summarizes the compaction request and keeps the breakdown in its tooltip", () => {
    render(
      <CompactionUsage
        part={{
          type: "compaction",
          cost: 0.012345,
          tokens: { input: 1200, output: 100, reasoning: 20, cache: { read: 800, write: 40 } },
        }}
      />,
    );
    const usage = screen.getByText("Summarizing used 2.2k tokens · $0.01");
    expect(usage.getAttribute("title")).toBe(
      "1,240 uncached input · 800 cached input · 120 output",
    );
  });

  it("shows sub-cent and zero cost without inventing missing token usage", () => {
    const { rerender } = render(
      <CompactionUsage part={{ type: "compaction", status: "failed", cost: 0 }} />,
    );
    expect(screen.getByText("Summarizing used $0.00")).toBeTruthy();
    rerender(<CompactionUsage part={{ type: "compaction", cost: 0.0042 }} />);
    expect(screen.getByText("Summarizing used $0.0042")).toBeTruthy();
  });

  it("does not invent usage for older messages", () => {
    const { container } = render(<CompactionUsage part={{ type: "compaction" }} />);
    expect(container.textContent).toBe("");
  });
});
