import { useAtomValue } from "jotai";
import { attentionSeenIDsAtom } from "../atoms/attention";
import { attentionInventory } from "../lib/attention-inventory";
import { useProjectCatalog, useSessionCatalog } from "./use-session-catalog";
import { useSessionRequestMap } from "./use-session-requests";

export function useAttentionItems() {
  const projects = useProjectCatalog();
  const sessions = useSessionCatalog();
  const requests = useSessionRequestMap(sessions.map((session) => session.id));
  return attentionInventory(projects, sessions, requests);
}

export function useUnseenAttentionCount(items: ReturnType<typeof useAttentionItems>) {
  const seen = new Set(useAtomValue(attentionSeenIDsAtom));
  return items.filter((item) =>
    item.requests.some((request) => !seen.has(request.key) && !seen.has(request.legacyKey)),
  ).length;
}
