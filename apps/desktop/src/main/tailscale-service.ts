import { execFile } from "node:child_process";
import { promisify } from "node:util";
import Store from "electron-store";
import type { TailscaleWebAccessInfo } from "../shared/opencode-contract";
import { openCodeLog } from "./opencode-observability";

const execFileAsync = promisify(execFile);
const READ_TIMEOUT_MS = 5_000;
const MUTATION_TIMEOUT_MS = 20_000;
const MAX_OUTPUT_BYTES = 512 * 1_024;

interface CommandResult {
  stdout: string;
  stderr: string;
}

export interface TailscaleCommandRunner {
  run(command: string, args: string[], timeout: number): Promise<CommandResult>;
}

interface TailscaleOwnershipStore {
  get(key: "rootServeTarget"): string | undefined;
  set(key: "rootServeTarget", value: string): void;
  delete(key: "rootServeTarget"): void;
}

interface TailscaleStatusDocument {
  BackendState?: unknown;
  Self?: { DNSName?: unknown };
}

export interface ParsedTailscaleServeStatus {
  state: "inactive" | "active" | "conflict";
  proxyTarget: string | null;
}

const defaultRunner: TailscaleCommandRunner = {
  async run(command, args, timeout) {
    const result = await execFileAsync(command, args, {
      timeout,
      maxBuffer: MAX_OUTPUT_BYTES,
      encoding: "utf8",
    });
    return { stdout: result.stdout, stderr: result.stderr };
  },
};

function normalizedDnsName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const result = value.trim().replace(/\.$/, "");
  return result || null;
}

function parseJson(value: string, label: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new Error(`${label} returned invalid JSON`);
  }
}

export function assertLoopbackOpenCodeEndpoint(value: string): string {
  const url = new URL(value);
  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "::1"].includes(hostname)) {
    throw new Error("Tailscale web access requires a loopback HTTP OpenCode service");
  }
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("The OpenCode service URL cannot include credentials, a path, or query data");
  }
  return url.toString().replace(/\/$/, "");
}

export function parseTailscaleServeStatus(
  value: string,
  expectedTarget: string | null,
): ParsedTailscaleServeStatus {
  const document = parseJson(value, "Tailscale Serve");
  if (!document || typeof document !== "object" || Array.isArray(document)) {
    throw new Error("Tailscale Serve returned an invalid configuration");
  }
  const web = (document as { Web?: unknown }).Web;
  if (!web || typeof web !== "object" || Array.isArray(web)) {
    return { state: "inactive", proxyTarget: null };
  }
  const rootTargets: string[] = [];
  for (const entry of Object.values(web)) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const handlers = (entry as { Handlers?: unknown }).Handlers;
    if (!handlers || typeof handlers !== "object" || Array.isArray(handlers)) continue;
    const root = (handlers as Record<string, unknown>)["/"];
    if (!root || typeof root !== "object" || Array.isArray(root)) continue;
    const proxy = (root as { Proxy?: unknown }).Proxy;
    if (typeof proxy === "string") rootTargets.push(proxy.replace(/\/$/, ""));
  }
  if (rootTargets.length === 0) return { state: "inactive", proxyTarget: null };
  const target = rootTargets[0]!;
  if (rootTargets.length === 1 && expectedTarget && target === expectedTarget) {
    return { state: "active", proxyTarget: target };
  }
  return { state: "conflict", proxyTarget: target };
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return String(error);
}

export class TailscaleService {
  private binary: string | null = null;

  constructor(
    private readonly runner: TailscaleCommandRunner = defaultRunner,
    private readonly ownership: TailscaleOwnershipStore = new Store<{
      rootServeTarget?: string;
    }>({ name: "tailscale-web-access" }),
    private readonly candidates = tailscaleCandidates(),
  ) {}

  async status(expectedEndpoint: string | null): Promise<TailscaleWebAccessInfo> {
    const expectedTarget = expectedEndpoint
      ? assertLoopbackOpenCodeEndpoint(expectedEndpoint)
      : null;
    const ownedTarget = this.ownership.get("rootServeTarget") ?? null;
    const comparisonTarget = ownedTarget ?? expectedTarget;
    const binary = await this.discoverBinary();
    if (!binary) return unavailable("Tailscale CLI was not found");

    let version: string | null = null;
    try {
      const result = await this.runner.run(binary, ["version"], READ_TIMEOUT_MS);
      version = result.stdout.split(/\r?\n/, 1)[0]?.trim() || null;
    } catch (error) {
      return unavailable(`Tailscale is unavailable: ${errorMessage(error)}`);
    }

    let status: TailscaleStatusDocument;
    try {
      const result = await this.runner.run(binary, ["status", "--json"], READ_TIMEOUT_MS);
      status = parseJson(result.stdout, "Tailscale status") as TailscaleStatusDocument;
    } catch (error) {
      return {
        ...unavailable(`Could not read Tailscale status: ${errorMessage(error)}`),
        connectionState: "disconnected",
        version,
      };
    }

    const backendState = typeof status.BackendState === "string" ? status.BackendState : null;
    const dnsName = normalizedDnsName(status.Self?.DNSName);
    if (backendState !== "Running") {
      return {
        connectionState: "disconnected",
        backendState,
        version,
        dnsName,
        publicUrl: null,
        serveState: "inactive",
        proxyTarget: null,
        managedByPalot: false,
        error: null,
      };
    }

    try {
      const result = await this.runner.run(binary, ["serve", "status", "--json"], READ_TIMEOUT_MS);
      const serve = parseTailscaleServeStatus(result.stdout, comparisonTarget);
      const managedByPalot =
        serve.state === "active" && ownedTarget !== null && serve.proxyTarget === ownedTarget;
      if (ownedTarget && !managedByPalot) this.ownership.delete("rootServeTarget");
      return {
        connectionState: "connected",
        backendState,
        version,
        dnsName,
        publicUrl: dnsName ? `https://${dnsName}` : null,
        serveState: serve.state,
        proxyTarget: serve.proxyTarget,
        managedByPalot,
        error: null,
      };
    } catch (error) {
      return {
        connectionState: "connected",
        backendState,
        version,
        dnsName,
        publicUrl: dnsName ? `https://${dnsName}` : null,
        serveState: "inactive",
        proxyTarget: null,
        managedByPalot: false,
        error: `Could not read Tailscale Serve status: ${errorMessage(error)}`,
      };
    }
  }

  async enable(endpoint: string): Promise<TailscaleWebAccessInfo> {
    const target = assertLoopbackOpenCodeEndpoint(endpoint);
    const before = await this.status(target);
    if (before.connectionState !== "connected") {
      throw new Error(before.error ?? "Connect Tailscale before enabling web access");
    }
    if (before.error) throw new Error(before.error);
    if (before.serveState === "conflict") {
      throw new Error("Tailscale Serve already has a different root web handler");
    }
    if (before.serveState === "active") {
      if (before.proxyTarget !== target) {
        throw new Error(
          "Disable Palot's existing Tailscale web access before sharing a new endpoint",
        );
      }
      return before;
    }
    const binary = await this.requireBinary();
    openCodeLog.info("enabling Tailscale web access", { target });
    await this.runner.run(
      binary,
      ["serve", "--bg", "--yes", "--https=443", "--set-path=/", target],
      MUTATION_TIMEOUT_MS,
    );
    const after = await this.status(target);
    if (after.serveState !== "active") {
      throw new Error(after.error ?? "Tailscale Serve did not expose the OpenCode service");
    }
    this.ownership.set("rootServeTarget", target);
    return { ...after, managedByPalot: true };
  }

  async disable(endpoint: string | null): Promise<TailscaleWebAccessInfo> {
    const storedTarget = this.ownership.get("rootServeTarget");
    const target = storedTarget ?? (endpoint ? assertLoopbackOpenCodeEndpoint(endpoint) : null);
    if (!target) throw new Error("Palot has no managed Tailscale Serve handler to disable");
    const before = await this.status(target);
    if (before.connectionState !== "connected") {
      throw new Error("Connect Tailscale before disabling Palot's web access");
    }
    if (before.error) throw new Error(before.error);
    if (before.serveState === "inactive") {
      this.ownership.delete("rootServeTarget");
      return before;
    }
    if (!before.managedByPalot) {
      throw new Error("Palot will not remove a Tailscale Serve handler it did not create");
    }
    const binary = await this.requireBinary();
    openCodeLog.info("disabling Tailscale web access", { target });
    await this.runner.run(
      binary,
      ["serve", "--https=443", "--set-path=/", "off"],
      MUTATION_TIMEOUT_MS,
    );
    this.ownership.delete("rootServeTarget");
    return this.status(target);
  }

  private async discoverBinary(): Promise<string | null> {
    if (this.binary) return this.binary;
    for (const candidate of this.candidates) {
      try {
        await this.runner.run(candidate, ["version"], READ_TIMEOUT_MS);
        this.binary = candidate;
        return candidate;
      } catch {
        continue;
      }
    }
    return null;
  }

  private async requireBinary(): Promise<string> {
    const binary = await this.discoverBinary();
    if (!binary) throw new Error("Tailscale CLI was not found");
    return binary;
  }
}

function tailscaleCandidates(): string[] {
  return [
    ...(process.env.TAILSCALE_BIN?.trim() ? [process.env.TAILSCALE_BIN.trim()] : []),
    "tailscale",
    "/usr/local/bin/tailscale",
    "/opt/homebrew/bin/tailscale",
    "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
  ];
}

function unavailable(error: string): TailscaleWebAccessInfo {
  return {
    connectionState: "unavailable",
    backendState: null,
    version: null,
    dnsName: null,
    publicUrl: null,
    serveState: "inactive",
    proxyTarget: null,
    managedByPalot: false,
    error,
  };
}

let instance: TailscaleService | null = null;

export function tailscaleService(): TailscaleService {
  return (instance ??= new TailscaleService());
}
