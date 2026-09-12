import { describe, expect, it } from "vitest";
import { redactLogValue } from "./logging";

describe("redactLogValue", () => {
  it("redacts credential fields and authorization values", () => {
    expect(
      redactLogValue({
        password: "secret",
        nested: { authorization: "Bearer abc.def", message: "Basic dXNlcjpwYXNz" },
      }),
    ).toEqual({
      password: "[REDACTED]",
      nested: { authorization: "[REDACTED]", message: "Basic [REDACTED]" },
    });
  });

  it("redacts credentials embedded in error strings and URLs", () => {
    expect(
      redactLogValue(
        "Failed https://user:pass@example.test/path?token=abc123 password=hunter2 api_key:xyz",
      ),
    ).toBe(
      "Failed https://[REDACTED]@example.test/path?token=[REDACTED] password=[REDACTED] api_key:[REDACTED]",
    );
  });
});
