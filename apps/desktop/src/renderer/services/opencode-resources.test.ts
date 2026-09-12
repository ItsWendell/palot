import { afterEach, expect, it, vi } from "vitest";
import { loadPromptIndex } from "./opencode-resources";

const list = vi.hoisted(() => vi.fn());
vi.mock("./opencode-client", () => ({ openCodeClient: () => ({ message: { list } }) }));
afterEach(() => vi.resetAllMocks());

it("keeps the user filter on pages and end-cursor probes", async () => {
  const users = Array.from({ length: 100 }, (_, index) => ({
    id: `user-${index}`,
    type: "user",
    text: "Prompt",
    time: { created: index },
  }));
  list.mockResolvedValueOnce({ data: users, cursor: { next: "older-users" } });
  list.mockResolvedValueOnce({ data: [users[0]], cursor: {} });
  list.mockResolvedValueOnce({ data: [users[0]], cursor: { next: "empty" } });
  const first = await loadPromptIndex("session", null);
  expect(first.cursor.next).toBe("older-users");
  const last = await loadPromptIndex("session", first.cursor.next!);
  expect(last.cursor.next).toBeNull();
  expect(list.mock.calls.map(([input]) => input)).toEqual([
    { sessionID: "session", type: "user", limit: 100, order: "desc" },
    { sessionID: "session", type: "user", limit: 1, cursor: "older-users" },
    { sessionID: "session", type: "user", limit: 100, cursor: "older-users" },
  ]);
});

it("does not advertise an empty filtered next page", async () => {
  list.mockResolvedValueOnce({
    data: Array.from({ length: 100 }, () => ({})),
    cursor: { next: "end" },
  });
  list.mockResolvedValueOnce({ data: [], cursor: {} });
  expect((await loadPromptIndex("session", null)).cursor.next).toBeNull();
});
