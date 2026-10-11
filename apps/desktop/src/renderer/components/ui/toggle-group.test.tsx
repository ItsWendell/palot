import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, expect, it } from "vitest";
import { ToggleGroup, ToggleGroupItem } from "./toggle-group";

afterEach(cleanup);

function Segmented() {
  const [mode, setMode] = useState("working");
  return (
    <ToggleGroup
      variant="segmented"
      size="sm"
      aria-label="Review scope"
      value={[mode]}
      onValueChange={(value) => {
        if (typeof value[0] === "string") setMode(value[0]);
      }}
    >
      <ToggleGroupItem value="working">Working</ToggleGroupItem>
      <ToggleGroupItem value="branch">Branch</ToggleGroupItem>
    </ToggleGroup>
  );
}

it("segmented groups expose one pressed toggle and keep a choice when it is pressed again", async () => {
  const user = userEvent.setup();
  render(<Segmented />);
  const group = screen.getByRole("group", { name: "Review scope" });
  const working = screen.getByRole("button", { name: "Working" });
  const branch = screen.getByRole("button", { name: "Branch" });
  expect(working.getAttribute("aria-pressed")).toBe("true");
  expect(branch.getAttribute("aria-pressed")).toBe("false");

  await user.click(branch);
  expect(branch.getAttribute("aria-pressed")).toBe("true");
  expect(working.getAttribute("aria-pressed")).toBe("false");

  await user.click(branch);
  expect(branch.getAttribute("aria-pressed")).toBe("true");

  // Arrow keys rove between segments; the hover pill follows focus.
  await user.keyboard("{ArrowLeft}");
  expect(document.activeElement).toBe(working);
  await waitFor(() => expect(group.getAttribute("data-fluid-hover-active-index")).toBe("0"));
});
