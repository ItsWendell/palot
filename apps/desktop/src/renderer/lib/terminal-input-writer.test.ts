import { describe, expect, it, vi } from "vitest";
import { TERMINAL_WRITE_MAX_LENGTH } from "../../shared/terminal-input";
import { createTerminalInputWriter, throttledReporter } from "./terminal-input-writer";

function deferred() {
  return Promise.withResolvers<void>();
}

describe("terminal input writer", () => {
  it("sends a large paste in order and keeps later keystrokes behind it", async () => {
    const sent: Array<[string, string]> = [];
    const gate = deferred();
    const write = createTerminalInputWriter<string>(async (chunk, target) => {
      if (sent.length === 1) await gate.promise;
      sent.push([chunk.slice(0, 3), target]);
    }, vi.fn());
    const paste = "a".repeat(TERMINAL_WRITE_MAX_LENGTH) + "b".repeat(TERMINAL_WRITE_MAX_LENGTH);
    const pasted = write(paste, "conn-1");
    const typed = write("q", "conn-1");
    await Promise.resolve();
    expect(sent.map(([chunk]) => chunk)).toEqual(["aaa"]);
    gate.resolve();
    await Promise.all([pasted, typed]);
    expect(sent).toEqual([
      ["aaa", "conn-1"],
      ["bbb", "conn-1"],
      ["q", "conn-1"],
    ]);
  });

  it("reports a failed write, stops that input and closes an interrupted bracketed paste", async () => {
    const sent: string[] = [];
    const onError = vi.fn();
    const write = createTerminalInputWriter<null>(async (chunk) => {
      if (sent.length === 1) {
        sent.push("<failed>");
        throw new Error("IPC limit");
      }
      sent.push(chunk.length > 10 ? "<chunk>" : chunk);
    }, onError);
    const body = "x".repeat(TERMINAL_WRITE_MAX_LENGTH * 3);
    await write(`\x1b[200~${body}\x1b[201~`, null);
    expect(sent).toEqual(["<chunk>", "<failed>", "\x1b[201~"]);
    expect(onError).toHaveBeenCalledWith(new Error("IPC limit"));
    // Later input still goes through.
    await write("ok", null);
    expect(sent.at(-1)).toBe("ok");
  });

  it("toasts at most once per interval", () => {
    let now = 0;
    const report = vi.fn();
    const throttled = throttledReporter(report, 5_000, () => now);
    throttled("a");
    now = 1_000;
    throttled("b");
    now = 6_000;
    throttled("c");
    expect(report.mock.calls).toEqual([["a"], ["c"]]);
  });
});
