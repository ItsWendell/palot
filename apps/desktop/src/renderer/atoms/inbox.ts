import { atom } from "jotai";
import type { SessionTriageCommand, SessionTriageSnapshot } from "../../shared";
import { palot } from "../services/palot";
import { runtimeAtom } from "./workspace";

export const sessionCatalogReadyAtom = atom(false);
export const attentionSyncStateAtom = atom<"syncing" | "ready" | "error">("syncing");
export const sessionTriageSnapshotAtom = atom<SessionTriageSnapshot | null>(null);
export const sessionTriageErrorAtom = atom<string | null>(null);
export const sessionTriageLoadingAtom = atom(false);
export const inboxClockAtom = atom(Date.now());

type SessionTriageCommandInput = SessionTriageCommand extends infer Command
  ? Command extends { profileID: string }
    ? Omit<Command, "profileID">
    : never
  : never;

export const dispatchSessionTriageAtom = atom(
  null,
  async (get, set, command: SessionTriageCommandInput) => {
    const profileID = get(runtimeAtom)?.profileID;
    if (!profileID) throw new Error("OpenCode profile is unavailable");
    set(sessionTriageErrorAtom, null);
    try {
      const snapshot = await palot.dispatchSessionTriage({
        ...command,
        profileID,
      } as SessionTriageCommand);
      if (get(runtimeAtom)?.profileID === profileID) set(sessionTriageSnapshotAtom, snapshot);
      return snapshot;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not save inbox state";
      set(sessionTriageErrorAtom, message);
      throw error;
    }
  },
);
