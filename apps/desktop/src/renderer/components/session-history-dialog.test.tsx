import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import type { PalotMessage } from "../../shared";
import { SessionHistoryDialog } from "./session-history-dialog";
import { adjacentPromptID } from "../lib/session-history";

afterEach(cleanup);
it("searches newly loaded prompts without claiming partial history is complete", async () => {
  const user = userEvent.setup();
  const select = vi.fn();
  const load = vi.fn();
  const props = {
    mode: "timeline" as const,
    onClose: vi.fn(),
    onSelect: select,
    hasMore: true,
    loading: false,
    error: false,
    onLoadMore: load,
  };
  const message = (id: string, text: string) =>
    ({ id, text, type: "user", createdAt: 1 }) as PalotMessage;
  const view = render(
    <SessionHistoryDialog {...props} messages={[message("new", "New prompt")]} />,
  );
  await user.type(screen.getByRole("textbox", { name: "Search prompts" }), "needle");
  expect(
    screen.getByText("No matching loaded prompts. Load earlier history to search more."),
  ).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Load earlier prompts" }));
  expect(load).toHaveBeenCalledOnce();
  view.rerender(
    <SessionHistoryDialog {...props} loading messages={[message("new", "New prompt")]} />,
  );
  expect(screen.getByRole("status").textContent).toBe("Loading earlier prompts…");
  const older = message("old", "The needle is here");
  view.rerender(
    <SessionHistoryDialog
      {...props}
      hasMore={false}
      messages={[older, message("new", "New prompt")]}
    />,
  );
  await user.click(screen.getByRole("button", { name: /The needle is here/ }));
  expect(select).toHaveBeenCalledWith(older);
});
it("does not wrap turn navigation and resolves IDs after a prepend", () => {
  expect(adjacentPromptID(["b", "c"], "b", "previous")).toBeNull();
  expect(adjacentPromptID(["a", "b", "c"], "b", "previous")).toBe("a");
  expect(adjacentPromptID(["a", "b", "c"], "c", "next")).toBeNull();
});
