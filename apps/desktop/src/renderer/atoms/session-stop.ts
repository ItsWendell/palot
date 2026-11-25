import { atom } from "jotai";

/** How long the transcript says "Stopping" after Stop when the run does not end. */
export const SESSION_STOPPING_MS = 10_000;

/** When the user last pressed Stop, by session, until that session's run ends. */
export const sessionStopRequestsAtom = atom<ReadonlyMap<string, number>>(new Map());

export const requestSessionStopAtom = atom(null, (get, set, sessionID: string) => {
  set(sessionStopRequestsAtom, new Map(get(sessionStopRequestsAtom)).set(sessionID, Date.now()));
});

export const clearSessionStopAtom = atom(null, (get, set, sessionID: string) => {
  const current = get(sessionStopRequestsAtom);
  if (!current.has(sessionID)) return;
  const next = new Map(current);
  next.delete(sessionID);
  set(sessionStopRequestsAtom, next);
});
