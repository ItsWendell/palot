import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import type { ComposerInputHandle } from "../composer-input";

/**
 * The editor handle and which draft scope is mounted. Work that finishes after a task switch
 * checks `isActive` so it never focuses or reports into another task's composer.
 */
export function useComposerFocus(draftScope: string, requestOpen: boolean) {
  const inputRef = useRef<ComposerInputHandle>(null);
  const activeScopeRef = useRef<string | null>(draftScope);
  useLayoutEffect(() => {
    activeScopeRef.current = draftScope;
    return () => {
      activeScopeRef.current = null;
    };
  }, [draftScope]);

  const focus = useCallback(() => {
    requestAnimationFrame(() => {
      if (activeScopeRef.current === draftScope) inputRef.current?.focus();
    });
  }, [draftScope]);

  // An answered request card drops focus as it leaves; the message input takes it back.
  const requestWasOpenRef = useRef(requestOpen);
  useEffect(() => {
    const closed = requestWasOpenRef.current && !requestOpen;
    requestWasOpenRef.current = requestOpen;
    if (closed && (!document.activeElement || document.activeElement === document.body)) focus();
  }, [focus, requestOpen]);

  return {
    inputRef,
    focus,
    isActive: (scope: string) => activeScopeRef.current === scope,
  };
}

export type ComposerFocus = ReturnType<typeof useComposerFocus>;
