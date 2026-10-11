import "./office-preview-worker-environment";
import { OfficePreviewError, type OfficeFormat } from "./office-preview-model";
import { parseOfficePreview } from "./office-preview-parser";

self.onmessage = async (event: MessageEvent<{ data: Uint8Array; format: OfficeFormat }>) => {
  try {
    self.postMessage({
      ok: true,
      document: await parseOfficePreview(event.data.data, event.data.format),
    });
  } catch (error) {
    self.postMessage({
      ok: false,
      code: error instanceof OfficePreviewError ? error.code : "invalid",
    });
  }
};
