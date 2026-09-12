import { FileText, X } from "lucide-react";
import { memo, useEffect, useState } from "react";
import { useAtomValue } from "jotai";
import { runtimeAtom } from "../atoms/workspace";
import type { PalotFileAttachment } from "../../shared";
import { palot } from "../services/palot";
import { ImageLightbox } from "./read-image-preview";
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentMedia,
  AttachmentTitle,
  AttachmentTrigger,
} from "./ui/attachment";
import { Skeleton } from "./ui/skeleton";

function attachmentDescription(file: PalotFileAttachment) {
  const type = file.mime.split("/").at(-1)?.toUpperCase() || "FILE";
  if (file.size === null) return type;
  if (file.size < 1024) return `${type} · ${file.size} B`;
  if (file.size < 1024 * 1024) return `${type} · ${Math.round(file.size / 1024)} KB`;
  return `${type} · ${(file.size / (1024 * 1024)).toFixed(1)} MB`;
}

export const FileAttachment = memo(
  function FileAttachment({
    file,
    onRemove,
  }: {
    file: PalotFileAttachment;
    onRemove?: () => void;
  }) {
    const connectionID = useAtomValue(runtimeAtom)?.connectionID;
    const [grantPreview, setGrantPreview] = useState<{ grant: string; url: string | null } | null>(
      null,
    );
    const previewUrl =
      file.previewDataUrl ?? (grantPreview?.grant === file.previewGrant ? grantPreview?.url : null);
    const [failedUrl, setFailedUrl] = useState<string | null>(null);
    const imageMime = file.mime.toLowerCase().startsWith("image/");
    const image =
      imageMime &&
      Boolean(file.previewDataUrl || file.previewGrant) &&
      (!previewUrl || failedUrl !== previewUrl) &&
      Boolean(
        file.previewDataUrl || grantPreview?.grant !== file.previewGrant || grantPreview?.url,
      );
    const [open, setOpen] = useState(false);

    useEffect(() => {
      if (!imageMime || !file.previewGrant || file.previewDataUrl) return;
      const grant = file.previewGrant;
      let active = true;
      let url: string | null = null;
      void palot
        .attachmentPreview(file.previewGrant, connectionID)
        .then((preview) => {
          if (!active) return;
          if (!preview) {
            setGrantPreview({ grant, url: null });
            return;
          }
          url = URL.createObjectURL(new Blob([preview.data], { type: preview.mime }));
          setGrantPreview({ grant, url });
        })
        .catch(() => {
          if (active) setGrantPreview({ grant, url: null });
        });
      return () => {
        active = false;
        if (url) URL.revokeObjectURL(url);
      };
    }, [file.previewGrant, file.previewDataUrl, imageMime, connectionID]);

    return (
      <>
        <Attachment size="sm" className="max-w-60 bg-background/55">
          <AttachmentMedia variant={image ? "image" : "icon"}>
            {image ? (
              previewUrl ? (
                <img
                  src={previewUrl}
                  alt=""
                  draggable={false}
                  onError={() => setFailedUrl(previewUrl)}
                />
              ) : (
                <Skeleton className="size-full rounded-none" />
              )
            ) : (
              <FileText aria-hidden="true" />
            )}
          </AttachmentMedia>
          <AttachmentContent>
            <AttachmentTitle title={file.name}>{file.name}</AttachmentTitle>
            <AttachmentDescription>{attachmentDescription(file)}</AttachmentDescription>
          </AttachmentContent>
          {image && previewUrl ? (
            <AttachmentTrigger
              aria-label={`Open preview of ${file.name}`}
              onClick={() => setOpen(true)}
            />
          ) : null}
          {onRemove ? (
            <AttachmentActions>
              <AttachmentAction aria-label={`Remove ${file.name}`} onClick={onRemove}>
                <X aria-hidden="true" />
              </AttachmentAction>
            </AttachmentActions>
          ) : null}
        </Attachment>
        {image && previewUrl ? (
          <ImageLightbox
            src={previewUrl}
            name={file.name}
            mime={file.mime}
            open={open}
            onOpenChange={setOpen}
          />
        ) : null}
      </>
    );
  },
  (previous, next) =>
    previous.file === next.file && Boolean(previous.onRemove) === Boolean(next.onRemove),
);
