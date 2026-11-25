/** What went wrong with the message being written: one line under the text, never a stack. */

import { CircleAlert } from "lucide-react";
import { ComposerError } from "../ui/composer";

/**
 * Why the message, a command or a recalled prompt did not go as asked, or else why the chosen
 * agent or model cannot send. The newest problem with the message wins the one line.
 */
export function ComposerErrorLine({
  message,
  selectionError,
}: {
  message: string | null;
  selectionError: string | null;
}) {
  const text = message ?? selectionError;
  if (!text) return null;
  return (
    <ComposerError data-palot-composer-error={message ? "" : undefined}>
      <CircleAlert aria-hidden="true" />
      <span className="min-w-0">{text}</span>
    </ComposerError>
  );
}

/** What went wrong picking, pasting or uploading attachments, beside the attachment chips. */
export function ComposerAttachmentErrors({ errors }: { errors: string[] }) {
  if (errors.length === 0) return null;
  return (
    <div role="alert" className="flex shrink-0 items-center gap-1.5 text-meta text-destructive">
      <CircleAlert aria-hidden="true" className="size-3.5 shrink-0" />
      {errors.map((error) => (
        <span key={error} className="max-w-72 truncate" title={error}>
          {error}
        </span>
      ))}
    </div>
  );
}
