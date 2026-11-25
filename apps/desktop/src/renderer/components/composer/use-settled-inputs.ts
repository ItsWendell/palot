import { useEffect, useRef, useState } from "react";
import type { PendingRequestView } from "../../lib/view-models";

/** How long a message sent to an idle task may sit in OpenCode's inbox before it shows as queued. */
export const IDLE_SEND_GRACE_MS = 1_500;

/**
 * The inputs worth showing as queue rows. A message sent while the task is idle passes through
 * the inbox on its way to becoming a turn; showing it as "queued" for that moment reads as if it
 * was held back. It gets a short grace instead, and shows only if it is still waiting after it.
 * Inputs that arrive while the task works, or were already waiting when the task opened, show at
 * once, and so do the copies that moving a queued message to the top admits for the others.
 */
export function useSettledInputs(
  requests: PendingRequestView[],
  working: boolean,
  /** Copies a queue move admits in place of a shown message; they show at once. */
  copies?: ReadonlyMap<string, string>,
): PendingRequestView[] {
  const seen = useRef<Map<string, number> | null>(null);
  const [, settle] = useState(0);
  const now = Date.now();
  const first = seen.current === null;
  const known = (seen.current ??= new Map());
  for (const request of requests) {
    // 0 marks an input that never needs the grace.
    if (!known.has(request.id))
      known.set(request.id, first || working || copies?.has(request.id) ? 0 : now);
  }
  if (known.size > requests.length) {
    const ids = new Set(requests.map((request) => request.id));
    for (const id of known.keys()) if (!ids.has(id)) known.delete(id);
  }
  const pending = requests.filter((request) => now - known.get(request.id)! < IDLE_SEND_GRACE_MS);
  const wait = pending.length
    ? Math.min(...pending.map((request) => known.get(request.id)! + IDLE_SEND_GRACE_MS - now))
    : null;
  useEffect(() => {
    if (wait === null) return;
    const timeout = window.setTimeout(() => settle((count) => count + 1), wait);
    return () => window.clearTimeout(timeout);
  }, [wait, requests]);
  if (pending.length === 0) return requests;
  const hidden = new Set(pending.map((request) => request.id));
  return requests.filter((request) => !hidden.has(request.id));
}
