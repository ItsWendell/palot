import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { promisify } from "node:util";
import Store from "electron-store";

const exec = promisify(execFile);
export type GuestCommandRunner = (binary: string, args: string[]) => Promise<string>;
const run: GuestCommandRunner = async (binary, args) =>
  (await exec(binary, args, { timeout: 90000, maxBuffer: 512000, encoding: "utf8" })).stdout;

export interface GuestRoute {
  transport: "tailscale" | "opentunnel";
  target: string;
  origin: string;
  route?: string;
}

/** Survives restarts and crashes, so the next start can remove a route whose listener is gone. */
export interface GuestRouteStore {
  get(key: "route"): unknown;
  set(key: "route", value: GuestRoute): void;
  delete(key: "route"): void;
}

function persistedRoute(value: unknown): GuestRoute | null {
  if (!value || typeof value !== "object") return null;
  const { transport, target, origin, route } = value as Record<string, unknown>;
  if (transport !== "tailscale" && transport !== "opentunnel") return null;
  if (typeof target !== "string" || !/^http:\/\/127\.0\.0\.1:\d+$/.test(target)) return null;
  if (typeof origin !== "string") return null;
  if (route !== undefined && (typeof route !== "string" || !/^guest-[a-f0-9]+$/.test(route)))
    return null;
  if (transport === "opentunnel" && !route) return null;
  return { transport, target, origin, ...(route ? { route } : {}) };
}

/** Separate from OpenCode web access. Never resets Serve or changes the default tunnel profile. */
export class GuestPublisher {
  private tailscale: string | null = null;
  private opentunnel: string | null = null;
  private owned: GuestRoute | null = null;
  private readonly profile = "palot-guests";
  private stopping?: Promise<void>;
  private recovering?: Promise<void>;
  private routeStore?: GuestRouteStore;
  constructor(
    private readonly command: GuestCommandRunner = run,
    private readonly store: () => GuestRouteStore = () =>
      new Store<{ route?: GuestRoute }>({ name: "guest-link-route" }),
  ) {}
  private get persisted() {
    this.routeStore ??= this.store();
    return this.routeStore;
  }
  private remember(route: GuestRoute) {
    this.owned = route;
    this.persisted.set("route", route);
  }
  /**
   * Removes a route recorded by an earlier process that exited without unpublishing it. A failure
   * keeps the record so the next start tries again.
   */
  removeOrphanedRoute(isLive: (target: string) => boolean = () => false) {
    const recovering = this.removeRecordedRoute(isLive);
    this.recovering = recovering.catch(() => undefined);
    return recovering;
  }
  private async removeRecordedRoute(isLive: (target: string) => boolean) {
    await this.stopping;
    if (this.owned) return;
    const route = persistedRoute(this.persisted.get("route"));
    if (!route) {
      this.persisted.delete("route");
      return;
    }
    if (isLive(route.target)) return;
    await this.options();
    if (!(route.transport === "tailscale" ? this.tailscale : this.opentunnel))
      throw new Error(`The ${route.transport} CLI was not found; the guest route record was kept`);
    this.owned = route;
    try {
      await this.stop();
    } catch (error) {
      this.owned = null;
      throw error;
    }
  }
  async options() {
    const discover = async (candidates: string[], args: string[]) => {
      for (const candidate of candidates) {
        try {
          await this.command(candidate, args);
          return candidate;
        } catch {
          /* Try next installation. */
        }
      }
      return null;
    };
    [this.tailscale, this.opentunnel] = await Promise.all([
      discover(
        [
          "tailscale",
          "/usr/local/bin/tailscale",
          "/opt/homebrew/bin/tailscale",
          "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
        ],
        ["version"],
      ),
      discover(
        ["opentunnel", "/usr/local/bin/opentunnel", "/opt/homebrew/bin/opentunnel"],
        ["--version"],
      ),
    ]);
    return { tailscale: this.tailscale !== null, opentunnel: this.opentunnel !== null };
  }
  async publish(localUrl: string, transport: "tailscale" | "opentunnel") {
    await this.recovering;
    await this.stopping;
    const url = new URL(localUrl);
    if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || !url.port)
      throw new Error("Guest target must be loopback");
    if (this.owned) {
      if (
        this.owned.target !== url.origin ||
        this.owned.transport !== transport ||
        !this.owned.origin
      )
        throw new Error("Stop existing guest links before changing or retrying publishing");
      return this.owned.origin + url.pathname;
    }
    await this.options();
    if (transport === "tailscale") {
      if (!this.tailscale) throw new Error("Tailscale CLI was not found");
      const status = JSON.parse(await this.command(this.tailscale, ["status", "--json"])) as {
        BackendState?: string;
        Self?: { DNSName?: string };
      };
      const dns = status.Self?.DNSName?.replace(/\.$/, "");
      if (status.BackendState !== "Running" || !dns || !/^[a-zA-Z0-9.-]+$/.test(dns))
        throw new Error("Connect Tailscale first");
      const config = JSON.parse(
        await this.command(this.tailscale, ["serve", "status", "--json"]),
      ) as { Web?: Record<string, unknown>; TCP?: Record<string, unknown> };
      if (
        config.TCP?.["8443"] ||
        Object.keys(config.Web ?? {}).some((key) => key.endsWith(":8443"))
      )
        throw new Error("Tailscale HTTPS port 8443 is already in use; Palot will not replace it");
      this.remember({ transport, target: url.origin, origin: "" });
      await this.command(this.tailscale, ["serve", "--bg", "--yes", "--https=8443", url.origin]);
      this.remember({ ...this.owned!, origin: `https://${dns}:8443` });
    } else {
      if (!this.opentunnel) throw new Error("OpenTunnel CLI was not found");
      const args = ["--profile", this.profile];
      await this.command(this.opentunnel, [...args, "status"]);
      const routes = await this.command(this.opentunnel, [...args, "route", "list"]);
      if (!routes.includes("No routes configured."))
        throw new Error(
          "The palot-guests OpenTunnel profile already has routes. Remove its old guest routes before publishing; Palot will not overwrite them",
        );
      const route = `guest-${randomBytes(10).toString("hex")}`;
      this.remember({ transport, target: url.origin, origin: "", route });
      const output = await this.command(this.opentunnel, [
        ...args,
        "route",
        "add",
        `127.0.0.1:${url.port}`,
        "--name",
        route,
      ]);
      const origin = output.split(/\r?\n/).find((line) => line.startsWith(`https://${route}.`));
      if (!origin || !/^https:\/\/[a-z0-9.-]+$/.test(origin))
        throw new Error(
          "OpenTunnel did not return a route URL. Stop sharing to remove the guest route",
        );
      this.remember({ ...this.owned!, origin });
    }
    return this.owned!.origin + url.pathname;
  }
  async stop() {
    if (this.stopping) return this.stopping;
    this.stopping = this.removeOwned();
    try {
      await this.stopping;
    } finally {
      this.stopping = undefined;
    }
  }
  private async removeOwned() {
    const owned = this.owned;
    if (!owned) return;
    if (owned.transport === "tailscale" && this.tailscale) {
      const status = JSON.parse(
        await this.command(this.tailscale, ["serve", "status", "--json"]),
      ) as { Web?: Record<string, { Handlers?: Record<string, { Proxy?: string }> }> };
      const entries = Object.entries(status.Web ?? {}).filter(([key]) => key.endsWith(":8443"));
      if (
        entries.length &&
        (entries.length !== 1 ||
          Object.keys(entries[0]![1].Handlers ?? {}).length !== 1 ||
          entries[0]![1].Handlers?.["/"]?.Proxy?.replace(/\/$/, "") !== owned.target)
      )
        throw new Error("Guest Tailscale handler changed externally; it was not removed");
      if (entries.length) await this.command(this.tailscale, ["serve", "--https=8443", "off"]);
    } else if (this.opentunnel && owned.route) {
      const args = ["--profile", this.profile];
      const routes = await this.command(this.opentunnel, [...args, "route", "list"]);
      const line = routes.split(/\r?\n/).find((line) => line.startsWith(`${owned.route}.`));
      if (line && line.split(/\s+→\s+/)[1]?.trim() !== owned.target.replace("http://", ""))
        throw new Error("Guest OpenTunnel route changed externally; it was not removed");
      if (line) await this.command(this.opentunnel, [...args, "route", "remove", owned.route]);
      // Leave the dedicated profile's identity and service alone; never delete it.
    }
    this.owned = null;
    this.persisted.delete("route");
  }
}
