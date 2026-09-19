import type { PalotEvent, SessionRequestSnapshot } from "../../shared";

export const EMPTY_SESSION_REQUEST_SNAPSHOT: SessionRequestSnapshot = {
  permissions: [],
  forms: [],
  inbox: [],
  errors: [],
};

export function mergeSessionRequestSnapshot(
  previous: SessionRequestSnapshot | undefined,
  next: SessionRequestSnapshot,
): SessionRequestSnapshot {
  const requestCreatedAtByID = {
    ...previous?.requestCreatedAtByID,
    ...next.requestCreatedAtByID,
  };
  return {
    ...next,
    ...(Object.keys(requestCreatedAtByID).length > 0 ? { requestCreatedAtByID } : {}),
  };
}

export function mergeAttentionRequests(
  previous: SessionRequestSnapshot | undefined,
  next: SessionRequestSnapshot,
  complete: boolean,
): SessionRequestSnapshot {
  if (!previous) return next;
  if (complete) return { ...next, inbox: previous.inbox };
  return {
    ...next,
    inbox: previous.inbox,
    permissions: [
      ...new Map(
        [...previous.permissions, ...next.permissions].map((request) => [request.id, request]),
      ).values(),
    ],
    forms: [...new Map([...previous.forms, ...next.forms].map((form) => [form.id, form])).values()],
  };
}

export function sessionRequestEventSessionID(event: PalotEvent): string | null {
  if (event.type === "form.created") return event.data.form.sessionID;
  if (
    event.type === "permission.asked" ||
    event.type === "permission.replied" ||
    event.type === "form.replied" ||
    event.type === "form.cancelled" ||
    event.type === "session.inbox.enqueued" ||
    event.type === "session.inbox.cancelled" ||
    event.type === "session.inbox.delivered" ||
    event.type === "session.inbox.delivery.changed"
  ) {
    return event.data.sessionID;
  }
  return null;
}

export function updateSessionRequests(
  current: SessionRequestSnapshot,
  event: PalotEvent,
): SessionRequestSnapshot {
  if (event.type === "permission.asked") {
    const permissions = current.permissions.some((request) => request.id === event.data.id)
      ? current.permissions
      : [...current.permissions, event.data];
    return {
      ...current,
      permissions,
      requestCreatedAtByID: {
        ...current.requestCreatedAtByID,
        [event.data.id]: event.createdAt,
      },
    };
  }
  if (event.type === "permission.replied") {
    return {
      ...current,
      permissions: current.permissions.filter((request) => request.id !== event.data.requestID),
    };
  }
  if (event.type === "form.created") {
    const forms = current.forms.some((form) => form.id === event.data.form.id)
      ? current.forms
      : [...current.forms, event.data.form];
    return {
      ...current,
      forms,
      requestCreatedAtByID: {
        ...current.requestCreatedAtByID,
        [event.data.form.id]: event.createdAt,
      },
    };
  }
  if (event.type === "form.replied" || event.type === "form.cancelled") {
    return { ...current, forms: current.forms.filter((form) => form.id !== event.data.id) };
  }
  if (event.type === "session.inbox.enqueued") {
    const inbox = current.inbox.some((item) => item.id === event.data.inboxID)
      ? current.inbox
      : [
          ...current.inbox,
          {
            id: event.data.inboxID,
            sessionID: event.data.sessionID,
            time: { created: event.createdAt },
            ...event.data.item,
          },
        ];
    return {
      ...current,
      inbox,
      requestCreatedAtByID: {
        ...current.requestCreatedAtByID,
        [event.data.inboxID]: event.createdAt,
      },
    };
  }
  if (event.type === "session.inbox.delivery.changed") {
    return {
      ...current,
      inbox: current.inbox.map((item) =>
        item.id === event.data.inboxID ? { ...item, delivery: event.data.delivery } : item,
      ),
    };
  }
  if (event.type === "session.inbox.cancelled" || event.type === "session.inbox.delivered") {
    return { ...current, inbox: current.inbox.filter((item) => item.id !== event.data.inboxID) };
  }
  return current;
}
