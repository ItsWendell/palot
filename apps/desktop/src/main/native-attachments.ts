import type { OpenCodeClient } from "@opencode/client";
import type { OpenCodeRuntimeStatus, PalotFilePickerResult } from "../shared/opencode-contract";
import { uploadPickedAttachments } from "./file-attachments";
import { attachmentUploadWriter } from "./attachment-upload";
import { guardFocusedOpenCodeConnection } from "./opencode-native-scope";

interface AttachmentRuntime {
  requestConnection?(target: { connectionID: string }): Promise<{
    endpoint: { url: string };
    headers?: Record<string, string>;
    validate(): void;
  }>;
  runtimeStatus(): OpenCodeRuntimeStatus;
  onRuntimeStatus(observer: (status: OpenCodeRuntimeStatus) => void): () => void;
  scopedConnection(connectionID: string): {
    onDispose(observer: () => void): () => void;
    withClient(
      operation: (client: OpenCodeClient) => Promise<PalotFilePickerResult>,
    ): Promise<PalotFilePickerResult>;
  };
}

/** Capture ownership before opening the dialog or reading asynchronous native clipboard data. */
export async function prepareNativeAttachments(
  runtime: AttachmentRuntime,
  select: () => Promise<PalotFilePickerResult>,
  options: {
    signal?: AbortSignal;
    onProgress?(progress: {
      name: string;
      loaded: number;
      total: number;
      index: number;
      count: number;
    }): void;
  } = {},
): Promise<PalotFilePickerResult> {
  const status = runtime.runtimeStatus();
  const focused = guardFocusedOpenCodeConnection(status.connectionID, () =>
    runtime.runtimeStatus(),
  );
  const scoped = runtime.scopedConnection(status.connectionID);
  const controller = new AbortController();
  const signal = options.signal
    ? AbortSignal.any([controller.signal, options.signal])
    : controller.signal;
  const validate = () => {
    signal.throwIfAborted();
    focused();
  };
  const dispose = scoped.onDispose(() => controller.abort());
  const unsubscribe = runtime.onRuntimeStatus(() => {
    try {
      focused();
    } catch {
      controller.abort();
    }
  });
  try {
    const selected = await select();
    validate();
    if (status.topology === "same-machine") return selected;
    if (status.topology !== "remote-machine")
      throw new Error("OpenCode attachment destination is unknown.");
    const connection = await runtime.requestConnection?.({ connectionID: status.connectionID });
    validate();
    return await scoped.withClient((client) =>
      uploadPickedAttachments(selected, client, {
        signal: AbortSignal.any([signal, AbortSignal.timeout(120_000)]),
        validate,
        ...(connection ? { write: attachmentUploadWriter(connection) } : {}),
        onProgress: options.onProgress,
      }),
    );
  } finally {
    controller.abort();
    unsubscribe();
    dispose();
  }
}
