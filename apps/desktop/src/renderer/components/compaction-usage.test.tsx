import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CompactionUsage } from "./compaction-usage";

describe("CompactionUsage", () => {
  it("labels request usage separately from the resulting context", () => {
    render(
      <CompactionUsage
        part={{
          type: "compaction",
          cost: 0.012345,
          tokens: { input: 1200, output: 100, reasoning: 20, cache: { read: 800, write: 40 } },
        }}
      />,
    );
    const usage = screen.getByText(/Compaction request tokens:/);
    expect(usage.textContent).toContain("$0.012345");
    expect(usage.textContent).toContain("1,200 input · 100 output · 20 reasoning");
    expect(usage.textContent).toContain("800 cache read · 40 cache write");
  });

  it("shows zero cost without inventing missing token usage", () => {
    render(<CompactionUsage part={{ type: "compaction", status: "failed", cost: 0 }} />);
    expect(screen.getByText("Compaction request: $0.00")).toBeTruthy();
  });

  it("does not invent usage for older messages", () => {
    const { container } = render(<CompactionUsage part={{ type: "compaction" }} />);
    expect(container.textContent).toBe("");
  });
});
