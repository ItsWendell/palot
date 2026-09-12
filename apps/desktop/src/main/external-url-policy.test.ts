import { describe, expect, it } from "vitest";
import { allowedExternalUrl } from "./external-url-policy";

describe("allowedExternalUrl", () => {
  it("allows credential-free HTTP and HTTPS URLs", () => {
    expect(allowedExternalUrl("https://example.com/docs?q=1", false)).toBe(
      "https://example.com/docs?q=1",
    );
    expect(allowedExternalUrl("http://example.com/", false)).toBe("http://example.com/");
    expect(allowedExternalUrl("http://127.0.0.1:3000/", false)).toBe("http://127.0.0.1:3000/");
    expect(allowedExternalUrl("http://localhost:5173/", true)).toBe("http://localhost:5173/");
  });

  it("rejects credentials and non-web schemes", () => {
    expect(allowedExternalUrl("https://user:secret@example.com/", false)).toBeNull();
    expect(allowedExternalUrl("file:///etc/passwd", true)).toBeNull();
  });
});
