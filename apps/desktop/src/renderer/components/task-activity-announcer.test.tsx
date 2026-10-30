import { act, cleanup, render, screen } from "@testing-library/react";
import { Provider, createStore } from "jotai";
import { afterEach, expect, it, vi } from "vitest";
import { TaskActivityAnnouncer } from "./task-activity-announcer";

const state = vi.hoisted(() => ({ running: false, attention: false, failed: false }));
vi.mock("../atoms/workspace", async () => {
  const { atom } = await import("jotai");
  return { selectedSessionIDAtom: atom("open"), runtimeAtom: atom({ connectionID: "one" }) };
});
vi.mock("../hooks/use-session-inbox", () => ({
  useSessionInbox: () => ({
    pinned: [],
    snoozed: [],
    settled: [],
    inbox: [{ session: { id: "open", title: "Open title" }, ...state }],
  }),
}));
vi.mock("../hooks/use-connection-overview", () => ({
  useConnectionOverview: () => ({ connections: [], includedProfileIDs: [] }),
}));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  state.running = state.attention = state.failed = false;
});
it("coalesces lifecycle changes without delaying announcements for streaming rerenders or replaying on navigation", () => {
  vi.useFakeTimers();
  const store = createStore();
  const view = () => (
    <Provider store={store}>
      <TaskActivityAnnouncer sessionID="open" />
    </Provider>
  );
  const { rerender } = render(view());
  expect(screen.getByRole("status").textContent).toBe("");
  state.running = true;
  rerender(view());
  act(() => vi.advanceTimersByTime(200));
  rerender(view());
  act(() => vi.advanceTimersByTime(150));
  expect(screen.getByRole("status").textContent).toBe("Open task: started working.");
  state.running = false;
  state.attention = true;
  rerender(view());
  state.attention = false;
  state.failed = true;
  rerender(view());
  act(() => vi.advanceTimersByTime(350));
  expect(screen.getByRole("status").textContent).toBe("Open task: failed.");
  rerender(
    <Provider store={store}>
      <TaskActivityAnnouncer sessionID={null} />
    </Provider>,
  );
  expect(screen.getByRole("status").textContent).toBe("Open task: failed.");
});
it("drops background attention that resolves before the debounce instead of announcing stale requests", () => {
  vi.useFakeTimers();
  const { rerender } = render(
    <Provider>
      <TaskActivityAnnouncer sessionID={null} />
    </Provider>,
  );
  state.attention = true;
  rerender(
    <Provider>
      <TaskActivityAnnouncer sessionID={null} />
    </Provider>,
  );
  act(() => vi.advanceTimersByTime(100));
  state.attention = false;
  state.running = true;
  rerender(
    <Provider>
      <TaskActivityAnnouncer sessionID={null} />
    </Provider>,
  );
  act(() => vi.advanceTimersByTime(250));
  expect(screen.getByRole("status").textContent).toBe("");
  state.running = false;
  state.failed = true;
  rerender(
    <Provider>
      <TaskActivityAnnouncer sessionID={null} />
    </Provider>,
  );
  act(() => vi.advanceTimersByTime(350));
  expect(screen.getByRole("status").textContent).toBe("Open title: failed.");
});
