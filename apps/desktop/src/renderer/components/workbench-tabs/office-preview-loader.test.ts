import { afterEach, expect, it, vi } from "vitest";
import { loadOfficePreview } from "./office-preview-loader";

class PreviewWorker {
  static instances: PreviewWorker[] = [];
  onmessage?: (event: MessageEvent) => void;
  onerror?: () => void;
  onmessageerror?: () => void;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor() {
    PreviewWorker.instances.push(this);
  }
}

afterEach(() => {
  PreviewWorker.instances = [];
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("keeps cached bytes intact and terminates the worker after receiving a document", async () => {
  vi.stubGlobal("Worker", PreviewWorker);
  const data = new Uint8Array([1, 2, 3]);
  const promise = loadOfficePreview(data, "docx", new AbortController().signal);
  const worker = PreviewWorker.instances[0]!;
  const [{ data: copy, format }, transfer] = worker.postMessage.mock.calls[0]!;
  expect(format).toBe("docx");
  expect(copy).toEqual(data);
  expect(copy.buffer).not.toBe(data.buffer);
  expect(transfer).toEqual([copy.buffer]);
  const document = { format: "docx", truncated: false, sections: [], sheets: [] };
  worker.onmessage?.(new MessageEvent("message", { data: { ok: true, document } }));
  expect(await promise).toEqual(document);
  expect(worker.terminate).toHaveBeenCalledTimes(1);
  expect([...data]).toEqual([1, 2, 3]);
});

it("terminates a worker on tab release, failure or a parser that never settles", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("Worker", PreviewWorker);
  const controller = new AbortController();
  const cancelled = loadOfficePreview(new Uint8Array(), "docx", controller.signal);
  controller.abort();
  await expect(cancelled).rejects.toMatchObject({ name: "AbortError" });
  expect(PreviewWorker.instances[0]?.terminate).toHaveBeenCalledTimes(1);

  const failed = loadOfficePreview(new Uint8Array(), "docx", new AbortController().signal);
  PreviewWorker.instances[1]?.onerror?.();
  await expect(failed).rejects.toMatchObject({ code: "invalid" });
  expect(PreviewWorker.instances[1]?.terminate).toHaveBeenCalledTimes(1);

  const timedOut = loadOfficePreview(new Uint8Array(), "docx", new AbortController().signal);
  const rejection = expect(timedOut).rejects.toMatchObject({ code: "limit" });
  await vi.advanceTimersByTimeAsync(15_000);
  await rejection;
  expect(PreviewWorker.instances[2]?.terminate).toHaveBeenCalledTimes(1);
});
