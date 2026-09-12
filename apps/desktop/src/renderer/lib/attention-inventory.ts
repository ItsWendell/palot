import type { PalotProject, PalotSession, SessionRequestSnapshot } from "../../shared";
import { actionableRequestViews, projectForSession, projectName } from "./view-models";

export interface AttentionRequest {
  key: string;
  legacyKey: string;
  id: string;
  sessionID: string;
  type: "permission" | "form" | "question" | "input";
  title: string;
  createdAt: number;
}

export interface AttentionItem {
  key: string;
  id: string;
  sessionID: string;
  projectName: string;
  sessionTitle: string;
  type: "permission" | "form" | "question" | "input";
  title: string;
  createdAt: number;
  count: number;
  types: Array<AttentionRequest["type"]>;
  requestKeys: string[];
  requests: AttentionRequest[];
}

export function attentionInventory(
  projects: PalotProject[],
  sessions: PalotSession[],
  requests: Map<string, SessionRequestSnapshot>,
): AttentionItem[] {
  const sessionByID = new Map(sessions.map((session) => [session.id, session]));
  const requestsByRoot = new Map<string, AttentionRequest[]>();
  for (const session of sessions) {
    const pending = requests.get(session.id);
    if (!pending) continue;
    const createdAtByID = requestCreatedAtByID(pending);
    const blockers = [
      ...new Map(
        actionableRequestViews(pending).map((request) => {
          const key = `${session.id}:${request.type}:${request.id}`;
          return [
            key,
            {
              key,
              legacyKey: `${session.id}:${request.id}`,
              id: request.id,
              sessionID: session.id,
              type: request.type as AttentionRequest["type"],
              title: request.title,
              createdAt: createdAtByID.get(request.id) ?? session.updatedAt,
            },
          ] as const;
        }),
      ).values(),
    ].toSorted(
      (left, right) => left.createdAt - right.createdAt || left.key.localeCompare(right.key),
    );
    const root = rootSession(session, sessionByID);
    const current = requestsByRoot.get(root.id);
    if (current) current.push(...blockers);
    else requestsByRoot.set(root.id, blockers);
  }

  return [...requestsByRoot]
    .flatMap(([rootID, unsortedBlockers]): AttentionItem[] => {
      const root = sessionByID.get(rootID);
      if (!root) return [];
      const blockers = unsortedBlockers.toSorted(
        (left, right) => left.createdAt - right.createdAt || left.key.localeCompare(right.key),
      );
      const primary = blockers[0];
      if (!primary) return [];
      const project = projectForSession(projects, root);
      const types = [...new Set(blockers.map((request) => request.type))];
      return [
        {
          key: root.id,
          id: primary.id,
          sessionID: primary.sessionID,
          projectName: project ? projectName(project) : "Unknown project",
          sessionTitle: root.title?.trim() || "Untitled task",
          type: primary.type,
          title:
            blockers.length === 1 ? primary.title : `${blockers.length} requests need attention`,
          createdAt: primary.createdAt,
          count: blockers.length,
          types,
          requestKeys: blockers.map((request) => request.key),
          requests: blockers,
        },
      ];
    })
    .toSorted(
      (left, right) =>
        left.createdAt - right.createdAt || left.sessionID.localeCompare(right.sessionID),
    );
}

function rootSession(session: PalotSession, sessionByID: Map<string, PalotSession>): PalotSession {
  let current = session;
  const seen = new Set([session.id]);
  while (current.parentID && !seen.has(current.parentID)) {
    const parent = sessionByID.get(current.parentID);
    if (!parent) break;
    seen.add(parent.id);
    current = parent;
  }
  return current;
}

function requestCreatedAtByID(requests: SessionRequestSnapshot): Map<string, number> {
  return new Map([
    ...requests.inbox.map((value) => [value.id, value.timeCreated] as const),
    ...Object.entries(requests.requestCreatedAtByID ?? {}),
  ]);
}
