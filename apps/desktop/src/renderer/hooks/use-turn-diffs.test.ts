import { expect, it, vi } from "vitest";
import { turnDiffsQueryOptions } from "./use-turn-diffs";

const mocks = vi.hoisted(() => ({ listTurnDiffs: vi.fn().mockResolvedValue([]) }));
vi.mock("../services/palot", () => ({ palot: mocks }));
vi.mock("../atoms/workspace", () => ({ runtimeAtom: {} }));

it("scopes requests to connection, session and user message without a turn end", async () => {
  const first = turnDiffsQueryOptions("connection-1", "session-1", "user-1");
  expect(first.queryKey).not.toEqual(
    turnDiffsQueryOptions("connection-2", "session-1", "user-1").queryKey,
  );
  expect(first.queryKey).not.toEqual(
    turnDiffsQueryOptions("connection-1", "session-2", "user-1").queryKey,
  );
  expect(first.queryKey).not.toEqual(
    turnDiffsQueryOptions("connection-1", "session-1", "user-2").queryKey,
  );
  const signal = new AbortController().signal;
  await first.queryFn!({ signal } as never);
  expect(mocks.listTurnDiffs).toHaveBeenCalledWith("session-1", "user-1", signal, "connection-1");
});

it("caches a context request apart from the full-file patches", async () => {
  const full = turnDiffsQueryOptions("connection-1", "session-1", "user-1");
  const compact = turnDiffsQueryOptions("connection-1", "session-1", "user-1", 3);
  expect(compact.queryKey).not.toEqual(full.queryKey);
  const signal = new AbortController().signal;
  await compact.queryFn!({ signal } as never);
  expect(mocks.listTurnDiffs).toHaveBeenLastCalledWith(
    "session-1",
    "user-1",
    signal,
    "connection-1",
    3,
  );
});
