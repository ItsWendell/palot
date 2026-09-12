import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SessionRoutePending } from "../components/session-route-pending";

describe("SessionRoutePending", () => {
  afterEach(cleanup);

  it("keeps loading confined to an empty task transcript surface", () => {
    render(<SessionRoutePending />);

    const surface = screen.getByLabelText("Loading task transcript");
    expect(surface.getAttribute("aria-busy")).toBe("true");
    expect(screen.queryByRole("status")).toBeNull();
  });
});
