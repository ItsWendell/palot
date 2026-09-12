import { describe, expect, it } from "vitest";
import { resolveActiveSessions } from "./active-sessions";

describe("active session hydration", () => {
  it("ignores a session that disappears after the active snapshot", async () => {
    const missing = { _tag: "SessionNotFoundError" };

    await expect(
      resolveActiveSessions(
        ["active", "settled"],
        async (sessionID) => {
          if (sessionID === "settled") throw missing;
          return { id: sessionID };
        },
        (error) => error === missing,
      ),
    ).resolves.toEqual([{ id: "active" }]);
  });

  it("retains unexpected hydration failures", async () => {
    const failure = new Error("service unavailable");

    await expect(
      resolveActiveSessions(
        ["active"],
        async () => Promise.reject(failure),
        () => false,
      ),
    ).rejects.toBe(failure);
  });
});
