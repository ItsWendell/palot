import { describe, expect, it } from "vitest";
import { type OpenCodeEvent, waitForAny, type WaitInput } from "./wait";

const never = () => new Promise<void>(() => {});

const permissionAsked = (sessionID: string) =>
  ({
    type: "permission.asked",
    data: { id: "per_1", sessionID, action: "edit", resources: [] },
  }) as unknown as OpenCodeEvent;

/** An event stream fed by the test that ends when its signal aborts, like the plugin API's. */
function eventFeed() {
  const pending: OpenCodeEvent[] = [];
  let wake: (() => void) | undefined;
  let signal: AbortSignal | undefined;
  return {
    push(event: OpenCodeEvent) {
      pending.push(event);
      wake?.();
    },
    get signal() {
      return signal;
    },
    async *subscribe(subscription: AbortSignal): AsyncGenerator<OpenCodeEvent> {
      signal = subscription;
      while (!subscription.aborted) {
        const event = pending.shift();
        if (event) {
          yield event;
          continue;
        }
        await new Promise<void>((resolve) => {
          wake = resolve;
          subscription.addEventListener("abort", () => resolve(), { once: true });
        });
      }
    },
  };
}

function input(overrides: Partial<WaitInput>): WaitInput {
  return {
    sessionIDs: ["ses_a", "ses_b"],
    timeoutMs: 1_000,
    signal: new AbortController().signal,
    waitIdle: never,
    events: async function* () {},
    ...overrides,
  };
}

describe("waitForAny", () => {
  it("settles with the first session that goes idle", async () => {
    const outcome = await waitForAny(
      input({ waitIdle: (sessionID) => (sessionID === "ses_b" ? Promise.resolve() : never()) }),
    );
    expect(outcome).toEqual({ reason: "idle", sessionID: "ses_b" });
  });

  it("settles when a listed session asks for approval and stops listening", async () => {
    const feed = eventFeed();
    const waiting = waitForAny(input({ events: (signal) => feed.subscribe(signal) }));
    feed.push(permissionAsked("ses_other"));
    feed.push(permissionAsked("ses_a"));
    expect(await waiting).toEqual({ reason: "needs_input", sessionID: "ses_a" });
    expect(feed.signal?.aborted).toBe(true);
  });

  it("times out when nothing happens, even if the event stream closes early", async () => {
    const started = Date.now();
    expect(await waitForAny(input({ timeoutMs: 30 }))).toEqual({ reason: "timeout" });
    expect(Date.now() - started).toBeGreaterThanOrEqual(25);
  });

  it("does not wait at all for a zero timeout", async () => {
    let subscribed = false;
    const outcome = await waitForAny(
      input({
        timeoutMs: 0,
        events: (signal) => {
          subscribed = true;
          return eventFeed().subscribe(signal);
        },
      }),
    );
    expect(outcome).toEqual({ reason: "timeout" });
    expect(subscribed).toBe(false);
  });

  it("rejects with the abort reason when the tool call is cancelled", async () => {
    const controller = new AbortController();
    const feed = eventFeed();
    const waiting = waitForAny(
      input({
        timeoutMs: 60_000,
        signal: controller.signal,
        events: (signal) => feed.subscribe(signal),
      }),
    );
    controller.abort(new Error("cancelled"));
    await expect(waiting).rejects.toThrow("cancelled");
    expect(feed.signal?.aborted).toBe(true);
  });
});
