// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

vi.mock("electron-store", () => ({
  default: class {
    get() {
      return undefined;
    }
    set() {}
    delete() {}
  },
}));
vi.mock("./opencode-observability", () => ({
  openCodeLog: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  TailscaleService,
  assertLoopbackOpenCodeEndpoint,
  parseTailscaleServeStatus,
  type TailscaleCommandRunner,
} from "./tailscale-service";

function serveConfig(proxy?: string) {
  return JSON.stringify(
    proxy ? { Web: { "host.example.ts.net:443": { Handlers: { "/": { Proxy: proxy } } } } } : {},
  );
}

function ownership(initial?: string) {
  let value = initial;
  return {
    get: vi.fn(() => value),
    set: vi.fn((_key: "rootServeTarget", next: string) => {
      value = next;
    }),
    delete: vi.fn(() => {
      value = undefined;
    }),
  };
}

describe("Tailscale Serve parsing", () => {
  it("classifies inactive, active, and conflicting root handlers", () => {
    expect(parseTailscaleServeStatus("{}", "http://127.0.0.1:4096")).toEqual({
      state: "inactive",
      proxyTarget: null,
    });
    expect(
      parseTailscaleServeStatus(serveConfig("http://127.0.0.1:4096"), "http://127.0.0.1:4096"),
    ).toEqual({ state: "active", proxyTarget: "http://127.0.0.1:4096" });
    expect(
      parseTailscaleServeStatus(serveConfig("http://127.0.0.1:3000"), "http://127.0.0.1:4096"),
    ).toEqual({ state: "conflict", proxyTarget: "http://127.0.0.1:3000" });
  });

  it("rejects non-loopback and decorated OpenCode endpoints", () => {
    expect(() => assertLoopbackOpenCodeEndpoint("http://192.168.1.2:4096")).toThrow("loopback");
    expect(() => assertLoopbackOpenCodeEndpoint("https://127.0.0.1:4096")).toThrow("loopback");
    expect(() => assertLoopbackOpenCodeEndpoint("http://127.0.0.1:4096/project")).toThrow(
      "cannot include",
    );
  });
});

describe("TailscaleService", () => {
  it("enables and disables only the root HTTPS handler", async () => {
    let served = false;
    const run = vi.fn(async (_command: string, args: string[]) => {
      if (args[0] === "version") return { stdout: "1.102.3\n", stderr: "" };
      if (args[0] === "status") {
        return {
          stdout: JSON.stringify({
            BackendState: "Running",
            Self: { DNSName: "mac.example.ts.net." },
          }),
          stderr: "",
        };
      }
      if (args.join(" ") === "serve status --json") {
        return { stdout: serveConfig(served ? "http://127.0.0.1:4096" : undefined), stderr: "" };
      }
      if (args.at(-1) === "off") served = false;
      else served = true;
      return { stdout: "", stderr: "" };
    });
    const owner = ownership();
    const service = new TailscaleService({ run } satisfies TailscaleCommandRunner, owner, [
      "tailscale",
    ]);

    await expect(service.enable("http://127.0.0.1:4096")).resolves.toMatchObject({
      serveState: "active",
      managedByPalot: true,
      publicUrl: "https://mac.example.ts.net",
    });
    expect(run).toHaveBeenCalledWith(
      "tailscale",
      ["serve", "--bg", "--yes", "--https=443", "--set-path=/", "http://127.0.0.1:4096"],
      20_000,
    );

    await expect(service.disable("http://127.0.0.1:4096")).resolves.toMatchObject({
      serveState: "inactive",
    });
    expect(run).toHaveBeenCalledWith(
      "tailscale",
      ["serve", "--https=443", "--set-path=/", "off"],
      20_000,
    );
  });

  it("does not replace or remove handlers Palot does not own", async () => {
    const run = vi.fn(async (_command: string, args: string[]) => {
      if (args[0] === "version") return { stdout: "1.102.3\n", stderr: "" };
      if (args[0] === "status") {
        return {
          stdout: JSON.stringify({ BackendState: "Running", Self: { DNSName: "host.ts.net." } }),
          stderr: "",
        };
      }
      return { stdout: serveConfig("http://127.0.0.1:3000"), stderr: "" };
    });
    const service = new TailscaleService({ run }, ownership(), ["tailscale"]);

    await expect(service.enable("http://127.0.0.1:4096")).rejects.toThrow("different root");
    expect(run.mock.calls.some(([, args]) => args.includes("--bg"))).toBe(false);
  });

  it("preserves ownership while Tailscale is disconnected", async () => {
    const target = "http://127.0.0.1:4096";
    const owner = ownership(target);
    const run = vi.fn(async (_command: string, args: string[]) => {
      if (args[0] === "version") return { stdout: "1.102.3\n", stderr: "" };
      return {
        stdout: JSON.stringify({ BackendState: "Stopped", Self: { DNSName: "host.ts.net." } }),
        stderr: "",
      };
    });
    const service = new TailscaleService({ run }, owner, ["tailscale"]);

    await expect(service.disable(target)).rejects.toThrow("Connect Tailscale");
    expect(owner.delete).not.toHaveBeenCalled();
    expect(run.mock.calls.some(([, args]) => args.at(-1) === "off")).toBe(false);
  });

  it("keeps a managed handler removable when the local endpoint changes", async () => {
    const ownedTarget = "http://127.0.0.1:4096";
    const owner = ownership(ownedTarget);
    const run = vi.fn(async (_command: string, args: string[]) => {
      if (args[0] === "version") return { stdout: "1.102.3\n", stderr: "" };
      if (args[0] === "status") {
        return {
          stdout: JSON.stringify({ BackendState: "Running", Self: { DNSName: "host.ts.net." } }),
          stderr: "",
        };
      }
      return { stdout: serveConfig(ownedTarget), stderr: "" };
    });
    const service = new TailscaleService({ run }, owner, ["tailscale"]);

    await expect(service.status("http://127.0.0.1:5000")).resolves.toMatchObject({
      serveState: "active",
      proxyTarget: ownedTarget,
      managedByPalot: true,
    });
    expect(owner.delete).not.toHaveBeenCalled();
  });

  it("does not mutate or forget ownership when Serve status cannot be read", async () => {
    const target = "http://127.0.0.1:4096";
    const owner = ownership(target);
    const run = vi.fn(async (_command: string, args: string[]) => {
      if (args[0] === "version") return { stdout: "1.102.3\n", stderr: "" };
      if (args[0] === "status") {
        return {
          stdout: JSON.stringify({ BackendState: "Running", Self: { DNSName: "host.ts.net." } }),
          stderr: "",
        };
      }
      throw new Error("status unavailable");
    });
    const service = new TailscaleService({ run }, owner, ["tailscale"]);

    await expect(service.disable(target)).rejects.toThrow("Could not read Tailscale Serve status");
    await expect(service.enable(target)).rejects.toThrow("Could not read Tailscale Serve status");
    expect(owner.delete).not.toHaveBeenCalled();
    expect(owner.set).not.toHaveBeenCalled();
  });

  it("requires disabling a managed old endpoint before enabling a new one", async () => {
    const ownedTarget = "http://127.0.0.1:4096";
    const run = vi.fn(async (_command: string, args: string[]) => {
      if (args[0] === "version") return { stdout: "1.102.3\n", stderr: "" };
      if (args[0] === "status") {
        return {
          stdout: JSON.stringify({ BackendState: "Running", Self: { DNSName: "host.ts.net." } }),
          stderr: "",
        };
      }
      return { stdout: serveConfig(ownedTarget), stderr: "" };
    });
    const service = new TailscaleService({ run }, ownership(ownedTarget), ["tailscale"]);

    await expect(service.enable("http://127.0.0.1:5000")).rejects.toThrow(
      "Disable Palot's existing",
    );
    expect(run.mock.calls.some(([, args]) => args.includes("--bg"))).toBe(false);
  });
});
