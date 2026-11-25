import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { runningLocalTasks } from "../lib/running-local-tasks";
import { SharedOpenCodeAction } from "./opencode-connection-alert";

type Overview = Parameters<typeof runningLocalTasks>[0][number];

const state = vi.hoisted(() => ({ connections: [] as unknown[] }));
vi.mock("../lib/connection-overview", () => ({
  connectionOverview: () => ({ getSnapshot: () => state.connections }),
}));

afterEach(() => {
  cleanup();
  state.connections = [];
});

function row(id: string, title: string | null, running: boolean) {
  return { session: { id, title }, running };
}

function connection(kind: "local" | "remote", rows: ReturnType<typeof row>[]): Overview {
  return {
    profile: { id: kind, kind, name: kind },
    inbox: { pinned: [], inbox: rows, snoozed: [], settled: [], nextSnoozeDeadline: null },
  } as unknown as Overview;
}

it("counts only working tasks on the local service, once each", () => {
  const tasks = runningLocalTasks([
    connection("local", [
      row("ses_a", "Fix login", true),
      row("ses_b", "Idle task", false),
      row("ses_c", null, true),
    ]),
    connection("remote", [row("ses_r", "Remote run", true)]),
  ]);
  expect(tasks).toEqual([
    { id: "ses_a", title: "Fix login" },
    { id: "ses_c", title: "Untitled task" },
  ]);
});

it("names the working tasks a restart would stop before it runs", () => {
  state.connections = [
    connection(
      "local",
      Array.from({ length: 7 }, (_, index) => row(`ses_${index}`, `Task ${index + 1}`, true)),
    ),
  ];
  const onConfirm = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <SharedOpenCodeAction action="restart" onConfirm={onConfirm} />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Restart service" }));
  const warning = screen.getByRole("alert");
  expect(warning.textContent).toContain("7 tasks are working; restarting stops them.");
  expect(warning.textContent).toContain("Task 5");
  expect(warning.textContent).not.toContain("Task 6");
  expect(warning.textContent).toContain("and 2 more");
  fireEvent.click(screen.getByRole("button", { name: "Restart anyway" }));
  expect(onConfirm).toHaveBeenCalledOnce();
});

it("keeps the plain confirmation when nothing is working", () => {
  state.connections = [connection("local", [row("ses_a", "Done", false)])];
  render(
    <QueryClientProvider client={new QueryClient()}>
      <SharedOpenCodeAction action="restart" onConfirm={vi.fn()} />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Restart service" }));
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.getByRole("button", { name: "Restart" })).toBeTruthy();
});
