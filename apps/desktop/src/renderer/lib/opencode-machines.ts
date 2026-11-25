import {
  isConflictError,
  isForbiddenError,
  isInvalidRequestError,
  isMachineNotFoundError,
  type MachineInfo,
  type MachineInvite,
} from "@opencode/client";
import { isMissingOpenCodeRoute } from "../../shared/opencode-missing-route";
import { isMachineName } from "../../shared/machine-path";

/** OpenCode's `MACHINE_LINK_PATH`: where a worker's link lands on the server. */
export const MACHINE_LINK_PATH = "/api/experimental/machine/link";

export type MachineState = "connected" | "offline" | "waiting";

export interface MachineRow {
  name: string;
  state: MachineState;
  /** "Connected", "Offline" or "Waiting to join". */
  stateLabel: string;
  /** "linux · x64", only while connected. */
  platform: string | null;
  /** "WebSocket · direct · 12 ms", only while connected. */
  link: string | null;
}

/** One settings row per machine, sorted by name. */
export function machineRows(machines: readonly MachineInfo[]): MachineRow[] {
  return machines
    .map((machine): MachineRow => {
      const state: MachineState = !machine.paired
        ? "waiting"
        : machine.online
          ? "connected"
          : "offline";
      const platform =
        machine.online && (machine.os || machine.arch)
          ? [machine.os, machine.arch].filter(Boolean).join(" · ")
          : null;
      const connection = machine.online ? machine.connection : undefined;
      const link = connection
        ? [
            connection.kind === "iroh" ? "Iroh" : "WebSocket",
            connection.path,
            connection.rtt === undefined ? undefined : `${Math.round(connection.rtt)} ms`,
          ]
            .filter(Boolean)
            .join(" · ")
        : null;
      return {
        name: machine.id,
        state,
        stateLabel:
          state === "connected" ? "Connected" : state === "offline" ? "Offline" : "Waiting to join",
        platform,
        link,
      };
    })
    .toSorted((left, right) => left.name.localeCompare(right.name));
}

/** Whether a machine finished joining and is linked now: what the add dialog waits for. */
export function machineJoined(machines: readonly MachineInfo[], name: string): boolean {
  return machines.some((machine) => machine.id === name && machine.paired && machine.online);
}

/**
 * The link addresses a join string carries, from the server's own URLs, as OpenCode's CLI does:
 * each URL's link path over ws(s), addresses other computers can reach first, loopback last.
 */
export function machineReach(urls: readonly string[]): Array<{ type: "url"; url: string }> {
  const parsed = urls.flatMap((raw) => {
    try {
      const url = new URL(MACHINE_LINK_PATH, raw);
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      return [{ href: url.href, loopback: isLoopbackHost(url.hostname) }];
    } catch {
      return [];
    }
  });
  const ordered = [
    ...parsed.filter((entry) => !entry.loopback),
    ...parsed.filter((entry) => entry.loopback),
  ];
  return [...new Set(ordered.map((entry) => entry.href))].map((url) => ({ type: "url", url }));
}

export function isLoopbackHost(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.startsWith("127.") ||
    hostname === "[::1]"
  );
}

/** Where a join string can be used from, as one sentence. */
export function inviteReachSummary(reach: MachineInvite["reach"]): string {
  if (reach.some((entry) => entry.type === "iroh")) return "Works from any network.";
  if (reach.some((entry) => entry.type === "url" && !isLoopbackHost(urlHost(entry.url))))
    return "Works from computers that can reach one of these addresses.";
  return "Only works on the server's own computer: it listens on loopback addresses only.";
}

function urlHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

/** The addresses of a join string, as people read them. */
export function inviteAddresses(reach: MachineInvite["reach"]): string[] {
  return reach.map((entry) => (entry.type === "iroh" ? "Iroh relay network" : entry.url));
}

/** "Expires in 5 minutes", "Expires in less than a minute" or "Expired". */
export function inviteExpiryLabel(expires: number, now = Date.now()): string {
  const remaining = expires - now;
  if (remaining <= 0) return "Expired";
  const minutes = Math.round(remaining / 60_000);
  if (minutes === 0) return "Expires in less than a minute";
  return `Expires in ${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
}

/** A name problem before anything is sent, or null when OpenCode will accept it. */
export function machineNameProblem(name: string): string | null {
  if (!name) return "Enter a name.";
  if (isMachineName(name)) return null;
  return name === "local"
    ? "“local” is reserved for the server itself."
    : "Use 2 to 63 lowercase letters, digits and hyphens, starting with a letter.";
}

/** Whether the server lacks machines: the flag is off (Forbidden) or the route predates them. */
export function machinesUnavailable(error: unknown): boolean {
  return isForbiddenError(error) || isMissingOpenCodeRoute(error);
}

/** A machine call's failure as one sentence, following OpenCode's CLI wording. */
export function machineErrorMessage(error: unknown, name?: string): string {
  if (isForbiddenError(error))
    return "Machines are turned off on this server. Set experimental.machines to true in its OpenCode config.";
  if (isInvalidRequestError(error) && error.kind === "invalid_name")
    return `${name ? `“${name}”` : "That name"} is not a valid machine name. Use 2 to 63 lowercase letters, digits and hyphens, starting with a letter, and not “local”.`;
  if (isMachineNotFoundError(error)) return `No machine named “${name ?? error.machine}”.`;
  if (isConflictError(error))
    return `${name ? `“${name}”` : "This machine"} is already paired. Replace its key to make a new join string; the computer paired now stops connecting once the new one joins.`;
  if (error instanceof Error && error.message) return error.message;
  return "OpenCode could not complete the machine request.";
}

export function isMachineConflict(error: unknown): boolean {
  return isConflictError(error);
}
