import { useCallback, useEffect, useRef, useState } from "react";
import { writeClipboardText } from "../lib/clipboard";
import { showErrorToast } from "../lib/toast-error";

const COPY_FEEDBACK_MS = 1_400;

export function useClipboardCopy() {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const resetTimer = useRef<number | null>(null);

  const copy = useCallback(async (value: string, key = "default") => {
    try {
      await writeClipboardText(value);
      setCopiedKey(key);
      if (resetTimer.current !== null) window.clearTimeout(resetTimer.current);
      resetTimer.current = window.setTimeout(() => {
        resetTimer.current = null;
        setCopiedKey(null);
      }, COPY_FEEDBACK_MS);
      return true;
    } catch (error) {
      showErrorToast("Could not copy to clipboard", error);
      return false;
    }
  }, []);

  useEffect(
    () => () => {
      if (resetTimer.current !== null) window.clearTimeout(resetTimer.current);
    },
    [],
  );

  return { copiedKey, copy };
}
