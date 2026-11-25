import { createContext } from "react";
import type { SessionRuntimeStatus } from "../../atoms/workspace";
import type { PendingRequestView } from "../../lib/view-models";

/** What the running turn's live line needs beyond the turn itself. */
export interface LiveTurnInputs {
  /** Pending requests of the session and its subagents. */
  requests: readonly PendingRequestView[];
  runtimeStatus: SessionRuntimeStatus | null;
  /** The user pressed Stop and the run has not ended yet. */
  stopping: boolean;
  /** The live line's words, so the running activity group does not repeat them. */
  label: string | null;
  focusRequest(requestID: string): void;
  moveToBackground(): void;
}

export const LiveTurnContext = createContext<LiveTurnInputs | null>(null);
