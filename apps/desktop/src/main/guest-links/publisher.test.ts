// @vitest-environment node
import { expect, it, vi } from "vitest";
import { GuestPublisher, type GuestRouteStore } from "./publisher";

vi.mock("electron-store", () => ({
  default: class {
    get() {
      return undefined;
    }
    set() {}
    delete() {}
  },
}));

function memoryStore(initial?: unknown) {
  const values = new Map<string, unknown>(initial ? [["route", initial]] : []);
  const store: GuestRouteStore = {
    get: (key) => values.get(key),
    set: (key, value) => void values.set(key, value),
    delete: (key) => void values.delete(key),
  };
  return { store: () => store, record: () => values.get("route") };
}

/** Fake Tailscale CLI whose guest-port handler proxies to `serve.proxy`. */
function tailscale(serve: { proxy?: string }) {
  return vi.fn(async (_binary: string, args: string[]) => {
    if (args[0] === "status")
      return JSON.stringify({ BackendState: "Running", Self: { DNSName: "owner.ts.net." } });
    if (args[0] === "serve" && args.includes("status"))
      return JSON.stringify({
        Web: serve.proxy
          ? { "owner.ts.net:8443": { Handlers: { "/": { Proxy: serve.proxy } } } }
          : {},
      });
    if (args.includes("--bg")) serve.proxy = args.at(-1);
    if (args.includes("off")) serve.proxy = undefined;
    return "1.0";
  });
}

it("refuses occupied Tailscale guest port without changing existing web access", async () => {
  const command = vi.fn(async (_binary: string, args: string[]) => {
    if (args[0] === "status")
      return JSON.stringify({ BackendState: "Running", Self: { DNSName: "owner.ts.net." } });
    if (args[0] === "serve")
      return JSON.stringify({
        Web: { "owner.ts.net:8443": { Handlers: { "/": { Proxy: "http://127.0.0.1:9000" } } } },
      });
    return "1.0";
  });
  const publisher = new GuestPublisher(command);
  await expect(publisher.publish("http://127.0.0.1:1234/g/token/", "tailscale")).rejects.toThrow(
    "already in use",
  );
  expect(command.mock.calls.some(([, args]) => args.includes("--bg") || args.includes("off"))).toBe(
    false,
  );
});

it("creates and removes only its dedicated OpenTunnel route, never a real tunnel in tests", async () => {
  let route = "";
  let removed = false;
  const command = vi.fn(async (_binary: string, args: string[]) => {
    if (args.includes("list"))
      return route && !removed
        ? `${route}.host.opentunnel.xyz  →  127.0.0.1:1234`
        : "No routes configured.";
    if (args.includes("add")) {
      route = args[args.indexOf("--name") + 1]!;
      return `https://${route}.host.opentunnel.xyz`;
    }
    if (args.includes("remove")) removed = true;
    return "1.0";
  });
  const publisher = new GuestPublisher(command);
  const url = await publisher.publish("http://127.0.0.1:1234/g/token/", "opentunnel");
  expect(url).toBe(`https://${route}.host.opentunnel.xyz/g/token/`);
  await publisher.stop();
  expect(removed).toBe(true);
  for (const [, args] of command.mock.calls.filter(([, args]) => args.includes("route")))
    expect(args.slice(0, 2)).toEqual(["--profile", "palot-guests"]);
  expect(
    command.mock.calls.some(([, args]) => args.includes("down") || args.includes("delete")),
  ).toBe(false);
});

it("leaves Tailscale handlers added externally on the guest port alone", async () => {
  let published = false;
  const command = vi.fn(async (_binary: string, args: string[]) => {
    if (args[0] === "status")
      return JSON.stringify({ BackendState: "Running", Self: { DNSName: "owner.ts.net." } });
    if (args[0] === "serve" && args.includes("status"))
      return JSON.stringify({
        Web: published
          ? {
              "owner.ts.net:8443": {
                Handlers: {
                  "/": { Proxy: "http://127.0.0.1:1234" },
                  "/other": { Proxy: "http://127.0.0.1:9000" },
                },
              },
            }
          : {},
      });
    if (args.includes("--bg")) published = true;
    return "1.0";
  });
  const publisher = new GuestPublisher(command);
  await publisher.publish("http://127.0.0.1:1234/g/token/", "tailscale");
  await expect(publisher.stop()).rejects.toThrow("changed externally");
  expect(command.mock.calls.some(([, args]) => args.includes("off"))).toBe(false);
});

it("does not remove an OpenTunnel route retargeted to a port with the same prefix", async () => {
  let route = "";
  const command = vi.fn(async (_binary: string, args: string[]) => {
    if (args.includes("list"))
      return route ? `${route}.host.opentunnel.xyz  →  127.0.0.1:12345` : "No routes configured.";
    if (args.includes("add")) {
      route = args[args.indexOf("--name") + 1]!;
      return `https://${route}.host.opentunnel.xyz`;
    }
    return "1.0";
  });
  const publisher = new GuestPublisher(command);
  await publisher.publish("http://127.0.0.1:1234/g/token/", "opentunnel");
  await expect(publisher.stop()).rejects.toThrow("changed externally");
  expect(command.mock.calls.some(([, args]) => args.includes("remove"))).toBe(false);
});

it("records the published route until it is unpublished", async () => {
  const routes = memoryStore();
  const publisher = new GuestPublisher(tailscale({}), routes.store);
  await publisher.publish("http://127.0.0.1:1234/g/token/", "tailscale");
  expect(routes.record()).toEqual({
    transport: "tailscale",
    target: "http://127.0.0.1:1234",
    origin: "https://owner.ts.net:8443",
  });
  await publisher.stop();
  expect(routes.record()).toBeUndefined();
});

it("removes a route left behind by an earlier process on the next start", async () => {
  const command = tailscale({ proxy: "http://127.0.0.1:1234" });
  const routes = memoryStore({
    transport: "tailscale",
    target: "http://127.0.0.1:1234",
    origin: "https://owner.ts.net:8443",
  });
  const publisher = new GuestPublisher(command, routes.store);
  await publisher.removeOrphanedRoute();
  expect(command.mock.calls.some(([, args]) => args.includes("off"))).toBe(true);
  expect(routes.record()).toBeUndefined();
  // The guest port is free again, so publishing works.
  await expect(publisher.publish("http://127.0.0.1:4321/g/token/", "tailscale")).resolves.toBe(
    "https://owner.ts.net:8443/g/token/",
  );
});

it("keeps the record when a leftover route cannot be removed, and spares live routes", async () => {
  const record = { transport: "tailscale", target: "http://127.0.0.1:1234", origin: "" };
  const changed = memoryStore(record);
  await expect(
    new GuestPublisher(
      tailscale({ proxy: "http://127.0.0.1:9000" }),
      changed.store,
    ).removeOrphanedRoute(),
  ).rejects.toThrow("changed externally");
  expect(changed.record()).toEqual(record);

  const live = memoryStore(record);
  const command = tailscale({ proxy: "http://127.0.0.1:1234" });
  await new GuestPublisher(command, live.store).removeOrphanedRoute(
    (target) => target === "http://127.0.0.1:1234",
  );
  expect(command).not.toHaveBeenCalled();
  expect(live.record()).toEqual(record);
});
