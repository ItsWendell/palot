import {
  OfficePreviewError,
  type OfficeDocument,
  type OfficeFormat,
  type OfficePreviewErrorCode,
} from "./office-preview-model";

type Reply = { ok: true; document: OfficeDocument } | { ok: false; code: OfficePreviewErrorCode };

export function loadOfficePreview(
  data: Uint8Array,
  format: OfficeFormat,
  signal: AbortSignal,
): Promise<OfficeDocument> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Preview closed", "AbortError"));
      return;
    }
    const worker = new Worker(new URL("./office-preview.worker.ts", import.meta.url), {
      type: "module",
    });
    const close = () => {
      clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
      worker.terminate();
    };
    const abort = () => {
      close();
      reject(new DOMException("Preview closed", "AbortError"));
    };
    const fail = () => {
      close();
      reject(new OfficePreviewError("invalid"));
    };
    // A worker can be terminated even when a malformed XML parse never yields to its event loop.
    const timeout = setTimeout(() => {
      close();
      reject(new OfficePreviewError("limit"));
    }, 15_000);
    signal.addEventListener("abort", abort, { once: true });
    worker.onmessage = (event: MessageEvent<Reply>) => {
      close();
      if (event.data.ok) resolve(event.data.document);
      else reject(new OfficePreviewError(event.data.code));
    };
    worker.onerror = fail;
    worker.onmessageerror = fail;
    // The server query owns the original buffer; never detach the cached file on tab switches.
    const copy = new Uint8Array(data);
    try {
      worker.postMessage({ data: copy, format }, [copy.buffer]);
    } catch {
      fail();
    }
  });
}
