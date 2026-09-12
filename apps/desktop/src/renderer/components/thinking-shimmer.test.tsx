import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ThinkingShimmer } from "./thinking-shimmer";

describe("ThinkingShimmer", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps remounted shimmers on the shared document timeline", () => {
    let now = 250;
    vi.spyOn(performance, "now").mockImplementation(() => now);

    const first = render(<ThinkingShimmer>Thinking</ThinkingShimmer>);
    expect(first.getByText("Thinking").style.animationDelay).toBe("-250ms");
    first.unmount();

    now = 950;
    const second = render(<ThinkingShimmer>Thinking</ThinkingShimmer>);
    expect(second.getByText("Thinking").style.animationDelay).toBe("-950ms");
  });
});
