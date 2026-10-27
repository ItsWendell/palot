import { ClientError } from "@opencode/client";
import { describe, expect, it } from "vitest";
import { isMissingOpenCodeRoute } from "./opencode-missing-route";

describe("isMissingOpenCodeRoute", () => {
  it("recognizes the empty 404 older servers send for unknown routes", () => {
    expect(isMissingOpenCodeRoute(new ClientError("UnsupportedContentType"))).toBe(true);
    expect(
      isMissingOpenCodeRoute(new ClientError("UnexpectedStatus", { cause: { status: 404 } })),
    ).toBe(true);
  });

  it("does not treat real failures as a missing route", () => {
    expect(
      isMissingOpenCodeRoute(new ClientError("UnexpectedStatus", { cause: { status: 500 } })),
    ).toBe(false);
    expect(isMissingOpenCodeRoute(new ClientError("Transport"))).toBe(false);
    expect(isMissingOpenCodeRoute(new Error("404"))).toBe(false);
  });
});
