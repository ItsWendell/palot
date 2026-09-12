// @vitest-environment node
import { describe, expect, it } from "vitest";
import { normalizeSshConfig } from "./config";

describe("SSH configuration", () => {
  it.each([
    "my-dev_box",
    "alice@dev.example.com",
    "127.0.0.1",
    "alice@2001:db8::1",
    "[::1]",
    "alice@[fe80::1%en0]",
  ])("accepts destination %s", (target) => {
    expect(normalizeSshConfig({ target })).toEqual({ target });
  });

  it.each([
    "",
    "-oProxyCommand=evil",
    "user@-host",
    "-user@host",
    "host command",
    " host",
    "host\n",
    "host\u0000",
    "host;evil",
    "$(evil)",
    "host`evil`",
    "host|evil",
    "host&evil",
    "host>file",
    "host\\evil",
    "host'",
    'host"',
    "user@@host",
    "ssh://host",
    "host:22",
    "[not-ipv6]",
    "host*",
    "host?",
    "host\u00a0",
  ])("rejects unsafe destination %j", (target) => {
    expect(() => normalizeSshConfig({ target })).toThrow("SSH target");
  });

  it.each([0, 65536, 1.5, NaN, Infinity, "22", null])("rejects invalid port %s", (port) => {
    expect(() => normalizeSshConfig({ target: "host", port })).toThrow("SSH port");
  });

  it.each(["", "   ", "key\nfile", "key\u0000", "key\u007f", "x".repeat(4097), null])(
    "rejects an invalid identity path %#",
    (identityFile) => {
      expect(() => normalizeSshConfig({ target: "host", identityFile })).toThrow("SSH identity");
    },
  );

  it("preserves argv path spaces and discards credentials, endpoints, and options", () => {
    expect(
      normalizeSshConfig({
        target: "user@host",
        port: 65535,
        identityFile: "~/.ssh/work key",
        password: "secret",
        serviceEndpoint: "http://localhost:1234",
        options: ["-oProxyCommand=evil"],
      }),
    ).toEqual({ target: "user@host", port: 65535, identityFile: "~/.ssh/work key" });
    expect(normalizeSshConfig({ target: "host", port: 1 })).toEqual({ target: "host", port: 1 });
  });
});
