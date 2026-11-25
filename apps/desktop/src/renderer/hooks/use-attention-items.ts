import { attentionInventory } from "../lib/attention-inventory";
import { useProjectCatalog, useSessionCatalog } from "./use-session-catalog";
import { useSessionRequestMap } from "./use-session-requests";

export function useAttentionItems() {
  const projects = useProjectCatalog();
  const sessions = useSessionCatalog();
  const requests = useSessionRequestMap(sessions.map((session) => session.id));
  return attentionInventory(projects, sessions, requests);
}
