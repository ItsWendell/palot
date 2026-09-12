import type { PalotSession, SessionRequestSnapshot } from "../../shared";
import { actionableRequestViews, type PendingRequestView } from "./view-models";

export type RequestSession = Pick<PalotSession, "id" | "parentID" | "title">;
export type OwnedPendingRequestView = PendingRequestView & {
  sessionID: string;
  sessionTitle: string;
};

export function requestSessionFamily(sessions: RequestSession[], sessionID: string | null) {
  if (!sessionID) return [];
  const children = new Map<string, RequestSession[]>();
  for (const session of sessions) {
    if (!session.parentID) continue;
    const list = children.get(session.parentID) ?? [];
    list.push(session);
    children.set(session.parentID, list);
  }
  const ids = new Set([sessionID]);
  const family: RequestSession[] = [];
  const root = sessions.find((session) => session.id === sessionID);
  if (root) family.push(root);
  for (const id of ids) {
    for (const child of children.get(id) ?? []) {
      if (ids.has(child.id)) continue;
      ids.add(child.id);
      family.push(child);
    }
  }
  return family.map(({ id, parentID, title }) => ({ id, parentID, title }));
}

export function familyRequestViews(
  family: RequestSession[],
  requests: Map<string, SessionRequestSnapshot>,
): OwnedPendingRequestView[] {
  return family
    .flatMap((session) => {
      const snapshot = requests.get(session.id);
      if (!snapshot) return [];
      return actionableRequestViews(snapshot).map((request) => ({
        ...request,
        sessionID: session.id,
        sessionTitle: session.title?.trim() || "Delegated task",
        createdAt: snapshot.requestCreatedAtByID?.[request.id] ?? request.createdAt,
      }));
    })
    .toSorted(
      (left, right) =>
        (left.createdAt ?? 0) - (right.createdAt ?? 0) ||
        left.sessionID.localeCompare(right.sessionID) ||
        left.type.localeCompare(right.type) ||
        left.id.localeCompare(right.id),
    );
}
