import { beforeEach, expect, it, vi } from "vitest";
import { writeClipboardImage } from "./clipboard-image";

const clipboard = vi.hoisted(() => ({ write: vi.fn().mockResolvedValue(undefined) }));
vi.mock("electron", () => ({
  clipboard,
  ClipboardItem: class {
    constructor(readonly data: Record<string, Blob>) {}
  },
}));
beforeEach(() => vi.clearAllMocks());

it("writes PNG bytes through Electron rather than Chromium clipboard permissions", async () => {
  const data = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2]).buffer;
  await writeClipboardImage(data);
  const png = clipboard.write.mock.calls[0]![0][0].data["image/png"] as Blob;
  expect(png.type).toBe("image/png");
  expect(new Uint8Array(await png.arrayBuffer())).toEqual(new Uint8Array(data));
});

it.each([
  null,
  "data:image/png;base64,unsafe",
  new ArrayBuffer(0),
  new Uint8Array([1, 2]).buffer,
  new ArrayBuffer(21 * 1024 * 1024),
])(
  "rejects invalid or oversized image payloads without touching the native clipboard",
  async (data) => {
    await expect(writeClipboardImage(data)).rejects.toThrow("Clipboard image");
    expect(clipboard.write).not.toHaveBeenCalled();
  },
);
