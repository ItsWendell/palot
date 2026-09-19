interface AttachmentRequest {
  signal: AbortSignal;
  abort(): void;
  dispose(): void;
}

/** Upload cancellation is scoped to the requesting renderer, never a global request ID. */
export function createAttachmentRequests(): {
  start(owner: number, requestID: string): AttachmentRequest;
  cancel(owner: number, requestID: string): void;
} {
  const active = new Map<number, { requestID: string; controller: AbortController }>();
  return {
    start(owner: number, requestID: string) {
      if (!requestID || requestID.length > 100) throw new Error("Attachment request is invalid.");
      if (active.has(owner)) throw new Error("An attachment request is already pending.");
      const request = { requestID, controller: new AbortController() };
      active.set(owner, request);
      return {
        signal: request.controller.signal,
        abort: () => request.controller.abort(),
        dispose() {
          request.controller.abort();
          if (active.get(owner) === request) active.delete(owner);
        },
      };
    },
    cancel(owner: number, requestID: string) {
      const request = active.get(owner);
      if (request?.requestID === requestID) request.controller.abort();
    },
  };
}
