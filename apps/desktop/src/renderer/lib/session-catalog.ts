import type { PalotPage, PalotSession } from "../../shared";

export interface SessionCatalogState {
  sessions: PalotSession[];
  nextCursor: string | null;
}

export function mergeSessionPage(
  current: SessionCatalogState,
  page: PalotPage<PalotSession>,
): SessionCatalogState {
  const byID = new Map(current.sessions.map((session) => [session.id, session]));
  for (const session of page.data) byID.set(session.id, session);
  return {
    sessions: [...byID.values()].toSorted(
      (left, right) => right.updatedAt - left.updatedAt || left.id.localeCompare(right.id),
    ),
    nextCursor: page.cursor.next,
  };
}
