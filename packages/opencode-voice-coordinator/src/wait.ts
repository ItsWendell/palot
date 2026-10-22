import type { Plugin } from "@opencode/plugin";

export type OpenCodeEvent =
  ReturnType<Plugin.Context["event"]["subscribe"]> extends AsyncIterable<infer Event>
    ? Event
    : never;

export type WaitOutcome =
  | { reason: "idle" | "needs_input"; sessionID: string }
  | { reason: "timeout" };

export interface WaitInput {
  sessionIDs: readonly string[];
  timeoutMs: number;
  signal: AbortSignal;
  /** Resolves once the session has no turn running. */
  waitIdle: (sessionID: string) => Promise<void>;
  /** Server events; iteration must end when the signal aborts. */
  events: (signal: AbortSignal) => AsyncIterable<OpenCodeEvent>;
}

/** The session an event asks the user to act on, if any. */
export function inputRequestSession(event: OpenCodeEvent): string | undefined {
  if (event.type === "permission.asked") return event.data.sessionID;
  if (event.type === "form.created") return event.data.form.sessionID;
  return undefined;
}

/**
 * Settles when the first listed session goes idle or asks for input, or when the timeout
 * passes. Rejects with the signal's reason when the caller aborts.
 */
export async function waitForAny(input: WaitInput): Promise<WaitOutcome> {
  input.signal.throwIfAborted();
  if (input.timeoutMs <= 0) return { reason: "timeout" };

  const listening = new AbortController();
  const listed = new Set(input.sessionIDs);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;

  const idle = input.sessionIDs.map((sessionID) =>
    input.waitIdle(sessionID).then((): WaitOutcome => ({ reason: "idle", sessionID })),
  );
  const timeout = new Promise<WaitOutcome>((resolve) => {
    timer = setTimeout(() => resolve({ reason: "timeout" }), input.timeoutMs);
  });
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(input.signal.reason);
    input.signal.addEventListener("abort", onAbort, { once: true });
  });

  try {
    return await Promise.race([
      ...idle,
      watchInputRequests(input.events(listening.signal), listed),
      timeout,
      aborted,
    ]);
  } finally {
    clearTimeout(timer);
    if (onAbort) input.signal.removeEventListener("abort", onAbort);
    listening.abort();
  }
}

/** Never settles unless a listed session asks for input; a closed stream leaves the other waits in charge. */
async function watchInputRequests(
  events: AsyncIterable<OpenCodeEvent>,
  listed: ReadonlySet<string>,
): Promise<WaitOutcome> {
  try {
    for await (const event of events) {
      const sessionID = inputRequestSession(event);
      if (sessionID && listed.has(sessionID)) return { reason: "needs_input", sessionID };
    }
  } catch {
    // Aborted or disconnected; idle and timeout still settle the wait.
  }
  return new Promise<never>(() => {});
}
