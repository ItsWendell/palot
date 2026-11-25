import type {
  PalotProject,
  PalotSession,
  SessionRequestSnapshot,
  SessionTriageSnapshot,
} from "../../../../shared";
import type { SessionExecutionState } from "../../../atoms/workspace";
import { projectSessionInbox } from "../../session-inbox";
import type { ServerData } from "./project";

export const NOW = Date.UTC(2026, 10, 12, 12, 0, 0);

export function session(partial: Partial<PalotSession> & Pick<PalotSession, "id">): PalotSession {
  return {
    parentID: null,
    projectID: "project",
    title: partial.id,
    agent: null,
    model: null,
    location: { directory: "/repo" },
    createdAt: NOW - 3_600_000,
    updatedAt: NOW - 600_000,
    idleAt: NOW - 600_000,
    viewedAt: NOW - 600_000,
    archivedAt: null,
    cost: null,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    ...partial,
  };
}

export const project: PalotProject = {
  id: "project",
  canonical: "/repo",
  name: "Palot",
  sandboxes: [],
  vcs: null,
  updatedAt: 1,
};

export function requests(partial: Partial<SessionRequestSnapshot>): SessionRequestSnapshot {
  return { permissions: [], forms: [], inbox: [], errors: [], ...partial };
}

export interface ServerFixture {
  serverID?: string;
  connectionID?: string | null;
  online?: boolean;
  sessions: PalotSession[];
  projects?: PalotProject[];
  requests?: Record<string, SessionRequestSnapshot>;
  running?: Record<string, number>;
  execution?: Record<string, SessionExecutionState>;
  triage?: SessionTriageSnapshot["sessions"];
  marked?: string[];
  extra?: Partial<ServerData>;
}

/** A server as the hook builds it: the Inbox projection over the same sessions. */
export function serverData(fixture: ServerFixture): ServerData {
  const serverID = fixture.serverID ?? "local";
  const requestMap = new Map(Object.entries(fixture.requests ?? {}));
  const activeIDs = new Set(Object.keys(fixture.running ?? {}));
  const triage: SessionTriageSnapshot = {
    profileID: serverID,
    bootstrapThrough: null,
    sessions: fixture.triage ?? [],
  };
  const projects = fixture.projects ?? [project];
  return {
    serverID,
    name: serverID,
    connectionID:
      fixture.connectionID === undefined ? `${serverID}-connection` : fixture.connectionID,
    online: fixture.online ?? true,
    lastSeenAt: NOW - 120_000,
    focused: serverID === "local",
    canTriage: true,
    inbox: projectSessionInbox({
      sessions: fixture.sessions,
      projects,
      requests: requestMap,
      activeIDs,
      runningSinceBySession: new Map(Object.entries(fixture.running ?? {})),
      triage,
      now: NOW,
    }),
    sessions: fixture.sessions,
    projects,
    requests: requestMap,
    activeIDs,
    execution: new Map(Object.entries(fixture.execution ?? {})),
    isMarkedUnread: (sessionID) => fixture.marked?.includes(sessionID) ?? false,
    hasOlder: false,
    loadingOlder: false,
    ...fixture.extra,
  };
}
