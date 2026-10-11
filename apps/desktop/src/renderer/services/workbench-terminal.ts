import type { LocationRef } from "@opencode/client";
import type {
  OpenWorkbenchTabInput,
  OpenWorkbenchTabOptions,
  OpenWorkbenchTabResult,
  WorkbenchTab,
} from "../lib/workbench-tabs";
import { palot } from "./palot";
import { ptyNotFound } from "./opencode-pty";

export type WorkbenchTerminalStatus =
  | "connecting"
  | "connected"
  | "reconnecting"
  | "exited"
  | "error";
type TerminalResource = Extract<WorkbenchTab, { kind: "terminal" }>["resource"];
type PtyEvent = Parameters<Parameters<typeof palot.onPtyEvent>[0]>[0];

/** Reattach to the same PTY only. Cancellation detaches sockets, never ends processes. */
export function recoverWorkbenchTerminal(
  resource: TerminalResource,
  ownerConnectionID: string,
  options: {
    cursor(): number;
    readOnly: boolean;
    onData(data: Extract<PtyEvent, { type: "data" }>["data"]): void;
    onStatus(status: WorkbenchTerminalStatus, error?: unknown): void;
  },
) {
  const MAX_RETRIES = 5;
  let stopped = false;
  let exited = false;
  let generation = 0;
  let retries = 0;
  let connectionID: string | null = null;
  let unsubscribe: (() => void) | undefined;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let openTimer: ReturnType<typeof setTimeout> | undefined;
  const current = (attempt: number) => !stopped && !exited && generation === attempt;
  const detach = () => {
    generation += 1;
    clearTimeout(retryTimer);
    clearTimeout(openTimer);
    unsubscribe?.();
    unsubscribe = undefined;
    const attached = connectionID;
    connectionID = null;
    if (attached) void palot.disconnectPty(attached).catch(() => undefined);
  };
  const exit = () => {
    if (stopped || exited) return;
    exited = true;
    detach();
    options.onStatus("exited");
  };
  const failed = (error: unknown) => {
    if (stopped || exited) return;
    detach();
    if (ptyNotFound(error)) {
      exit();
      return;
    }
    if (retries >= MAX_RETRIES) {
      options.onStatus("error", error);
      return;
    }
    options.onStatus("reconnecting", error);
    const attempt = generation;
    retryTimer = setTimeout(
      () => {
        if (current(attempt)) void connect(true);
      },
      Math.min(250 * 2 ** retries, 4_000),
    );
    retries += 1;
  };
  const connect = async (verify: boolean) => {
    if (stopped || exited) return;
    const attempt = ++generation;
    options.onStatus(verify ? "reconnecting" : "connecting");
    try {
      if (verify) {
        const pty = await palot.getPty(
          resource.location,
          resource.ptyID,
          resource.transport,
          ownerConnectionID,
        );
        if (!current(attempt)) return;
        if (pty.status === "exited") {
          exit();
          return;
        }
      }
      const attached = await palot.connectPty(
        {
          ptyID: resource.ptyID,
          location: resource.location,
          transport: resource.transport,
          cursor: options.cursor(),
          ...(options.readOnly ? { readOnly: true } : {}),
        },
        ownerConnectionID,
      );
      if (!current(attempt)) {
        void palot.disconnectPty(attached).catch(() => undefined);
        return;
      }
      connectionID = attached;
      unsubscribe = palot.onPtyEvent((event) => {
        if (!current(attempt) || event.connectionID !== attached) return;
        if (event.type === "open") {
          clearTimeout(openTimer);
          // A flapping socket is still one outage. Reset the budget only after a stable connection.
          openTimer = setTimeout(() => {
            if (current(attempt)) retries = 0;
          }, 10_000);
          options.onStatus("connected");
        } else if (event.type === "data") {
          options.onData(event.data);
        } else if (event.type === "error" || event.type === "close") {
          failed(
            new Error(event.type === "error" ? event.message : "Terminal connection interrupted"),
          );
        }
      });
      openTimer = setTimeout(() => {
        if (current(attempt)) failed(new Error("Terminal connection timed out"));
      }, 10_000);
      if (current(attempt)) await palot.startPty(attached);
    } catch (error) {
      if (current(attempt)) failed(error);
    }
  };
  void connect(false);
  return {
    connectionID: () => connectionID,
    reconnect: () => {
      if (stopped || exited) return;
      detach();
      retries = 0;
      void connect(true);
    },
    exit,
    stop: () => {
      stopped = true;
      detach();
    },
  };
}

export async function openNewWorkbenchTerminal(
  sessionID: string,
  location: LocationRef,
  openTab: (
    input: OpenWorkbenchTabInput,
    options?: OpenWorkbenchTabOptions,
  ) => OpenWorkbenchTabResult | undefined,
  options: OpenWorkbenchTabOptions = { pane: "bottom" },
  connectionID?: string,
): Promise<OpenWorkbenchTabResult> {
  const pty = await palot.createPty(sessionID, location, connectionID);
  const result = openTab(
    { kind: "terminal", location, ptyID: pty.id, sessionID, transport: pty.transport },
    options,
  );
  if (result?.ok) return result;
  await palot.removePty(location, pty.id, pty.transport, connectionID).catch(() => undefined);
  throw new Error("Close a workbench tab before opening another terminal");
}
