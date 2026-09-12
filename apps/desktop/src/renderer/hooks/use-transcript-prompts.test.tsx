import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createStore, Provider } from "jotai";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { runtimeAtom } from "../atoms/workspace";
import { openCodeKeys } from "../lib/opencode-query";
import { mapMessage } from "../services/opencode-mappers";
import { loadPromptIndex } from "../services/opencode-resources";
import { useTranscriptPrompts } from "./use-transcript-prompts";

vi.mock("../services/opencode-resources", () => ({ loadPromptIndex: vi.fn() }));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
const user = (id: string, created: number) => ({
  id,
  type: "user" as const,
  text: id,
  time: { created },
});

it("pages an independent outline without hydrating the transcript or duplicating loaded prompts", async () => {
  vi.mocked(loadPromptIndex)
    .mockResolvedValueOnce({
      data: [user("recent", 3), user("older", 2)],
      cursor: { next: "users-next" },
    })
    .mockResolvedValueOnce({ data: [user("oldest", 1)], cursor: { next: "users-next" } });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const store = createStore();
  store.set(runtimeAtom, {
    connectionID: "connection",
    profileID: "profile",
    contractVersion: "0.0.0-beta-19425",
    phase: "connected",
    connected: true,
    binaryPath: null,
    version: "0.0.0-beta-19425",
    pid: 1,
    managed: false,
    lastConnectedAt: 1,
    error: null,
    versionMismatch: null,
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <Provider store={store}>{children}</Provider>
    </QueryClientProvider>
  );
  const loaded = [{ messageID: "recent", label: "Live label" }];
  const view = renderHook(
    ({ firstMessage, hasOlder }) =>
      useTranscriptPrompts({
        sessionID: "session",
        firstMessage,
        hasOlder,
        loaded,
      }),
    { wrapper, initialProps: { firstMessage: mapMessage(user("recent", 3)), hasOlder: true } },
  );
  await waitFor(() =>
    expect(view.result.current.prompts.map((p) => p.messageID)).toEqual(["older", "recent"]),
  );
  await act(async () => {
    await view.result.current.earlier.load();
  });
  await waitFor(() =>
    expect(view.result.current.prompts.map((p) => p.messageID)).toEqual([
      "oldest",
      "older",
      "recent",
    ]),
  );
  expect(view.result.current.prompts.at(-1)?.label).toBe("Live label");
  expect(view.result.current.earlier.available).toBe(false);
  expect(loadPromptIndex).toHaveBeenLastCalledWith(
    "session",
    "users-next",
    expect.any(AbortSignal),
  );
  expect(client.getQueryData(openCodeKeys.transcript("connection", "session"))).toBeUndefined();
  vi.mocked(loadPromptIndex).mockResolvedValue({
    data: [user("recent", 3)],
    cursor: {},
  });
  await act(async () => {
    await client.invalidateQueries({ queryKey: openCodeKeys.promptIndex("connection", "session") });
  });
  await waitFor(() => expect(view.result.current.prompts).toEqual(loaded));
  view.rerender({ firstMessage: mapMessage(user("oldest", 1)), hasOlder: false });
  expect(view.result.current.prompts).toBe(loaded);
  client.clear();
});
