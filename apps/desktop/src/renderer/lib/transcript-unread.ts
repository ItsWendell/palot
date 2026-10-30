import type { PalotMessage, PalotSession } from "../../shared";

export function firstUnseenMessage(
  session: Pick<PalotSession, "idleAt" | "viewedAt">,
  messages: readonly PalotMessage[],
): string | null {
  if (session.idleAt === undefined || (session.viewedAt ?? 0) >= session.idleAt) return null;
  return (
    messages.find(
      (message) => message.createdAt !== null && message.createdAt > (session.viewedAt ?? 0),
    )?.id ?? null
  );
}
