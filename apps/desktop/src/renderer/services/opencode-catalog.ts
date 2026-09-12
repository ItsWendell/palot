import {
  isInvalidRequestError,
  isSessionNotFoundError,
  type Project,
  type SessionInfo,
  type SessionLogOutput,
  type SessionsResponse,
} from "@opencode/client";
import { openCodeClient } from "./opencode-client";
import { openCodeRequestSignal } from "./opencode-request";

export async function listProjectInfo(
  requestSignal?: AbortSignal,
  connectionID?: string,
): Promise<Project[]> {
  return openCodeClient(connectionID).project.list({
    signal: openCodeRequestSignal(requestSignal),
  });
}

export async function listRootSessionInfo(
  input: { limit?: number; cursor?: string; search?: string; project?: string } = {},
  requestSignal?: AbortSignal,
  connectionID?: string,
): Promise<SessionsResponse> {
  return openCodeClient(connectionID).session.list(
    {
      limit: input.limit ?? 50,
      parentID: null,
      ...(input.search ? { search: input.search } : {}),
      ...(input.project ? { project: input.project } : {}),
      ...(input.cursor ? { cursor: input.cursor } : { order: "desc" as const }),
    },
    { signal: openCodeRequestSignal(requestSignal) },
  );
}

export async function listChildSessionInfo(
  parentID: string,
  requestSignal?: AbortSignal,
  connectionID?: string,
): Promise<SessionInfo[]> {
  const client = openCodeClient(connectionID);
  const signal = openCodeRequestSignal(requestSignal);
  const sessions: SessionInfo[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  while (true) {
    const response = await client.session.list(
      { limit: 100, parentID, ...(cursor ? { cursor } : {}) },
      { signal },
    );
    sessions.push(...response.data);
    const next = response.cursor.next;
    if (!next || seen.has(next)) break;
    seen.add(next);
    cursor = next;
  }
  return sessions.toSorted((left, right) => left.time.created - right.time.created);
}

export async function getSessionInfo(
  sessionID: string,
  requestSignal?: AbortSignal,
  connectionID?: string,
): Promise<SessionInfo | null> {
  try {
    return await openCodeClient(connectionID).session.get(
      { sessionID },
      { signal: openCodeRequestSignal(requestSignal) },
    );
  } catch (error) {
    // A persisted selection can predate the current service or contain an old preview fixture ID.
    // session.get has no other request input, so either response means the session is unavailable.
    if (isSessionNotFoundError(error) || isInvalidRequestError(error)) return null;
    throw error;
  }
}

export async function listActiveSessionIDs(
  requestSignal?: AbortSignal,
  connectionID?: string,
): Promise<string[]> {
  const active = await openCodeClient(connectionID).session.active({
    signal: openCodeRequestSignal(requestSignal),
  });
  return Object.keys(active);
}

export async function loadSessionLog(
  sessionID: string,
  after?: number,
  requestSignal?: AbortSignal,
  connectionID?: string,
): Promise<SessionLogOutput[]> {
  const events: SessionLogOutput[] = [];
  for await (const event of openCodeClient(connectionID).session.log(
    { sessionID, ...(after === undefined ? {} : { after }), follow: false },
    { signal: openCodeRequestSignal(requestSignal) },
  )) {
    events.push(event);
  }
  return events;
}

export async function viewSession(
  sessionID: string,
  idle: number,
  requestSignal?: AbortSignal,
  connectionID?: string,
): Promise<void> {
  await openCodeClient(connectionID).session.view(
    { sessionID, idle },
    { signal: openCodeRequestSignal(requestSignal) },
  );
}
