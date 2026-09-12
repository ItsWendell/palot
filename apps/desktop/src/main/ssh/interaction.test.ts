// @vitest-environment node
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { SshInteractions } from "./interaction";
import type { connectSsh } from "./transport";

function owner(id: number) {
  return Object.assign(new EventEmitter(), { id, isDestroyed: () => false, send: vi.fn() });
}
const input = () => ({
  config: { target: "office" },
  binaryPath: "/runtime",
  version: "test",
  signal: new AbortController().signal,
});

describe("SSH window interactions", () => {
  it("accepts only the owning window's current prompt and does not publish answers", async () => {
    const window = owner(1);
    const other = owner(2);
    const transport = vi.fn<typeof connectSsh>(async ({ prompt }) => {
      expect(await prompt({ kind: "authentication", text: "Password:", confirm: false })).toBe(
        "private-answer",
      );
      return { endpoint: { url: "http://127.0.0.1:1234" }, close: async () => {} };
    });
    const broker = new SshInteractions(transport);
    const connection = broker.connector(window as never)(input());
    const state = broker.state(window as never)!;
    const response = {
      operationID: state.operationID,
      promptID: state.prompt!.id,
      value: "private-answer",
    };
    expect(() => broker.respond(other as never, response)).toThrow("this window");
    expect(() => broker.respond(window as never, { ...response, promptID: "old" })).toThrow();
    broker.respond(window as never, response);
    await connection;
    expect(broker.state(window as never)).toBeNull();
    expect(JSON.stringify(window.send.mock.calls)).not.toContain("private-answer");
    expect(other.send).not.toHaveBeenCalled();
    expect(() => broker.respond(window as never, response)).toThrow();
  });

  it.each(["destroyed", "did-navigate", "cancel"])(
    "cancels setup on %s and releases its pending prompt",
    async (reason) => {
      const window = owner(1);
      const broker = new SshInteractions(async ({ prompt, signal }) => {
        expect(
          await prompt({ kind: "authentication", text: "Password:", confirm: false }),
        ).toBeNull();
        signal.throwIfAborted();
        throw new Error("Expected cancellation");
      });
      const connection = broker.connector(window as never)(input());
      const rejection = expect(connection).rejects.toThrow("canceled");
      if (reason === "cancel")
        broker.cancel(window as never, broker.state(window as never)!.operationID);
      else window.emit(reason);
      await rejection;
      expect(broker.state(window as never)).toBeNull();
      expect(window.listenerCount("destroyed")).toBe(0);
      expect(window.listenerCount("did-navigate")).toBe(0);
    },
  );

  it("rejects simultaneous setup in one window without overwriting the first operation", async () => {
    const window = owner(1);
    const broker = new SshInteractions(async ({ prompt }) => {
      await prompt({ kind: "authentication", text: "Password:", confirm: false });
      return { endpoint: { url: "http://127.0.0.1:1234" }, close: async () => {} };
    });
    const first = broker.connector(window as never)(input());
    const canceled = expect(first).rejects.toThrow("canceled");
    const before = broker.state(window as never);
    await expect(broker.connector(window as never)(input())).rejects.toThrow("already in progress");
    expect(broker.state(window as never)).toEqual(before);
    broker.cancel(window as never, before!.operationID);
    await canceled;
  });
});
