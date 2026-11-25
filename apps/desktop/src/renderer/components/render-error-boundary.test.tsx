import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
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

it("keeps a healthy route mounted when the workspace location changes", () => {
  const mounts = vi.fn();
  function Route({ label }: { label: string }) {
    useEffect(() => mounts(), []);
    return <p>{label}</p>;
  }
  const view = render(
    <RenderErrorBoundary resetKey="/sessions/a">
      <Route label="Task A" />
    </RenderErrorBoundary>,
  );
  view.rerender(
    <RenderErrorBoundary resetKey="/sessions/b">
      <Route label="Task B" />
    </RenderErrorBoundary>,
  );
  expect(screen.getByText("Task B")).toBeTruthy();
  expect(mounts).toHaveBeenCalledTimes(1);
});

it("clears a failure when the workspace location changes", () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  function Route({ broken }: { broken: boolean }) {
    if (broken) throw new Error("The route failed");
    return <p>Next route</p>;
  }
  const view = render(
    <RenderErrorBoundary resetKey="/sessions/a">
      <Route broken />
    </RenderErrorBoundary>,
  );
  expect(screen.getByRole("heading", { name: "Something went wrong" })).toBeTruthy();
  view.rerender(
    <RenderErrorBoundary resetKey="/sessions/a">
      <Route broken={false} />
    </RenderErrorBoundary>,
  );
  expect(screen.getByRole("heading", { name: "Something went wrong" })).toBeTruthy();
  view.rerender(
    <RenderErrorBoundary resetKey="/sessions/b">
      <Route broken={false} />
    </RenderErrorBoundary>,
  );
  expect(screen.getByText("Next route")).toBeTruthy();
});
