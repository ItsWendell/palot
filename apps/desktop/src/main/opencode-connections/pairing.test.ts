// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  parseOneTimePairingLink,
  parseOpenCodePairPayload,
  serializeOpenCodePairPayload,
} from "./pairing";

describe("OpenCode pairing payload", () => {
  it("uses the opencode2 pair JSON shape", () => {
    const payload = {
      urls: ["http://192.168.1.5:4096/"],
      username: "opencode",
      password: "secret",
    };
    expect(parseOpenCodePairPayload(payload)).toEqual({
      ...payload,
      urls: ["http://192.168.1.5:4096"],
    });
    expect(JSON.parse(serializeOpenCodePairPayload(payload))).toEqual({
      ...payload,
      urls: ["http://192.168.1.5:4096"],
    });
  });

  it("rejects incomplete payloads", () => {
    expect(() => parseOpenCodePairPayload({ urls: [], username: "", password: "" })).toThrow();
  });
});

describe("one-time pairing links", () => {
  const code = "abcdefghijklmnopqrstu1";

  it("extracts only the origin and code from a valid public link", () => {
    expect(parseOneTimePairingLink(` https://dev.example:8443/auth/connect/${code} `)).toEqual({
      origin: "https://dev.example:8443",
      code,
    });
  });

  it.each([
    `file:///auth/connect/${code}`,
    `https://user:password@dev.example/auth/connect/${code}`,
    `https://dev.example/auth/connect/${code}?token=x`,
    `https://dev.example/auth/connect/${code}#fragment`,
    "https://dev.example/api/info",
    "https://dev.example/auth/connect/code/extra",
    "https://dev.example/auth/connect/../../api/info",
    "https://dev.example/auth/connect/!!",
  ])("rejects unsafe or unsupported links: %s", (link) => {
    expect(() => parseOneTimePairingLink(link)).toThrow();
  });
});
