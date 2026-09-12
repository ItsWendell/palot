import { describe, expect, it } from "vitest";
import { toJsonValue } from "./opencode-json";

describe("toJsonValue", () => {
  it("redacts nested secret-bearing keys before data crosses IPC", () => {
    expect(
      toJsonValue({
        authorization: "Bearer secret",
        oauth: {
          client_secret: "secret",
          clientSecret: "secret",
          access_token: "token",
          refreshToken: "token",
        },
        input: { command: "echo safe", tokens: 12 },
      }),
    ).toEqual({
      authorization: "[Redacted]",
      oauth: {
        client_secret: "[Redacted]",
        clientSecret: "[Redacted]",
        access_token: "[Redacted]",
        refreshToken: "[Redacted]",
      },
      input: { command: "echo safe", tokens: 12 },
    });
  });
});
