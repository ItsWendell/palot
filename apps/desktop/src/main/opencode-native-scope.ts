import type { OpenCodeRuntimeStatus } from "../shared/opencode-contract";

/** Native actions remain focus-owned except explicitly scoped session-window opening. */
export function guardFocusedOpenCodeConnection(
  connectionID: unknown,
  status: () => Pick<OpenCodeRuntimeStatus, "connectionID" | "connected">,
): () => void {
  const validate = () => {
    const current = status();
    if (
      typeof connectionID !== "string" ||
      !connectionID ||
      current.connectionID !== connectionID ||
      !current.connected
    ) {
      throw new Error("Native action requires the current focused OpenCode connection ID");
    }
  };
  validate();
  return validate;
}

type SessionWindowRegistry = {
  scopedConnection(connectionID: string): { runtimeStatus(): OpenCodeRuntimeStatus };
  listRuntimes(): OpenCodeRuntimeStatus[];
};

/** Capture a retained lifecycle, not a mutable profile or active-runtime lookup. */
export function sessionWindowConnection(connectionID: unknown, registry: SessionWindowRegistry) {
  if (typeof connectionID !== "string" || !connectionID) {
    throw new Error("Session window requires an explicit OpenCode connection ID");
  }
  const scoped = registry.scopedConnection(connectionID);
  const profileID = scoped.runtimeStatus().profileID;
  const runtimeStatus = () => {
    const current = scoped.runtimeStatus();
    if (
      !current.connected ||
      current.connectionID !== connectionID ||
      current.profileID !== profileID
    ) {
      throw new Error("Session window OpenCode connection is disconnected or stale");
    }
    return current;
  };
  runtimeStatus();
  return { connectionID, profileID, runtimeStatus };
}

export type SessionWindowConnection = ReturnType<typeof sessionWindowConnection>;

/** Secondary-window focus is renderer-local and must never switch the global profile.
 * Only already-connected profiles can be selected here; connection management remains explicit.
 */
export function createSessionWindowScope(
  initial: SessionWindowConnection,
  registry: SessionWindowRegistry,
) {
  let current = initial;
  return {
    runtimeStatus: () => current.runtimeStatus(),
    switchProfile(profileID: string) {
      if (current.profileID === profileID) return current.runtimeStatus();
      const target = registry.listRuntimes().find((runtime) => runtime.profileID === profileID);
      const next = sessionWindowConnection(target?.connectionID, registry);
      current = next;
      return current.runtimeStatus();
    },
  };
}

export type SessionWindowScope = ReturnType<typeof createSessionWindowScope>;
