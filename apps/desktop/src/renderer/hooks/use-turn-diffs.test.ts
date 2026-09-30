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
