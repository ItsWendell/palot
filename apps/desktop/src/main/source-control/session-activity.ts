/** User messages read per page while looking for the user's own latest message. */
export const USER_MESSAGE_PAGE_SIZE = 50;
/** Pages read before giving up; an unfinished search must not settle a task. */
export const USER_MESSAGE_PAGE_LIMIT = 20;

export interface UserMessageCandidate {
  type: string;
  time: { created: number };
  metadata?: Record<string, unknown>;
}

export interface UserMessagePage {
  data: UserMessageCandidate[];
  cursor: { next?: string | null };
}

/**
 * The newest user-authored message, newest page first. Prompts Palot queued itself (PR watch
 * wakes, automations) carry one of `excludedMetadataKeys` and do not count, so a long run of
 * them cannot hide a real message further back. `complete: false` means the page budget ran
 * out before a genuine message or the start of the session was reached.
 */
export async function latestUserMessageAt(
  readPage: (cursor: string | undefined) => Promise<UserMessagePage>,
  excludedMetadataKeys: readonly string[],
): Promise<{ at: number | null; complete: boolean }> {
  const seen = new Set<string>();
  let cursor: string | undefined;
  for (let page = 0; page < USER_MESSAGE_PAGE_LIMIT; page += 1) {
    const response = await readPage(cursor);
    const own = response.data.filter(
      (message) =>
        message.type === "user" &&
        !excludedMetadataKeys.some((key) => message.metadata?.[key] !== undefined),
    );
    if (own.length > 0)
      return { at: Math.max(...own.map((message) => message.time.created)), complete: true };
    const next = response.cursor.next ?? undefined;
    if (response.data.length < USER_MESSAGE_PAGE_SIZE || !next || seen.has(next))
      return { at: null, complete: true };
    seen.add(next);
    cursor = next;
  }
  return { at: null, complete: false };
}
