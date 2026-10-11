import { useCallback, useEffect, useState, type FocusEvent, type KeyboardEvent } from "react";

export const ARMED_CONFIRM_TIMEOUT_MS = 3_000;

/**
 * In-place confirmation for destructive buttons: the first activation arms, a second
 * one within three seconds confirms. Escape, blur, or the timeout disarms.
 */
export function useArmedConfirm(onConfirm: () => void, timeoutMs = ARMED_CONFIRM_TIMEOUT_MS) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const timer = window.setTimeout(() => setArmed(false), timeoutMs);
    return () => window.clearTimeout(timer);
  }, [armed, timeoutMs]);
  const disarm = useCallback(() => setArmed(false), []);
  return {
    armed,
    disarm,
    buttonProps: {
      "data-armed": armed ? "" : undefined,
      onClick: () => {
        if (!armed) {
          setArmed(true);
          return;
        }
        setArmed(false);
        onConfirm();
      },
      onBlur: (_event: FocusEvent<HTMLElement>) => setArmed(false),
      onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
        if (event.key !== "Escape" || !armed) return;
        // Disarm without also closing the surrounding popover.
        event.preventDefault();
        event.stopPropagation();
        setArmed(false);
      },
    },
  };
}
