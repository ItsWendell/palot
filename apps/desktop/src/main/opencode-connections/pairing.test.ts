// @vitest-environment node

import { describe, expect, it } from "vitest";
import { parseOpenCodePairPayload, serializeOpenCodePairPayload } from "./pairing";

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
