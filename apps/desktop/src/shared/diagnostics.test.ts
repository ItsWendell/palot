import { describe, expect, it } from "vitest";
import { actionableErrorMessage, errorDiagnostic } from "./diagnostics";

describe("error diagnostics", () => {
  it("unwraps generic client transport wrappers to the actionable cause", () => {
    const error = new Error("Transport", {
      cause: new TypeError("fetch failed", {
        cause: Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:4096"), {
          code: "ECONNREFUSED",
        }),
      }),
    });

    expect(actionableErrorMessage(error, "fallback")).toBe("connect ECONNREFUSED 127.0.0.1:4096");
    expect(errorDiagnostic(error).cause?.cause?.code).toBe("ECONNREFUSED");
  });

  it("describes unexpected HTTP statuses without serializing opaque objects", () => {
    expect(errorDiagnostic({ status: 503 }).message).toBe("HTTP status 503");
  });
});
