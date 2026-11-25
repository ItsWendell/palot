import { describe, expect, it } from "vitest";
import type { OpenCodeWebAccessInfo } from "../../shared";
import {
  pairingInfoForAddress,
  pairingCopyPayload,
  pairingQRCodePayload,
  suggestedPairingAddress,
} from "./pairing-address";

const payload = { urls: ["http://127.0.0.1:4096"], username: "opencode", password: "test-only" };
const info = {
  mode: "credentials" as const,
  ...payload,
  payload: JSON.stringify(payload),
  name: null,
};
const linkInfo = {
  mode: "link" as const,
  urls: ["http://127.0.0.1:4096", "https://second.example"],
  code: "abcdefghijklmnop",
  expiresIn: 300,
  payload: "http://127.0.0.1:4096/auth/connect/abcdefghijklmnop",
  name: null,
};

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

  it("builds a one-time URL for a validated proxy origin without changing the code", () => {
    const result = pairingInfoForAddress(linkInfo, " https://workstation.example:8443/ ");
    expect(result).toEqual({
      ...linkInfo,
      urls: ["https://workstation.example:8443"],
      payload: "https://workstation.example:8443/auth/connect/abcdefghijklmnop",
    });
    expect(pairingInfoForAddress(linkInfo, " ").payload).toBe(
      "https://second.example/auth/connect/abcdefghijklmnop",
    );
  });

  it("keeps the original advertised addresses when no override is selected", () => {
    expect(pairingInfoForAddress(info, " ")).toEqual(info);
  });

  it("encodes all reachable addresses but never the scanning device's loopback", () => {
    expect(
      JSON.parse(
        pairingQRCodePayload({
          ...linkInfo,
          urls: [
            "http://127.0.0.1:4096",
            "http://[::1]:4096",
            "http://dev.localhost:4096",
            "http://192.168.1.2:4096",
            "https://device.example",
          ],
        })!,
      ),
    ).toEqual({ code: linkInfo.code, urls: ["http://192.168.1.2:4096", "https://device.example"] });
    expect(pairingQRCodePayload({ ...linkInfo, urls: ["http://localhost:4096"] })).toBeNull();
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
    expect(() => pairingInfoForAddress(linkInfo, address)).toThrow();
  });

  it("names the server in the QR and copied details only when a usable name is given", () => {
    const reachable = { ...linkInfo, urls: ["https://device.example"] };
    expect(JSON.parse(pairingQRCodePayload(reachable, "  Studio   Mac ")!)).toEqual({
      code: linkInfo.code,
      urls: ["https://device.example"],
      name: "Studio Mac",
    });
    expect(JSON.parse(pairingQRCodePayload(reachable, "")!)).not.toHaveProperty("name");
    expect(JSON.parse(pairingQRCodePayload(reachable, "evil\u202Ename")!)).not.toHaveProperty(
      "name",
    );
    expect(JSON.parse(pairingQRCodePayload(info, "Box")!)).toEqual({ ...payload, name: "Box" });
    // Only loopback: no QR, but the copied details still work through a forwarded port.
    const local = { ...linkInfo, urls: ["http://127.0.0.1:4096"] };
    expect(pairingQRCodePayload(local, "Box")).toBeNull();
    expect(JSON.parse(pairingCopyPayload(local, "Box"))).toEqual({
      code: linkInfo.code,
      urls: ["http://127.0.0.1:4096"],
      name: "Box",
    });
  });
});
