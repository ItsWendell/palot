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

describe("pairing names", () => {
  it("reads the name newer OpenCode and Palot put in the QR, and accepts payloads without one", () => {
    expect(parsePairingText(JSON.stringify({ code, urls, name: " Anomaly  Box " })).name).toBe(
      "Anomaly Box",
    );
    expect(parsePairingText(JSON.stringify({ code, urls })).name).toBeUndefined();
    expect(parsePairingText(JSON.stringify({ code, urls, name: "" })).name).toBeUndefined();
    expect(
      parsePairingText(
        JSON.stringify({ urls, username: "opencode", password: "secret", name: "Old Box" }),
      ).name,
    ).toBe("Old Box");
  });

  it.each([42, ["Box"], "a".repeat(81), "line\u0007bell", "spoof\u202Eexe.txt"])(
    "refuses a name that is not a short plain string: %j",
    (name) => {
      expect(() => parsePairingText(JSON.stringify({ code, urls, name }))).toThrow("server name");
    },
  );
});
