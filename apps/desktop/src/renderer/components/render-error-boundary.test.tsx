import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { RenderErrorBoundary } from "./render-error-boundary";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it("contains a descendant failure and copies the error and component details", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  function Broken(): never {
    throw new Error("The route failed");
  }
  render(
    <>
      <nav>Sidebar survives</nav>
      <RenderErrorBoundary>
        <Broken />
      </RenderErrorBoundary>
    </>,
  );
  expect(screen.getByText("Sidebar survives")).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Something went wrong" })).toBeTruthy();
  expect(screen.getByText("The route failed")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Copy details" }));
  await waitFor(() =>
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("The route failed")),
  );
  expect(writeText.mock.calls[0]![0]).toContain("Broken");
  expect(screen.getByRole("button", { name: "Reload view" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Open diagnostics" })).toBeTruthy();
});
