import type { OpenCodeClient, SessionLogOutput } from "@opencode/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetOpenCodeClientForTest, setOpenCodeClientForTest } from "./opencode-client";
import { listRootSessionInfo, loadSessionLog } from "./opencode-catalog";

afterEach(resetOpenCodeClientForTest);

describe("session catalog", () => {
  it("passes native search and project filters to OpenCode", async () => {
    const list = vi.fn().mockResolvedValue({ data: [], cursor: { next: null } });
    setOpenCodeClientForTest({ session: { list } } as unknown as OpenCodeClient);

    await listRootSessionInfo({ search: "release", project: "project-1" });

    expect(list).toHaveBeenCalledWith(
      { limit: 50, parentID: null, search: "release", project: "project-1", order: "desc" },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });
});

describe("session log", () => {
  it("collects a finite ordered replay with an explicit cursor", async () => {
    const items = [
      { id: "event-1", type: "session.execution.started", created: 1 },
      { id: "event-2", type: "session.execution.succeeded", created: 2 },
      { type: "log.synced", aggregateID: "session-1", seq: 12 },
    ] as SessionLogOutput[];
    const log = vi.fn(async function* () {
      yield* items;
    });
    setOpenCodeClientForTest({ session: { log } } as unknown as OpenCodeClient);

    await expect(loadSessionLog("session-1", 9)).resolves.toEqual(items);
    expect(log).toHaveBeenCalledWith(
      { sessionID: "session-1", after: 9, follow: false },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("propagates cancellation to the stream", async () => {
    const stopped = vi.fn();
    const log = vi.fn(async function* (_input, options: { signal: AbortSignal }) {
      yield await new Promise<SessionLogOutput>((_resolve, reject) => {
        options.signal.addEventListener(
          "abort",
          () => {
            stopped();
            reject(options.signal.reason);
          },
          { once: true },
        );
      });
    });
    setOpenCodeClientForTest({ session: { log } } as unknown as OpenCodeClient);
    const controller = new AbortController();
    const result = loadSessionLog("session-1", undefined, controller.signal);

    controller.abort(new Error("cancelled"));

    await expect(result).rejects.toThrow("cancelled");
    expect(stopped).toHaveBeenCalledOnce();
  });
});
