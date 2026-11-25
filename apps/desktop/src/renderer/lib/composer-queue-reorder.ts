/**
 * Moving a queued message to the front of OpenCode's session inbox. The inbox has no reorder
 * API: it delivers queued messages in admission order. Like OpenCode's own app (#63109), Palot
 * re-admits every other queued message behind the one that goes first and then withdraws the
 * originals. Copies are all admitted before any original is withdrawn, so a failure part-way
 * withdraws the copies and leaves the queue as it was; no message is lost. Steers and other
 * inbox items are never touched.
 */

import type { SessionInboxInfo } from "@opencode/client";
import type { PendingRequestView } from "./view-models";

type InboxUser = Extract<SessionInboxInfo, { type: "user" }>;

export interface QueueReorderApi {
  list(): Promise<readonly SessionInboxInfo[]>;
  /** Admits a copy of a queued message under `id`, queued and without waking the task. */
  admit(id: string, item: InboxUser): Promise<void>;
  cancel(id: string): Promise<void>;
  newID(): string;
}

export interface QueueReorderHooks {
  /** A copy of `original` is about to be admitted as `copy`; it stands for the original. */
  copied?(original: string, copy: string): void;
  /** A copy was withdrawn again, or never admitted. */
  withdrawn?(copy: string): void;
}

export type QueueReorderResult =
  /** The message is first, or was delivered or withdrawn meanwhile. */
  "moved" | "unchanged";

export class QueueReorderError extends Error {
  /** Copies Palot could not withdraw again: those messages are now queued twice. */
  readonly duplicates: number;
  constructor(message: string, duplicates = 0, options?: ErrorOptions) {
    super(message, options);
    this.name = "QueueReorderError";
    this.duplicates = duplicates;
  }
}

function queuedUsers(items: readonly SessionInboxInfo[]): InboxUser[] {
  return items.filter(
    (item): item is InboxUser => item.type === "user" && item.delivery === "queue",
  );
}

/** Moves the queued message `id` to the front of the queue. */
export async function moveQueuedInputFirst(
  api: QueueReorderApi,
  id: string,
  hooks: QueueReorderHooks = {},
): Promise<QueueReorderResult> {
  const items = await api.list();
  if (items.some((item) => item.delivery === "queue" && item.type !== "user")) {
    throw new QueueReorderError(
      "OpenCode has other work queued, such as a compaction. Try again once it has run.",
    );
  }
  const queued = queuedUsers(items);
  const index = queued.findIndex((item) => item.id === id);
  if (index <= 0) return "unchanged";
  const others = queued.filter((item) => item.id !== id);

  const copies: Array<{ original: InboxUser; copy: string }> = [];
  const withdraw = async (copy: string): Promise<boolean> => {
    try {
      await api.cancel(copy);
      hooks.withdrawn?.(copy);
      return true;
    } catch {
      return false;
    }
  };

  for (const original of others) {
    const copy = api.newID();
    hooks.copied?.(original.id, copy);
    try {
      await api.admit(copy, original);
      copies.push({ original, copy });
    } catch (error) {
      // OpenCode may have admitted the copy before its reply failed, so it is withdrawn too.
      const results = await Promise.all([...copies.map((entry) => entry.copy), copy].map(withdraw));
      const duplicates = results.slice(0, -1).filter((withdrawn) => !withdrawn).length;
      throw new QueueReorderError(
        error instanceof Error && error.message
          ? `Could not move the message: ${error.message}`
          : "Could not move the message.",
        duplicates,
        { cause: error },
      );
    }
  }

  // An original that left the queue meanwhile (delivered, steered, edited or deleted) must not
  // come back as its copy.
  const still = new Set(queuedUsers(await api.list()).map((item) => item.id));
  let duplicates = 0;
  let stuck = 0;
  for (const { original, copy } of copies) {
    if (!still.has(original.id)) {
      if (!(await withdraw(copy))) duplicates += 1;
      continue;
    }
    let cancelled = await api.cancel(original.id).then(
      () => true,
      () => false,
    );
    if (!cancelled) {
      // Once more, unless it went out between the list and the cancel.
      const present = queuedUsers(await api.list().catch(() => [])).some(
        (item) => item.id === original.id,
      );
      cancelled =
        !present ||
        (await api.cancel(original.id).then(
          () => true,
          () => false,
        ));
    }
    if (cancelled) continue;
    // The original stays rather than being queued twice; only its place is off.
    if (await withdraw(copy)) stuck += 1;
    else duplicates += 1;
  }
  if (duplicates > 0) {
    throw new QueueReorderError(
      duplicates === 1
        ? "One message is now queued twice; delete one of them."
        : `${duplicates} messages are now queued twice; delete one of each.`,
      duplicates,
    );
  }
  if (stuck > 0) {
    throw new QueueReorderError(
      stuck === 1
        ? "One message kept its place ahead of it; every message is still queued."
        : `${stuck} messages kept their place ahead of it; every message is still queued.`,
    );
  }
  return "moved";
}

/** A queue row with the key it keeps while a move replaces its message with a copy. */
export interface QueueDisplayRow {
  key: string;
  request: PendingRequestView;
}

/**
 * The rows to show: each message once under a stable key (a copy shows as its original), in the
 * order a running move is heading for. Rows outside `order` (steers, new messages) keep their
 * place in the inbox order, and the moving messages fill the queued slots.
 */
export function queueDisplayRows(
  requests: readonly PendingRequestView[],
  aliases: ReadonlyMap<string, string>,
  order: readonly string[] | null,
): QueueDisplayRow[] {
  const seen = new Set<string>();
  const rows: QueueDisplayRow[] = [];
  for (const request of requests) {
    const key = aliases.get(request.id) ?? request.id;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ key, request });
  }
  if (!order) return rows;
  const rank = new Map(order.map((id, index) => [id, index]));
  const slots = rows.flatMap((row, index) =>
    row.request.delivery === "queue" && rank.has(row.key) ? [index] : [],
  );
  const moving = slots
    .map((index) => rows[index]!)
    .toSorted((left, right) => rank.get(left.key)! - rank.get(right.key)!);
  slots.forEach((slot, index) => {
    rows[slot] = moving[index]!;
  });
  return rows;
}
