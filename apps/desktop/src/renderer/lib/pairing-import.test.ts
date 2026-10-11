import { describe, expect, it } from "vitest";
import { parsePairingText } from "./pairing-import";

const code = "abcdefghijklmnop";
const urls = ["http://192.168.1.2:4096", "https://device.example"];

describe("one-time pairing QR import", () => {
  it("prefers HTTPS and redeems one selected address without sending the other targets", () => {
    const text = JSON.stringify({ code, urls });
    expect(parsePairingText(text)).toEqual({
      input: { link: `https://device.example/auth/connect/${code}` },
      urls,
      selectedAddress: "https://device.example",
    });
    expect(parsePairingText(text, urls[0]).input).toEqual({
      link: `${urls[0]}/auth/connect/${code}`,
    });
    expect(() => parsePairingText(text, "https://other.example")).toThrow("advertised");
  });

  it.each([
    { code: "bad", urls },
    { code, urls, username: "opencode", password: "secret" },
    { code, urls: [] },
    { code, urls: Array.from({ length: 17 }, () => urls[1]) },
    ...[
      "file:///tmp",
      "https://user:pass@host",
      "https://host/path",
      "https://host?token=secret",
      "https://host#fragment",
    ].map((url) => ({ code, urls: [url] })),
  ])("rejects malformed, ambiguous or unsafe payloads", (payload) => {
    expect(() => parsePairingText(JSON.stringify(payload))).toThrow();
  });
});
