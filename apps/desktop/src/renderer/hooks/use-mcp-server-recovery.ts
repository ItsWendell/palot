import { useEffect, useRef, useState } from "react";
import type {
  McpServerInput,
  PalotIntegration,
  PalotMcpServer,
  SettingsLocationInput,
} from "../../shared";
import {
  connectAndVerifyMcpServer,
  mcpServerAction,
  type McpServerAction,
  type McpServerConnector,
} from "../lib/mcp-server-recovery";
import {
  connectMcpServer,
  getIntegration,
  getMcpServerStatus,
} from "../services/opencode-settings";
import { palot } from "../services/palot";

export interface McpServerOperations extends McpServerConnector {
  disconnect(input: McpServerInput): Promise<void>;
  remove(input: McpServerInput): Promise<void>;
  integration(
    input: SettingsLocationInput & { integrationID: string },
    signal: AbortSignal,
  ): Promise<PalotIntegration>;
}

const OPENCODE_OPERATIONS: McpServerOperations = {
  connect: connectMcpServer,
  status: getMcpServerStatus,
  disconnect: (input) => palot.disconnectMcpServer(input),
  remove: (input) => palot.removeMcpServer(input),
  integration: getIntegration,
};

type Busy = "connect" | "disconnect" | "remove" | "sign-in";

interface RowState {
  scope: string;
  busy: Busy | null;
  signIn: PalotIntegration | null;
}

/**
 * Drives one MCP server row: connect or retry with an authoritative status check, sign in
 * through the server's OpenCode integration, disconnect, and remove. Work belongs to the
 * connection, location, and server it started for; changing any of them cancels it and
 * drops its results.
 */
export function useMcpServerRecovery({
  input,
  server,
  refresh,
  showError,
  operations = OPENCODE_OPERATIONS,
}: {
  input: McpServerInput;
  server: PalotMcpServer;
  refresh(): Promise<void>;
  showError(title: string, cause: unknown): void;
  operations?: McpServerOperations;
}) {
  const scope = JSON.stringify([
    input.connectionID ?? null,
    input.directory,
    input.workspaceID ?? "",
    input.server,
  ]);
  const [state, setState] = useState<RowState | null>(null);
  const current = state?.scope === scope ? state : null;
  const controllers = useRef(new Set<AbortController>());
  const busyRef = useRef<Busy | null>(null);

  useEffect(() => {
    const active = controllers.current;
    return () => {
      for (const controller of active) controller.abort();
      active.clear();
      busyRef.current = null;
    };
  }, [scope]);

  const update = (owner: string, patch: Partial<Omit<RowState, "scope">>) =>
    setState((previous) =>
      owner === scope
        ? {
            scope: owner,
            busy: null,
            signIn: null,
            ...(previous?.scope === owner ? previous : {}),
            ...patch,
          }
        : previous,
    );

  function begin(busy: Busy) {
    if (busyRef.current) return null;
    busyRef.current = busy;
    const controller = new AbortController();
    controllers.current.add(controller);
    const owner = scope;
    update(owner, { busy, signIn: null });
    return {
      owner,
      signal: controller.signal,
      finish() {
        controllers.current.delete(controller);
        if (controller.signal.aborted) return;
        busyRef.current = null;
        update(owner, { busy: null });
      },
    };
  }

  async function refreshQuietly() {
    try {
      await refresh();
    } catch {
      // The settings view reports its own load failures.
    }
  }

  async function openSignIn(integrationID: string, owner: string, signal: AbortSignal) {
    const integration = await operations.integration({ ...input, integrationID }, signal);
    signal.throwIfAborted();
    update(owner, { signIn: integration });
  }

  async function connect() {
    const operation = begin("connect");
    if (!operation) return;
    try {
      const result = await connectAndVerifyMcpServer(operations, input, operation.signal);
      await refreshQuietly();
      operation.signal.throwIfAborted();
      if (result.status === "needs_auth") {
        if (!result.integrationID) {
          showError(
            `${server.name} needs authorization`,
            new Error(result.error ?? "OpenCode can't sign in to this server from Palot."),
          );
        } else {
          await openSignIn(result.integrationID, operation.owner, operation.signal);
        }
      }
    } catch (cause) {
      if (operation.signal.aborted) return;
      // Show the failed status OpenCode now reports next to the error.
      await refreshQuietly();
      if (!operation.signal.aborted) showError(`Could not connect ${server.name}`, cause);
    } finally {
      operation.finish();
    }
  }

  async function signIn() {
    if (!server.integrationID) return;
    const operation = begin("sign-in");
    if (!operation) return;
    try {
      await openSignIn(server.integrationID, operation.owner, operation.signal);
    } catch (cause) {
      if (!operation.signal.aborted) showError(`Could not sign in to ${server.name}`, cause);
    } finally {
      operation.finish();
    }
  }

  async function change(kind: "disconnect" | "remove") {
    const operation = begin(kind);
    if (!operation) return;
    try {
      await operations[kind](input);
      operation.signal.throwIfAborted();
      await refresh();
    } catch (cause) {
      if (!operation.signal.aborted) showError(`Could not ${kind} ${server.name}`, cause);
    } finally {
      operation.finish();
    }
  }

  /**
   * Runs after the integration's sign-in completes. OpenCode reconnects on its own when the
   * credential changes; connecting again waits for that handshake so the status is final.
   * Rejecting keeps the sign-in dialog open and reports why instead of claiming success.
   */
  async function completeSignIn() {
    const controller = new AbortController();
    controllers.current.add(controller);
    try {
      const result = await connectAndVerifyMcpServer(operations, input, controller.signal);
      await refreshQuietly();
      if (result.status === "needs_auth") {
        throw new Error(
          `${server.name} still needs authorization${result.error ? `: ${result.error}` : "."}`,
        );
      }
    } finally {
      controllers.current.delete(controller);
    }
  }

  const busy = current?.busy ?? null;
  const action: McpServerAction =
    busy === "connect" ? { type: "pending", label: "Connecting…" } : mcpServerAction(server);

  return {
    action,
    busy: busy !== null,
    /** The integration to sign in with while its dialog is open. */
    signIn: current?.signIn ?? null,
    run() {
      if (action.type === "disconnect") return change("disconnect");
      if (action.type === "sign-in") return signIn();
      if (action.type === "retry" || action.type === "connect") return connect();
      return Promise.resolve();
    },
    remove: () => change("remove"),
    closeSignIn: () => update(scope, { signIn: null }),
    completeSignIn,
  };
}
