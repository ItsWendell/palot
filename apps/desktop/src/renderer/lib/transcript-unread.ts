import type { PalotMessage, PalotSession } from "../../shared";
import { serverSessionIsUnread } from "./task-unread";

/**
 * The first message OpenCode has not recorded as viewed, for the "New" divider. Only OpenCode's
 * unread state counts: a task marked unread in Palot has no new content to point at.
 */
export function firstUnseenMessage(
  session: Pick<PalotSession, "idleAt" | "viewedAt">,
  messages: readonly PalotMessage[],
): string | null {
  if (!serverSessionIsUnread(session)) return null;
  return (
    messages.find(
      (message) => message.createdAt !== null && message.createdAt > (session.viewedAt ?? 0),
    )?.id ?? null
  );
}
