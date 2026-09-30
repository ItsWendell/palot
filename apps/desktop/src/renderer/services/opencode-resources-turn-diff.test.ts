import { expect, it, vi } from "vitest";
import { listTurnDiffs } from "./opencode-resources";

const mocks = vi.hoisted(() => ({ diff: vi.fn().mockResolvedValue([]), client: vi.fn() }));
vi.mock("./opencode-client", () => ({
  openCodeClient: (connectionID?: string) => {
    mocks.client(connectionID);
    return { session: { diff: mocks.diff } };
  },
}));

it("requests just the user-anchored turn through the selected connection", async () => {
  const signal = new AbortController().signal;
  await listTurnDiffs("session-1", "user-1", signal, "connection-1");
  expect(mocks.client).toHaveBeenCalledWith("connection-1");
  expect(mocks.diff).toHaveBeenCalledWith(
    { sessionID: "session-1", from: "user-1" },
    { signal: expect.any(AbortSignal) },
  );
});
