import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CopyField } from "./copy-field";

let clipboard: ReturnType<typeof vi.fn>;

beforeEach(() => {
  clipboard = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(window, "palot", {
    configurable: true,
    value: { writeClipboardText: clipboard },
  });
});

afterEach(cleanup);

it("copies the full value and announces the result", async () => {
  const user = userEvent.setup();
  const onCopy = vi.fn();
  const value = "/home/user/projects/a-very-long/path/to/the/worktree";
  render(<CopyField label="Worktree path" value={value} onCopy={onCopy} />);
  expect(screen.getByRole("group", { name: "Worktree path" })).toBeTruthy();
  expect(screen.getByText(value).getAttribute("title")).toBe(value);

  await user.click(screen.getByRole("button", { name: "Copy Worktree path" }));
  expect(clipboard).toHaveBeenCalledWith(value);
  await waitFor(() => expect(onCopy).toHaveBeenCalledOnce());
  expect(screen.getByText("Copied")).toBeTruthy();
});

it("conceals a secret until revealed and still copies the real value", async () => {
  const user = userEvent.setup();
  render(<CopyField label="API key" value="sk-secret-123" secret />);
  expect(screen.queryByText("sk-secret-123")).toBeNull();
  const reveal = screen.getByRole("button", { name: "Show API key" });
  expect(reveal.getAttribute("aria-pressed")).toBe("false");

  await user.click(screen.getByRole("button", { name: "Copy API key" }));
  expect(clipboard).toHaveBeenCalledWith("sk-secret-123");

  await user.click(reveal);
  expect(reveal.getAttribute("aria-pressed")).toBe("true");
  expect(screen.getByText("sk-secret-123")).toBeTruthy();
  await user.click(reveal);
  expect(screen.queryByText("sk-secret-123")).toBeNull();
});
