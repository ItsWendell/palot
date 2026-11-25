import { useLayoutEffect, useState } from "react";

/** The message of an error, or the fallback when it carries none. */
export function errorText(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

/**
 * Two channels: attachment errors stay beside the attachments, and one message error reports why
 * the message, a command or a recalled prompt did not go as asked. Both reset with the scope.
 */
export function useComposerErrors(scopeKey: string) {
  const [attachmentErrors, setAttachmentErrors] = useState<string[]>([]);
  const [messageError, setMessageError] = useState<string | null>(null);
  useLayoutEffect(() => {
    setAttachmentErrors((current) => (current.length === 0 ? current : []));
    setMessageError(null);
  }, [scopeKey]);
  return {
    attachmentErrors,
    messageError,
    setAttachmentErrors,
    report: setMessageError,
    clear() {
      setAttachmentErrors((current) => (current.length === 0 ? current : []));
      setMessageError(null);
    },
  };
}

export type ComposerErrors = ReturnType<typeof useComposerErrors>;
