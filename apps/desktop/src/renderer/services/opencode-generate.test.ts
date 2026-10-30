import { ClientError } from "@opencode/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const text = vi.fn();
const connectionFetch = vi.fn();
vi.mock("./opencode-client", () => ({
  openCodeClient: () => ({ experimental: { generate: { text } } }),
  openCodeConnectionFetch: (...args: unknown[]) => connectionFetch(...args),
}));

const { generateOpenCodeText } = await import("./opencode-generate");

afterEach(() => {
  text.mockReset();
  connectionFetch.mockReset();
});

function missing() {
  return new ClientError("UnexpectedStatus", { cause: { status: 404 } });
}

describe("generateOpenCodeText", () => {
  it("uses generate.text on current servers", async () => {
    text.mockResolvedValue({ text: "feat: add x" });
    await expect(generateOpenCodeText({ prompt: "p" }, "c1")).resolves.toBe("feat: add x");
    expect(connectionFetch).not.toHaveBeenCalled();
  });

  it.each([
    ["an empty 404, as 2.1.x servers send", () => new ClientError("UnsupportedContentType")],
    ["a 404 status", missing],
  ])("falls back to the original route on servers older than 2.2.0 (%s)", async (_, error) => {
    text.mockRejectedValue(error());
    connectionFetch.mockResolvedValue(
      new Response(JSON.stringify({ data: { text: "fix: y" } }), { status: 200 }),
    );
    await expect(
      generateOpenCodeText({ prompt: "p", model: { id: "m", providerID: "x" } }, "c1"),
    ).resolves.toBe("fix: y");
    expect(connectionFetch).toHaveBeenCalledWith(
      "c1",
      "/api/experimental/generate",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ prompt: "p", model: { id: "m", providerID: "x" } }),
      }),
    );
  });

  it("reports the old route's error and does not retry other failures", async () => {
    text.mockRejectedValue(missing());
    connectionFetch.mockResolvedValue(
      new Response(JSON.stringify({ message: "No model configured" }), { status: 400 }),
    );
    await expect(generateOpenCodeText({ prompt: "p" })).rejects.toThrow("No model configured");

    text.mockRejectedValue(new ClientError("UnexpectedStatus", { cause: { status: 500 } }));
    await expect(generateOpenCodeText({ prompt: "p" })).rejects.toBeInstanceOf(ClientError);
    expect(connectionFetch).toHaveBeenCalledTimes(1);
  });
});
