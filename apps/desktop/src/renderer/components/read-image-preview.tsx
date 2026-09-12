import { Check, Copy, Download, Minus, Plus, X } from "lucide-react";
import { motion } from "motion/react";
import { memo, useId, useRef, useState } from "react";
import { useClipboardCopy } from "../hooks/use-clipboard-copy";
import { showErrorToast } from "../lib/toast-error";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./ui/dialog";

const transition = { type: "spring", stiffness: 210, damping: 26, mass: 0.8 } as const;

export const ReadImagePreview = memo(function ReadImagePreview({
  src,
  name,
  mime,
}: {
  src: string;
  name: string;
  mime: string;
}) {
  const layoutID = useId();
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        type="button"
        variant="outline"
        aria-label={`Open preview of ${name}`}
        onClick={() => setOpen(true)}
        className="group h-auto max-w-full overflow-hidden rounded-lg bg-muted/25 p-0 hover:bg-muted/40"
      >
        <motion.div layoutId={layoutID} transition={transition} className="max-w-full">
          <img
            src={src}
            alt={name}
            draggable={false}
            className="max-h-72 max-w-full object-contain"
          />
        </motion.div>
      </Button>

      <ImageLightbox
        src={src}
        name={name}
        mime={mime}
        open={open}
        onOpenChange={setOpen}
        layoutID={layoutID}
      />
    </>
  );
});

export function ImageLightbox({
  src,
  name,
  mime,
  open,
  onOpenChange,
  layoutID,
}: {
  src: string;
  name: string;
  mime: string;
  open: boolean;
  onOpenChange(open: boolean): void;
  layoutID?: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open ? (
        <ImageLightboxContent
          src={src}
          name={name}
          mime={mime}
          onClose={() => onOpenChange(false)}
          layoutID={layoutID}
        />
      ) : null}
    </Dialog>
  );
}

function ImageLightboxContent({
  src,
  name,
  mime,
  onClose,
  layoutID,
}: {
  src: string;
  name: string;
  mime: string;
  onClose(): void;
  layoutID?: string;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const [zoomed, setZoomed] = useState(false);
  const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null);
  const { copiedKey, copy } = useClipboardCopy();
  const copied = copiedKey === "image-address";

  function close() {
    setZoomed(false);
    onClose();
  }

  return (
    <DialogContent
      showCloseButton={false}
      className="inset-0 grid h-dvh w-dvw max-w-none translate-x-0 translate-y-0 grid-rows-[auto_1fr] rounded-none bg-transparent p-0 ring-0 sm:max-w-none data-open:animate-none data-closed:animate-none"
    >
      <div className="image-lightbox-toolbar pointer-events-none relative z-10 flex min-w-0 items-start justify-between gap-3 p-3 sm:p-4">
        <div className="palot-promoted-blur pointer-events-auto min-w-0 rounded-lg border bg-popover/95 px-2.5 py-1.5 shadow-sm backdrop-blur-sm">
          <DialogTitle className="max-w-[60vw] truncate text-xs">{name}</DialogTitle>
          <DialogDescription className="text-micro!">
            {mime}
            {dimensions ? ` · ${dimensions.width} × ${dimensions.height}` : ""}
          </DialogDescription>
        </div>
        <div className="pointer-events-auto flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="icon-lg"
            aria-label={copied ? "Copied image address" : "Copy image address"}
            onClick={() => void copy(src, "image-address")}
            className="palot-promoted-blur bg-popover/95 shadow-sm backdrop-blur-sm"
          >
            {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon-lg"
            aria-label="Download image"
            onClick={() => {
              void window.palot.downloadUrl(src).catch((error) => {
                showErrorToast("Could not download image", error);
              });
            }}
            className="palot-promoted-blur bg-popover/95 shadow-sm backdrop-blur-sm"
          >
            <Download aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon-lg"
            aria-label={zoomed ? "Zoom out" : "Zoom in"}
            onClick={() => setZoomed((value) => !value)}
            className="palot-promoted-blur bg-popover/95 shadow-sm backdrop-blur-sm"
          >
            {zoomed ? <Minus aria-hidden="true" /> : <Plus aria-hidden="true" />}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon-lg"
            aria-label="Close image preview"
            onClick={close}
            className="palot-promoted-blur bg-popover/95 shadow-sm backdrop-blur-sm"
          >
            <X aria-hidden="true" />
          </Button>
        </div>
      </div>

      <div
        ref={frameRef}
        className="relative min-h-0 overflow-hidden p-4 pt-0 sm:p-14 sm:pt-0"
        onClick={(event) => {
          if (event.target === event.currentTarget) close();
        }}
      >
        <motion.div
          layoutId={layoutID}
          transition={transition}
          className="flex size-full items-center justify-center"
          onClick={(event) => {
            if (event.target === event.currentTarget) close();
          }}
        >
          <motion.img
            src={src}
            alt={name}
            draggable={false}
            drag={zoomed}
            dragConstraints={frameRef}
            dragElastic={0.08}
            animate={{ scale: zoomed ? 1.8 : 1, x: 0, y: 0 }}
            transition={transition}
            onLoad={(event) =>
              setDimensions({
                width: event.currentTarget.naturalWidth,
                height: event.currentTarget.naturalHeight,
              })
            }
            onDoubleClick={() => setZoomed((value) => !value)}
            className={
              zoomed
                ? "max-h-full max-w-full cursor-grab object-contain active:cursor-grabbing"
                : "max-h-full max-w-full cursor-zoom-in object-contain"
            }
          />
        </motion.div>
      </div>
    </DialogContent>
  );
}
