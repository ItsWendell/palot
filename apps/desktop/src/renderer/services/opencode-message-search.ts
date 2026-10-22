import type { PalotMessage } from "../../shared";
import { MESSAGE_SEARCH_MESSAGE_LIMIT } from "../lib/message-search";
import { compareMessages } from "../lib/message-reconcile";
import { openCodeClient } from "./opencode-client";
import { mapMessage } from "./opencode-mappers";
import { openCodeRequestSignal } from "./opencode-request";
import { palot } from "./palot";

/**
 * The latest page of a task's messages, chronological, for palette message search. One
 * request per task; older history is deliberately not paged in. The result is kept only in the
 * palette's in-memory search state, never in the transcript cache.
 */
export async function loadRecentSessionMessages(
  sessionID: string,
  connectionID: string | undefined,
  signal: AbortSignal,
): Promise<PalotMessage[]> {
  if (palot.isPreview()) return [];
  const page = await openCodeClient(connectionID).message.list(
    { sessionID, limit: MESSAGE_SEARCH_MESSAGE_LIMIT, order: "desc" },
    { signal: openCodeRequestSignal(signal) },
  );
  return page.data.map(mapMessage).toSorted(compareMessages);
}
