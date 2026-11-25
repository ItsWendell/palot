import { describe, expect, it } from "vitest";
import { actionableErrorMessage, errorDiagnostic, openCodeErrorReference } from "./diagnostics";

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

  it("drops a stack trace a server put in its error message", () => {
    const error = new Error(
      "FileSystem.DirectoryNotFoundError: Directory not found: /work/tree\n    at <anonymous> (/$bunfs/root/chunk.js:87:13207)\n    at runLoop (/$bunfs/root/chunk.js:18:2552)",
    );
    expect(actionableErrorMessage(error, "fallback")).toBe(
      "FileSystem.DirectoryNotFoundError: Directory not found: /work/tree",
    );
  });

  it("keeps OpenCode's declared tag and log reference, and names them beside the message", () => {
    // The promise client merges a declared error body into the Error it throws, named by its tag.
    const declared = Object.assign(new Error("Unexpected failure"), {
      _tag: "UnknownError",
      ref: "err_01JX",
    });
    declared.name = "UnknownError";
    const wrapped = new Error("Could not load messages", { cause: declared });
    expect(errorDiagnostic(wrapped).cause).toMatchObject({ tag: "UnknownError", ref: "err_01JX" });
    expect(openCodeErrorReference(wrapped)).toBe("UnknownError · ref err_01JX");
    // A tag without a reference stays in the logged diagnostic only.
    const busy = Object.assign(new Error("Session is busy"), { _tag: "SessionBusyError" });
    expect(errorDiagnostic(busy).tag).toBe("SessionBusyError");
    expect(openCodeErrorReference(busy)).toBeNull();
    expect(openCodeErrorReference(new Error("plain"))).toBeNull();
  });

  it("describes unexpected HTTP statuses without serializing opaque objects", () => {
    expect(errorDiagnostic({ status: 503 }).message).toBe("HTTP status 503");
  });
});
