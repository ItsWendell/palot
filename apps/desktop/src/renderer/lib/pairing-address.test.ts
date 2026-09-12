import { describe, expect, it } from "vitest";
import type { OpenCodeWebAccessInfo } from "../../shared";
import { pairingInfoForAddress, suggestedPairingAddress } from "./pairing-address";

const payload = { urls: ["http://127.0.0.1:4096"], username: "opencode", password: "test-only" };
const info = { ...payload, payload: JSON.stringify(payload) };

describe("pairing address", () => {
  it("only suggests a proxy that targets the current local service", () => {
    const access: OpenCodeWebAccessInfo = {
      local: {
        available: true,
        reason: null,
        url: "http://127.0.0.1:4096",
        version: "test",
        pid: null,
        managed: false,
        restartAvailable: true,
        pairingAvailable: true,
      },
      tailscale: {
        connectionState: "connected",
        backendState: "Running",
        version: "test",
        dnsName: "device.example",
        publicUrl: "https://device.example",
        serveState: "active",
        proxyTarget: "http://127.0.0.1:4096/",
        managedByPalot: true,
        error: null,
      },
    };
    expect(suggestedPairingAddress(access)).toBe("https://device.example");
    expect(
      suggestedPairingAddress({
        ...access,
        local: { ...access.local, url: "http://127.0.0.1:41234" },
      }),
    ).toBeNull();
    expect(
      suggestedPairingAddress({
        ...access,
        tailscale: { ...access.tailscale, serveState: "conflict" },
      }),
    ).toBeNull();
  });

  it("advertises the proxy origin while retaining the service credentials", () => {
    const result = pairingInfoForAddress(info, " https://workstation.example.com:8443/ ");
    expect(JSON.parse(result.payload)).toEqual({
      urls: ["https://workstation.example.com:8443"],
      username: "opencode",
      password: "test-only",
    });
    expect(result.urls).toEqual(["https://workstation.example.com:8443"]);
    expect(info.urls).toEqual(["http://127.0.0.1:4096"]);
  });

  it("keeps the original advertised addresses when no override is selected", () => {
    expect(pairingInfoForAddress(info, " ")).toEqual(info);
  });

  it.each([
    "http://proxy.example.com",
    "ssh://proxy.example.com",
    "proxy.example.com",
    "https://user:password@proxy.example.com",
    "https://proxy.example.com/opencode",
    "https://proxy.example.com?token=example",
    "https://proxy.example.com#example",
  ])("rejects an insecure or unsupported proxy address: %s", (address) => {
    expect(() => pairingInfoForAddress(info, address)).toThrow();
  });
});
