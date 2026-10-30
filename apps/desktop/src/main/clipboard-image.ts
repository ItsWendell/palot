import { clipboard, ClipboardItem } from "electron";

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

/** Called only after the IPC handler has authenticated the top-level app frame. */
export async function writeClipboardImage(input: unknown): Promise<void> {
  if (!(input instanceof ArrayBuffer) || !input.byteLength || input.byteLength > MAX_IMAGE_BYTES)
    throw new Error("Clipboard image must be a PNG smaller than 20 MB.");
  const bytes = new Uint8Array(input);
  if (![137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value))
    throw new Error("Clipboard image must be a PNG.");
  await clipboard.write([
    new ClipboardItem({ "image/png": new Blob([input], { type: "image/png" }) }),
  ]);
}
