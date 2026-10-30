import type { ReactElement } from "react";
import { showErrorToast } from "../lib/toast-error";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
} from "./ui/context-menu";

export function MarkdownImageActions({
  src,
  name,
  children,
}: {
  src: string;
  name: string;
  children: ReactElement;
}) {
  async function save() {
    if (/^https?:\/\//i.test(src) && window.palot) return window.palot.downloadUrl(src);
    const anchor = document.createElement("a");
    anchor.href = src;
    anchor.download = name;
    anchor.click();
  }
  async function copy() {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.src = src;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Image copying is unavailable");
    context.drawImage(image, 0, 0);
    const png = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (value) => (value ? resolve(value) : reject(new Error("Image conversion failed"))),
        "image/png",
      ),
    );
    await window.palot.writeClipboardImage(await png.arrayBuffer());
  }
  return (
    <ContextMenu>
      <ContextMenuTrigger render={children} />
      <ContextMenuContent>
        <ContextMenuItem
          onClick={() =>
            void save().catch((error: unknown) => showErrorToast("Could not save image", error))
          }
        >
          Save image as…
        </ContextMenuItem>
        <ContextMenuItem
          onClick={() =>
            void copy().catch((error: unknown) => showErrorToast("Could not copy image", error))
          }
        >
          Copy image
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
