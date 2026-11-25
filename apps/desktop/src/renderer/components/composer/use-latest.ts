import { useLayoutEffect, useRef, type RefObject } from "react";
import type { PalotMessage } from "../../../shared";
import type { PendingRequestView } from "../../lib/view-models";

/** The composer props that async work reads when it finishes, not when it started. */
export interface ComposerLiveProps {
  messages: PalotMessage[];
  pendingInputs: PendingRequestView[];
}

export type ComposerLive = RefObject<ComposerLiveProps>;

/** The latest committed value, for async work that must not act on a stale render. */
export function useLatest<T>(value: T): RefObject<T> {
  const ref = useRef(value);
  useLayoutEffect(() => {
    ref.current = value;
  }, [value]);
  return ref;
}
