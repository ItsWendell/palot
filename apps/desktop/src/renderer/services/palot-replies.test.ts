import { afterEach, expect, it, vi } from "vitest";
import type { OpenCodeRuntimeStatus, PalotApi } from "../../shared";
import { resetOpenCodeClientForTest, setFocusedOpenCodeRuntime } from "./opencode-client";
import { palot } from "./palot";

const runtime = (connectionID: string): OpenCodeRuntimeStatus =>
  ({
    connectionID,
    profileID: `${connectionID}-profile`,
    connected: true,
    phase: "connected",
  }) as OpenCodeRuntimeStatus;

afterEach(() => {
  resetOpenCodeClientForTest();
  Reflect.deleteProperty(window, "palot");
});

/** Two connected servers, `focused` focused; returns every request the bridge saw. */
function twoConnections() {
  setFocusedOpenCodeRuntime(runtime("background"));
  setFocusedOpenCodeRuntime(runtime("focused"));
  const request = vi.fn(async (input: { method: string; path: string; connectionID: string }) => {
    const form = input.method === "GET" && input.path.includes("/form/");
    return {
      status: form ? 200 : 204,
      statusText: "OK",
      headers: { "content-type": "application/json" },
      body: form
        ? new TextEncoder().encode(
            JSON.stringify({
              data: {
                id: "form-1",
                sessionID: "session-1",
                title: "Which?",
                fields: [{ key: "q0", type: "string", title: "Which?" }],
              },
            }),
          ).buffer
        : null,
    };
  });
  Object.defineProperty(window, "palot", {
    configurable: true,
    value: {
      openCodeRequest: request,
      runtimeStatus: vi.fn().mockResolvedValue(runtime("focused")),
    } as unknown as PalotApi,
  });
  return request;
}

it("answers a permission on the server that owns it, or the focused one by default", async () => {
  const request = twoConnections();
  await palot.replyPermission({
    sessionID: "session-1",
    requestID: "permission-1",
    reply: "once",
    connectionID: "background",
  });
  await palot.replyPermission({
    sessionID: "session-1",
    requestID: "permission-2",
    reply: "reject",
  });
  expect(request.mock.calls.map(([input]) => input.connectionID)).toEqual([
    "background",
    "focused",
  ]);
});

it("reads and answers a question on the server that owns it", async () => {
  const request = twoConnections();
  await palot.replyQuestion({
    sessionID: "session-1",
    requestID: "form-1",
    answers: [["A"]],
    connectionID: "background",
  });
  expect(request).toHaveBeenCalledTimes(2);
  for (const [input] of request.mock.calls)
    expect(input).toMatchObject({ connectionID: "background", profileID: "background-profile" });
  const reply = request.mock.calls[1]![0] as unknown as { body: ArrayBuffer };
  expect(JSON.parse(new TextDecoder().decode(reply.body))).toMatchObject({ answer: { q0: "A" } });
});
