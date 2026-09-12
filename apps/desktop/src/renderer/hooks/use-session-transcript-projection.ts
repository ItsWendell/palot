import { useMemo } from "react";
import {
  createSessionTranscriptProjector,
  type SessionTranscriptProjection,
  type SessionTranscriptProjectionInput,
  type SessionTranscriptProjector,
} from "../lib/turn-projection";
import { MAX_RETAINED_SESSION_VIEWS } from "../lib/session-view-retention";

const retainedProjectors = new Map<string, SessionTranscriptProjector>();

function sessionProjector(connectionID: string, sessionID: string): SessionTranscriptProjector {
  const key = `${connectionID}\0${sessionID}`;
  const existing = retainedProjectors.get(key);
  if (existing) {
    retainedProjectors.delete(key);
    retainedProjectors.set(key, existing);
    return existing;
  }

  const projector = createSessionTranscriptProjector();
  retainedProjectors.set(key, projector);
  while (retainedProjectors.size > MAX_RETAINED_SESSION_VIEWS) {
    const oldest = retainedProjectors.keys().next().value;
    if (oldest === undefined) break;
    retainedProjectors.delete(oldest);
  }
  return projector;
}

export function useSessionTranscriptProjection(
  input: SessionTranscriptProjectionInput & { connectionID: string; sessionID: string },
): SessionTranscriptProjection {
  const projector = useMemo(
    () => sessionProjector(input.connectionID, input.sessionID),
    [input.connectionID, input.sessionID],
  );
  return useMemo(
    () =>
      projector.project({
        messages: input.messages,
        execution: input.execution,
        requests: input.requests,
        diffs: input.diffs,
        runtimeStatus: input.runtimeStatus,
        initialLocation: input.initialLocation,
        policy: input.policy,
      }),
    [
      input.diffs,
      input.execution,
      input.initialLocation,
      input.messages,
      input.policy,
      input.requests,
      input.runtimeStatus,
      projector,
    ],
  );
}
