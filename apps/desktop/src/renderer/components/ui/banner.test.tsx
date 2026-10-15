import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { Banner } from "./banner";

afterEach(() => {
  cleanup();
  delete document.documentElement.dataset.reducedMotion;
});

it("interrupts for errors and warnings and waits its turn otherwise", () => {
  render(
    <>
      <Banner status="error" title="Install failed">
        The CLI exited with code 1.
      </Banner>
      <Banner status="warning" title="Untested release" />
      <Banner status="info" title="Restart to apply" />
      <Banner title="Heads up" />
    </>,
  );
  expect(screen.getByRole("alert", { name: "Install failed" }).textContent).toContain(
    "The CLI exited with code 1.",
  );
  expect(screen.getByRole("alert", { name: "Untested release" })).toBeTruthy();
  expect(screen.getByRole("status", { name: "Restart to apply" })).toBeTruthy();
  expect(screen.getByRole("status", { name: "Heads up" })).toBeTruthy();
});

it("hides itself when dismissed and reports the dismissal", async () => {
  document.documentElement.dataset.reducedMotion = "true";
  const user = userEvent.setup();
  const onDismiss = vi.fn();
  render(
    <Banner
      status="success"
      title="Connected"
      dismissible
      onDismiss={onDismiss}
      actions={<button type="button">Open</button>}
    />,
  );
  expect(screen.getByRole("button", { name: "Open" })).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Dismiss" }));
  expect(onDismiss).toHaveBeenCalledOnce();
  await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
});

it("follows a controlled open prop through its exit motion", async () => {
  const user = userEvent.setup();
  function Controlled() {
    const [open, setOpen] = useState(true);
    return (
      <>
        <Banner
          status="error"
          title="Failed"
          open={open}
          dismissible
          onDismiss={() => setOpen(false)}
        />
        <button type="button" onClick={() => setOpen(true)}>
          Retry
        </button>
      </>
    );
  }
  render(<Controlled />);
  await user.click(screen.getByRole("button", { name: "Dismiss" }));
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  // Focus inside the closing banner moved on instead of falling back to the body.
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Retry" }));
  await user.click(screen.getByRole("button", { name: "Retry" }));
  expect(screen.getByRole("alert", { name: "Failed" })).toBeTruthy();
});
