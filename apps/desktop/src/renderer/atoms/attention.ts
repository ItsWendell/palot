import { atom } from "jotai";
import type { PalotMessage } from "../../shared";
import { persistedAtom, retainRecent } from "./persisted";

const MAX_SEEN_REQUESTS = 500;

const identifiers = (value: unknown): value is string[] =>
  Array.isArray(value) &&
  value.length <= MAX_SEEN_REQUESTS &&
  new Set(value).size === value.length &&
  value.every((entry) => typeof entry === "string" && entry.length > 0 && entry.length <= 512);

export const attentionSeenIDsAtom = persistedAtom({
  key: "attention.seen-request-ids",
  initialValue: [] as string[],
  validate: identifiers,
});
export const attentionTargetAtom = atom<{
  sessionID: string;
  requestID: string;
  type: "permission" | "form" | "question" | "input";
  message?: PalotMessage;
} | null>(null);
export const markAttentionSeenAtom = atom(null, (get, set, requestIDs: string | string[]) => {
  const values = Array.isArray(requestIDs) ? requestIDs : [requestIDs];
  const additions = new Set(values);
  const current = get(attentionSeenIDsAtom).filter((id) => !additions.has(id));
  set(attentionSeenIDsAtom, retainRecent([...current, ...values], MAX_SEEN_REQUESTS));
});
