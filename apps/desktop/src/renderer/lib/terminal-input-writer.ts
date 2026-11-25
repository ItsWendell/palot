import { chunkTerminalWrite } from "../../shared/terminal-input";

const PASTE_START = "\x1b[200~";
const PASTE_END = "\x1b[201~";

/**
 * Orders one terminal's input into writes that fit the IPC limit. Input that fits one write goes
 * out at once, like a keystroke; longer input (a large paste) goes one piece per round trip, and
 * later input waits behind it. A failed write stops the rest of that input and is reported, and an
 * interrupted bracketed paste is closed so the shell does not stay in paste mode.
 */
export function createTerminalInputWriter<Target>(
  send: (chunk: string, target: Target) => Promise<void>,
  onError: (error: unknown) => void,
): (data: string, target: Target) => Promise<void> {
  let pending: Promise<void> | null = null;
  // Every piece of one input goes to the target it was typed into.
  const sendAll = async (data: string, chunks: string[], target: Target) => {
    let sent = 0;
    try {
      for (const chunk of chunks) {
        await send(chunk, target);
        sent += 1;
      }
    } catch (error) {
      if (sent > 0 && data.startsWith(PASTE_START) && data.endsWith(PASTE_END))
        await send(PASTE_END, target).catch(() => undefined);
      onError(error);
    }
  };
  return (data, target) => {
    const chunks = chunkTerminalWrite(data);
    if (!chunks.length) return Promise.resolve();
    if (pending === null && chunks.length === 1) return sendAll(data, chunks, target);
    const current = (pending ?? Promise.resolve()).then(() => sendAll(data, chunks, target));
    pending = current;
    void current.then(() => {
      if (pending === current) pending = null;
    });
    return current;
  };
}

/** Reports at most one failure per interval, so a dead connection does not toast every key. */
export function throttledReporter(
  report: (error: unknown) => void,
  intervalMs = 5_000,
  now = () => Date.now(),
): (error: unknown) => void {
  let last = Number.NEGATIVE_INFINITY;
  return (error) => {
    const at = now();
    if (at - last < intervalMs) return;
    last = at;
    report(error);
  };
}
