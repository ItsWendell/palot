import type { BinaryPreviewRequest, BinaryPreviewResult } from "./binary-preview-model";

/** One tab owns one worker. Closing it also interrupts synchronous SQL/XML/inflation work. */
export class BinaryPreviewWorker {
  private worker = new Worker(new URL("./binary-preview.worker.ts", import.meta.url), {
    type: "module",
  });
  private sequence = 0;
  private pending = new Map<
    number,
    {
      resolve(value: BinaryPreviewResult): void;
      reject(error: Error): void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private closed = false;
  constructor() {
    this.worker.onmessage = (
      event: MessageEvent<{ id: number; result?: BinaryPreviewResult; error?: string }>,
    ) => {
      const pending = this.pending.get(event.data.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(event.data.id);
      if (event.data.result) pending.resolve(event.data.result);
      else pending.reject(new Error(event.data.error || "Could not read this file."));
    };
    this.worker.onerror = this.worker.onmessageerror = () =>
      this.close(new Error("Could not load the preview worker."));
  }
  request(request: BinaryPreviewRequest): Promise<BinaryPreviewResult> {
    return new Promise((resolve, reject) => {
      if (this.closed) {
        reject(new Error("Preview closed. Refresh the file to reopen it."));
        return;
      }
      const id = ++this.sequence;
      const timer = setTimeout(
        () => this.close(new Error("Preview exceeded its 15-second processing limit.")),
        15_000,
      );
      this.pending.set(id, { resolve, reject, timer });
      // Copy rather than detach the query cache's bytes.
      if ("data" in request) {
        const data = new Uint8Array(request.data);
        this.worker.postMessage({ id, request: { ...request, data } }, [data.buffer]);
      } else this.worker.postMessage({ id, request });
    });
  }
  close(error = new Error("Preview closed.")) {
    this.closed = true;
    this.worker.terminate();
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}
