import { createStore } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenCodeClient } from "@opencode/client";
import type { OpenCodeRuntimeStatus } from "../../shared";
import { askBtw, btwPendingAtom, retryBtw } from "./btw";
import { runtimeAtom } from "./workspace";
import { flushWorkbenchPersistence, workbenchCommandAtom, workbenchStateAtom } from "./workbench";
import { findBtwTab } from "../lib/btw";
import { createWorkbenchState, workbenchScopeKey } from "../lib/workbench-tabs";
import { openCodeClient } from "../services/opencode-client";

vi.mock("../services/opencode-client", () => ({ openCodeClient: vi.fn() }));

const owner = {
  profileID: "profile-a",
  sessionID: "ses_a",
  connectionID: "connection-a",
  location: { directory: "/repo" },
};
function setup() {
  const store = createStore();
  store.set(workbenchStateAtom, createWorkbenchState());
  store.set(runtimeAtom, { ...owner, connected: true } as unknown as OpenCodeRuntimeStatus);
  return store;
}
function tabs(store: ReturnType<typeof createStore>) {
  return store.get(workbenchStateAtom).scopes[workbenchScopeKey(owner)]!.right.tabs;
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => flushWorkbenchPersistence());

describe("BTW ownership", () => {
  it("continues after session/server switching and writes only the original question", async () => {
    const a = Promise.withResolvers<{ text: string }>();
    const b = Promise.withResolvers<{ text: string }>();
    const generateA = vi.fn().mockReturnValue(a.promise);
    const generateB = vi.fn().mockReturnValue(b.promise);
    vi.mocked(openCodeClient).mockImplementation(
      (connectionID) =>
        ({
          session: { generate: connectionID === "connection-a" ? generateA : generateB },
        }) as unknown as OpenCodeClient,
    );
    const store = setup();
    askBtw(store, owner, "Original question?");
    const original = tabs(store)[0]!;
    const other = { ...owner, profileID: "profile-b", connectionID: "connection-b" };
    store.set(runtimeAtom, { ...other, connected: true } as unknown as OpenCodeRuntimeStatus);
    askBtw(store, other, "Other question?");
    expect(generateA.mock.calls[0]![0]).toEqual({
      sessionID: "ses_a",
      prompt: expect.stringContaining(
        "Do not call any tools and do not take any actions.\n\nOriginal question?",
      ),
    });
    expect(generateA.mock.calls[0]![1].signal.aborted).toBe(false);
    a.resolve({ text: "  Owner answer  " });
    b.resolve({ text: "Other answer" });
    await vi.waitFor(() => expect(store.get(btwPendingAtom).size).toBe(0));
    expect(findBtwTab(store.get(workbenchStateAtom), owner, original.id)?.resource.answer).toBe(
      "Owner answer",
    );
    expect(
      store.get(workbenchStateAtom).scopes[workbenchScopeKey(other)]?.right.tabs[0]?.resource,
    ).toMatchObject({ answer: "Other answer" });
  });

  it.each(["close", "close-others", "close-to-end"] as const)(
    "aborts %s and ignores late resolution",
    async (type) => {
      const late = Promise.withResolvers<{ text: string }>();
      const generate = vi.fn().mockReturnValue(late.promise);
      vi.mocked(openCodeClient).mockReturnValue({
        session: { generate },
      } as unknown as OpenCodeClient);
      const store = setup();
      store.set(workbenchCommandAtom, {
        type: "open",
        scope: owner,
        input: { kind: "context", location: owner.location },
      });
      const keep = tabs(store)[0]!;
      askBtw(store, owner, "Close me?");
      const question = tabs(store)[1]!;
      store.set(workbenchCommandAtom, {
        type: "mutate",
        scope: owner,
        mutation: { type, pane: "right", tabID: type === "close" ? question.id : keep.id },
      });
      expect(generate.mock.calls[0]![1].signal.aborted).toBe(true);
      expect(store.get(btwPendingAtom).size).toBe(0);
      late.resolve({ text: "Too late" });
      await late.promise;
      await Promise.resolve();
      expect(findBtwTab(store.get(workbenchStateAtom), owner, question.id)).toBeUndefined();
      expect(tabs(store)).toEqual([keep]);
    },
  );

  it("shows errors, rejects cross-server retries, and retries only once while pending", async () => {
    const retry = Promise.withResolvers<{ text: string }>();
    const generate = vi
      .fn()
      .mockRejectedValueOnce(new Error("Provider unavailable"))
      .mockReturnValue(retry.promise);
    vi.mocked(openCodeClient).mockReturnValue({
      session: { generate },
    } as unknown as OpenCodeClient);
    const store = setup();
    askBtw(store, owner, "Retry me?");
    const question = tabs(store)[0]!;
    await vi.waitFor(() =>
      expect(findBtwTab(store.get(workbenchStateAtom), owner, question.id)?.resource.error).toBe(
        "Provider unavailable",
      ),
    );
    expect(() => retryBtw(store, owner, question.id, "connection-b")).toThrow("this task’s server");
    retryBtw(store, owner, question.id, owner.connectionID);
    retryBtw(store, owner, question.id, owner.connectionID);
    expect(generate).toHaveBeenCalledTimes(2);
    expect(
      findBtwTab(store.get(workbenchStateAtom), owner, question.id)?.resource.error,
    ).toBeUndefined();
    retry.resolve({ text: "Recovered" });
    await vi.waitFor(() => expect(store.get(btwPendingAtom).size).toBe(0));
    expect(findBtwTab(store.get(workbenchStateAtom), owner, question.id)?.resource.answer).toBe(
      "Recovered",
    );
  });

  it("rejects an empty question without opening a tab or requesting generation", () => {
    const store = setup();
    expect(() => askBtw(store, owner, "  ")).toThrow("Enter a question");
    expect(store.get(workbenchStateAtom)).toEqual(createWorkbenchState());
    expect(openCodeClient).not.toHaveBeenCalled();
  });
});
