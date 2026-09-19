// @vitest-environment node
import { mkdtemp, open, rename, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import { once } from "node:events";
import type { OpenCodeClient } from "@opencode/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OpenCodeRuntimeStatus, PalotFilePickerResult } from "../shared/opencode-contract";
import {
  inspectPickedFiles,
  MAX_ATTACHMENT_BYTES,
  readAttachmentPreview,
  stageClipboardImages,
  uploadPickedAttachments,
} from "./file-attachments";
import { prepareNativeAttachments } from "./native-attachments";

const directories: string[] = [];
async function selected(name = "paper.pdf", text = "native bytes") {
  const directory = await mkdtemp("/tmp/opencode/native-upload-");
  directories.push(directory);
  const file = path.join(directory, name);
  await writeFile(file, text);
  return { file, result: await inspectPickedFiles([file]) };
}
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function harness(temporary = "/server/tmp") {
  let status = {
    connectionID: "original",
    profileID: "remote",
    connected: true,
    topology: "remote-machine",
  } as OpenCodeRuntimeStatus;
  const listeners = new Set<(status: OpenCodeRuntimeStatus) => void>();
  const write = vi.fn(
    async (input: { path: string; payload: Uint8Array }, _options?: { signal?: AbortSignal }) => ({
      data: { path: input.path },
    }),
  );
  const info = vi.fn(async () => ({ paths: { tmp: temporary } }));
  const client = { server: { info }, file: { write } } as unknown as OpenCodeClient;
  const withClient = vi.fn(
    async (operation: (client: OpenCodeClient) => Promise<PalotFilePickerResult>) =>
      operation(client),
  );
  const onDispose = vi.fn(() => vi.fn());
  const runtime = {
    runtimeStatus: () => status,
    scopedConnection: vi.fn(() => ({ withClient, onDispose })),
    onRuntimeStatus: (listener: (status: OpenCodeRuntimeStatus) => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  const change = (patch: Partial<OpenCodeRuntimeStatus>) => {
    status = { ...status, ...patch };
    for (const listener of listeners) listener(status);
  };
  return { runtime, client, write, info, change, listeners, withClient };
}

describe("native remote attachments", () => {
  it("uses the captured main-process endpoint and headers for streaming", async () => {
    const h = harness();
    const picked = await selected();
    let received = "";
    let authorization: string | undefined;
    const server = http.createServer((request, response) => {
      authorization = request.headers.authorization;
      request.on("data", (chunk) => {
        received += chunk.toString();
      });
      request.on("end", () =>
        response.end(
          JSON.stringify({
            data: { path: new URL(request.url!, "http://localhost").searchParams.get("path") },
          }),
        ),
      );
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Missing test address");
      const validate = vi.fn();
      const requestConnection = vi.fn(async () => ({
        endpoint: { url: `http://127.0.0.1:${address.port}` },
        headers: { authorization: "Basic main-only" },
        validate,
      }));
      const progress = vi.fn();
      const result = await prepareNativeAttachments(
        { ...h.runtime, requestConnection },
        async () => picked.result,
        { onProgress: progress },
      );
      expect(result.errors).toEqual([]);
      expect(result.files).toHaveLength(1);
      expect(requestConnection).toHaveBeenCalledExactlyOnceWith({ connectionID: "original" });
      expect(authorization).toBe("Basic main-only");
      expect(received).toBe("native bytes");
      expect(validate).toHaveBeenCalled();
      expect(progress).toHaveBeenCalled();
      expect(h.write).not.toHaveBeenCalled();
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("streams large inspected files in bounded chunks and reports batch progress", async () => {
    const h = harness();
    const picked = await selected("large.pdf");
    const handle = await open(picked.file, "r+");
    await handle.truncate(MAX_ATTACHMENT_BYTES + 1);
    await handle.close();
    const inspected = await inspectPickedFiles([picked.file]);
    const progress = vi.fn();
    let size = 0;
    const result = await uploadPickedAttachments(inspected, h.client, {
      signal: new AbortController().signal,
      validate() {},
      onProgress: progress,
      async write(input) {
        for await (const chunk of input.chunks) {
          expect(chunk.length).toBeLessThanOrEqual(64 * 1024);
          size += chunk.length;
          input.onProgress?.(size);
        }
        return input.path;
      },
    });
    expect(result.errors).toEqual([]);
    expect(result.files).toHaveLength(1);
    expect(size).toBe(MAX_ATTACHMENT_BYTES + 1);
    expect(progress.mock.calls.at(-1)).toEqual([
      { name: "large.pdf", loaded: size, total: size, index: 0, count: 1 },
    ]);
    expect(h.write).not.toHaveBeenCalled();
  });

  it("rejects a file modified during streaming", async () => {
    const h = harness();
    const picked = await selected();
    const result = await uploadPickedAttachments(picked.result, h.client, {
      signal: new AbortController().signal,
      validate() {},
      async write(input) {
        for await (const _chunk of input.chunks) await writeFile(picked.file, "changed bytes!");
        return input.path;
      },
    });
    expect(result.files).toEqual([]);
    expect(result.errors).toHaveLength(1);
  });

  it("honors caller cancellation while native selection is pending", async () => {
    const h = harness();
    const controller = new AbortController();
    await expect(
      prepareNativeAttachments(
        h.runtime,
        async () => {
          controller.abort();
          return { files: [], errors: [] };
        },
        { signal: controller.signal },
      ),
    ).rejects.toThrow();
    expect(h.info).not.toHaveBeenCalled();
  });

  it("accepts oversized local paths but rejects remote buffering with an actionable error", async () => {
    const h = harness();
    const picked = await selected("large.pdf");
    const handle = await open(picked.file, "r+");
    await handle.truncate(MAX_ATTACHMENT_BYTES + 1);
    await handle.close();
    const result = await inspectPickedFiles([picked.file]);
    const remote = await prepareNativeAttachments(h.runtime, async () => result);
    expect(remote.files).toEqual([]);
    expect(remote.errors).toEqual([
      "large.pdf: remote uploads larger than 20 MiB are not supported yet.",
    ]);
    expect(h.write).not.toHaveBeenCalled();
    h.change({ topology: "same-machine" });
    expect(await prepareNativeAttachments(h.runtime, async () => result)).toEqual(result);
    expect(h.write).not.toHaveBeenCalled();
  });

  it("preserves normalized JSON MIME and exact content across remote upload", async () => {
    const h = harness();
    const picked = await selected("config.json", '{"enabled":true}');
    const result = await prepareNativeAttachments(h.runtime, async () => picked.result);
    expect(result.files[0]).toMatchObject({ name: "config.json", mime: "text/plain" });
    expect(Buffer.from(h.write.mock.calls[0]![0].payload).toString()).toBe('{"enabled":true}');
  });

  it("limits a batch to twenty native files", async () => {
    const h = harness();
    const picked = await selected();
    const result = await prepareNativeAttachments(h.runtime, async () => ({
      files: Array.from({ length: 21 }, () => picked.result.files[0]!),
      errors: [],
    }));
    expect(h.write).toHaveBeenCalledTimes(20);
    expect(result.files).toHaveLength(20);
    expect(result.errors).toEqual(["Attach up to 20 files at a time."]);
  });

  it("refuses uploads if the profile changes while acquiring the server temp directory", async () => {
    const h = harness();
    const picked = await selected();
    h.info.mockImplementationOnce(async () => {
      h.change({ connectionID: "other" });
      return { paths: { tmp: "/server/tmp" } };
    });
    await expect(prepareNativeAttachments(h.runtime, async () => picked.result)).rejects.toThrow();
    expect(h.write).not.toHaveBeenCalled();
  });
  it.each(["/server/tmp", "C:\\Users\\server\\Temp"])(
    "uploads bytes beneath server temp %s with safe names and no desktop URI",
    async (temporary) => {
      const h = harness(temporary);
      const picked = await selected("paper #1.pdf");
      const result = await prepareNativeAttachments(h.runtime, async () => picked.result);
      expect(result.errors).toEqual([]);
      expect(result.files[0]).toMatchObject({
        name: "paper #1.pdf",
        mime: "application/pdf",
        size: 12,
      });
      expect(result.files[0]!.uri).not.toBe(picked.result.files[0]!.uri);
      const input = h.write.mock.calls[0]![0];
      expect(Buffer.from(input.payload).toString()).toBe("native bytes");
      const serverPath = temporary.startsWith("C:") ? path.win32 : path.posix;
      expect(serverPath.dirname(input.path)).toBe(temporary);
      expect(serverPath.basename(input.path)).toMatch(/^palot-[a-f0-9-]+-paper__1\.pdf$/);
      expect(result.files[0]!.uri).toMatch(
        temporary.startsWith("C:")
          ? /^file:\/\/\/C:\/Users\/server\/Temp\//
          : /^file:\/\/\/server\/tmp\//,
      );
      expect(h.runtime.scopedConnection).toHaveBeenCalledExactlyOnceWith("original");
      expect(h.listeners.size).toBe(0);
    },
  );

  it("uploads internally staged clipboard bytes while keeping native raster preview grants", async () => {
    const h = harness();
    const result = await prepareNativeAttachments(h.runtime, () =>
      stageClipboardImages([{ mime: "image/png", data: Uint8Array.from([1, 2, 3]).buffer }]),
    );
    expect(result.files[0]!.uri).toMatch(/^file:\/\/\/server\/tmp\//);
    const preview = await readAttachmentPreview(result.files[0]!.previewGrant!);
    expect(new Uint8Array(preview!.data)).toEqual(Uint8Array.from([1, 2, 3]));
  });

  it("omits failed uploads and rejects forged attachment objects without reading renderer paths", async () => {
    const h = harness();
    const first = await selected();
    const second = await selected("second.txt");
    h.write.mockRejectedValueOnce(new Error("secret server credentials"));
    const result = await prepareNativeAttachments(h.runtime, async () => ({
      files: [...first.result.files, { ...first.result.files[0]! }, ...second.result.files],
      errors: ["selection warning"],
    }));
    expect(h.write).toHaveBeenCalledTimes(2);
    expect(result.files).toHaveLength(1);
    expect(result.files[0]!.name).toBe("second.txt");
    expect(result.errors).toHaveLength(3);
    expect(result.errors.join()).not.toContain("secret");
    expect(result.files.every((file) => file.uri.startsWith("file:///server/tmp/"))).toBe(true);
  });

  it.each(["modified", "replaced", "symlink"])(
    "refuses a %s native selection before uploading",
    async (mode) => {
      const h = harness();
      const picked = await selected();
      if (mode === "modified") await writeFile(picked.file, "different content");
      else {
        await rename(picked.file, `${picked.file}.old`);
        if (mode === "symlink") await symlink(`${picked.file}.old`, picked.file);
        else await writeFile(picked.file, "replacement");
      }
      const result = await prepareNativeAttachments(h.runtime, async () => picked.result);
      expect(h.write).not.toHaveBeenCalled();
      expect(result.files).toEqual([]);
      expect(result.errors).toHaveLength(1);
    },
  );

  it("refuses a profile changed during the dialog, including switching back", async () => {
    const h = harness();
    const picked = await selected();
    await expect(
      prepareNativeAttachments(h.runtime, async () => {
        h.change({ connectionID: "other" });
        h.change({ connectionID: "original" });
        return picked.result;
      }),
    ).rejects.toThrow();
    expect(h.withClient).not.toHaveBeenCalled();
    expect(h.write).not.toHaveBeenCalled();
  });

  it("aborts the captured service request when focus changes and never uses the new service", async () => {
    const h = harness();
    const picked = await selected();
    h.write.mockImplementationOnce(async (input, options) => {
      h.change({ connectionID: "other" });
      expect(options?.signal?.aborted).toBe(true);
      return { data: { path: input.path } };
    });
    await expect(prepareNativeAttachments(h.runtime, async () => picked.result)).rejects.toThrow();
    expect(h.runtime.scopedConnection).toHaveBeenCalledExactlyOnceWith("original");
    expect(h.write).toHaveBeenCalledOnce();
    expect(h.listeners.size).toBe(0);
  });

  it.each(["relative/tmp", "\\rooted", "C:relative"])(
    "rejects invalid server temp %s before writing",
    async (temporary) => {
      const h = harness(temporary);
      const picked = await selected();
      await expect(prepareNativeAttachments(h.runtime, async () => picked.result)).rejects.toThrow(
        "invalid temporary",
      );
      expect(h.write).not.toHaveBeenCalled();
    },
  );

  it("does not accept an upload response pointing outside the requested temp path", async () => {
    const h = harness();
    h.write.mockResolvedValueOnce({ data: { path: "/etc/passwd" } });
    const picked = await selected();
    const result = await prepareNativeAttachments(h.runtime, async () => picked.result);
    expect(result.files).toEqual([]);
    expect(result.errors).toHaveLength(1);
  });

  it("preserves local attachment behavior without network writes", async () => {
    const h = harness();
    h.change({ topology: "same-machine" });
    const picked = await selected();
    expect(await prepareNativeAttachments(h.runtime, async () => picked.result)).toBe(
      picked.result,
    );
    expect(h.withClient).not.toHaveBeenCalled();
  });

  it("never returns desktop paths for an unknown destination topology", async () => {
    const h = harness();
    h.change({ topology: undefined });
    const picked = await selected();
    await expect(prepareNativeAttachments(h.runtime, async () => picked.result)).rejects.toThrow(
      "destination is unknown",
    );
    expect(h.write).not.toHaveBeenCalled();
  });

  it("does not acquire server info for an empty selection", async () => {
    const h = harness();
    const empty: PalotFilePickerResult = { files: [], errors: [] };
    expect(
      await uploadPickedAttachments(empty, h.client, {
        signal: new AbortController().signal,
        validate() {},
      }),
    ).toBe(empty);
    expect(h.info).not.toHaveBeenCalled();
  });
});
