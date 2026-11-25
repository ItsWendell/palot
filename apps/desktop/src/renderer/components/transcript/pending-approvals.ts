import { createContext, useContext, useSyncExternalStore } from "react";
import type { PendingRequestView } from "../../lib/view-models";

/**
 * Which tool parts wait on a permission request, keyed by part ID. Rows subscribe to their own
 * part, so a request arriving re-renders only the row it names. The thread owns one store and
 * replaces its contents; the store object itself never changes.
 */
export class PendingApprovalStore {
  private requests: ReadonlyMap<string, string> = new Map();
  private listeners = new Set<() => void>();
  private focusRequest: (requestID: string) => void = () => {};

  /** The pending permission request for a tool part, if any. */
  requestFor = (partID: string): string | null => this.requests.get(partID) ?? null;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  focus = (requestID: string): void => this.focusRequest(requestID);

  update(requests: ReadonlyMap<string, string>, focus: (requestID: string) => void): void {
    this.focusRequest = focus;
    if (sameRequests(this.requests, requests)) return;
    this.requests = requests;
    for (const listener of this.listeners) listener();
  }
}

function sameRequests(left: ReadonlyMap<string, string>, right: ReadonlyMap<string, string>) {
  if (left.size !== right.size) return false;
  for (const [partID, requestID] of left) if (right.get(partID) !== requestID) return false;
  return true;
}

/** Tool part ID to request ID for the pending permission requests that name a tool part. */
export function pendingApprovalsByPart(
  requests: readonly PendingRequestView[],
): ReadonlyMap<string, string> {
  return new Map(
    requests.flatMap((request) =>
      request.type === "permission" && request.toolPartID
        ? [[request.toolPartID, request.id] as const]
        : [],
    ),
  );
}

export const PendingApprovalContext = createContext<PendingApprovalStore | null>(null);

const subscribeNowhere = () => () => {};

/** The pending permission request holding this tool part, and how to focus it in the dock. */
export function usePendingApproval(
  partID: string | undefined,
): { requestID: string; focus(): void } | null {
  const store = useContext(PendingApprovalContext);
  const requestID = useSyncExternalStore(store?.subscribe ?? subscribeNowhere, () =>
    store && partID ? store.requestFor(partID) : null,
  );
  if (!store || !requestID) return null;
  return { requestID, focus: () => store.focus(requestID) };
}
