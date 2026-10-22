import type { McpServerInput, PalotMcpServer } from "../../shared";

/** The one recovery step a server row offers for its current status. */
export type McpServerAction =
  | { type: "disconnect"; label: "Disconnect" }
  | { type: "sign-in"; label: "Sign in" }
  | { type: "retry"; label: "Retry" }
  | { type: "connect"; label: "Connect" }
  | { type: "pending"; label: "Connecting…" };

export function mcpServerAction(
  server: Pick<PalotMcpServer, "status" | "integrationID">,
): McpServerAction {
  switch (server.status) {
    case "connected":
      return { type: "disconnect", label: "Disconnect" };
    case "pending":
      return { type: "pending", label: "Connecting…" };
    case "needs_auth":
      // Only an integration-backed server can sign in through OpenCode; others can only retry.
      return server.integrationID
        ? { type: "sign-in", label: "Sign in" }
        : { type: "retry", label: "Retry" };
    case "failed":
      return { type: "retry", label: "Retry" };
    default:
      return { type: "connect", label: "Connect" };
  }
}

export interface McpServerConnector {
  connect(input: McpServerInput, signal: AbortSignal): Promise<void>;
  status(input: McpServerInput, signal: AbortSignal): Promise<PalotMcpServer | null>;
}

/**
 * Connects a server and reads back OpenCode's status. A successful connect request can
 * still leave the server failed, so only the status OpenCode reports afterwards counts.
 * Resolves with that status, including `needs_auth`; rejects when it is `failed`.
 */
export async function connectAndVerifyMcpServer(
  connector: McpServerConnector,
  input: McpServerInput,
  signal: AbortSignal,
): Promise<PalotMcpServer> {
  await connector.connect(input, signal);
  signal.throwIfAborted();
  const server = await connector.status(input, signal);
  if (!server) throw new Error(`OpenCode no longer lists ${input.server} in this project.`);
  if (server.status === "failed") {
    throw new Error(server.error ? `${server.name}: ${server.error}` : `${server.name} failed.`);
  }
  return server;
}
