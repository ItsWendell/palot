import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import type { Virtualizer } from "@tanstack/react-virtual";
import type { TranscriptProjectionRow } from "../lib/turn-projection";
import type { TranscriptPrompt, TranscriptPromptAnchor } from "../lib/transcript-outline";
import { adjacentPromptID } from "../lib/session-history";

export function useTranscriptNavigation(input: {
  scopeID: string;
  resetKey?: number;
  rows: TranscriptProjectionRow[];
  prompts: readonly TranscriptPromptAnchor[];
  indexedPrompts?: readonly TranscriptPrompt[];
  viewport: RefObject<HTMLDivElement | null>;
  virtualizer: Virtualizer<HTMLDivElement, Element>;
  bottomInset: number;
  pin(id: string | null): void;
  unlock(): void;
  clearAnchor(): void;
  hasMore: boolean;
  loading: boolean;
  historyStartID: string | null;
  loadOlder(): Promise<boolean>;
}) {
  const [target, setTarget] = useState<{
    messageID: string;
    scopeID: string;
    serial: number;
  } | null>(null);
  const serial = useRef(0);
  const [earlierThan, setEarlierThan] = useState<{
    messageID: string;
    scopeID: string;
    historyStartID: string | null;
    settled: boolean;
    exact: boolean;
  } | null>(null);
  const currentID = useRef<string | null>(null);
  const promptIndex = input.indexedPrompts ?? input.prompts;
  const ids = useMemo(() => promptIndex.map((prompt) => prompt.messageID), [promptIndex]);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [activeMessageID, setActiveMessageID] = useState<string | null>(null);
  const totalSize = input.virtualizer.getTotalSize();
  const railSpace = Math.max(0, size.height - input.bottomInset - 48);
  const railHeight = Math.min(360, railSpace * 0.7);
  const railTop = 24 + (railSpace - railHeight) / 2;
  const railCompact = size.width < 864;
  const railVisible = promptIndex.length >= 4 && railHeight >= 80 && totalSize > size.height + 1;
  const activeFrame = useRef<number | null>(null);
  const activeTracking = useRef(false);
  const activeUpdate = useRef<() => void>(() => {});
  const scheduleActive = useCallback(() => {
    if (!activeTracking.current || activeFrame.current !== null) return;
    activeFrame.current = requestAnimationFrame(() => {
      activeFrame.current = null;
      if (activeTracking.current) activeUpdate.current();
    });
  }, []);
  useLayoutEffect(() => {
    const viewport = input.viewport.current;
    if (!viewport) return;
    const measure = () => {
      const width = viewport.clientWidth;
      const height = viewport.clientHeight;
      setSize((current) =>
        current.width === width && current.height === height ? current : { width, height },
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [input.scopeID, input.viewport, input.bottomInset]);
  const updateActive = useCallback(() => {
    const viewport = input.viewport.current;
    if (!viewport) return;
    const scrollTop = Math.max(0, viewport.scrollTop);
    const height = viewport.clientHeight;
    const scrollHeight = viewport.scrollHeight;
    // Position, not follow intent: a short final exchange may never reach the
    // viewport's reading line. Browser scroll extent can differ from estimates.
    if (height > 0 && scrollHeight > 0 && scrollHeight - scrollTop - height <= 1) {
      const id = input.prompts.at(-1)?.messageID ?? null;
      currentID.current = id;
      setActiveMessageID((current) => (current === id ? current : id));
      return;
    }
    const readingTop = scrollTop + 16;
    const bottom = scrollTop + height - input.bottomInset;
    // The range includes intentional offscreen pins. Only intersecting rows count.
    const row = input.virtualizer
      .getVirtualItems()
      .find((item) => item.end > readingTop && item.start < bottom);
    if (!row) return;
    let low = 0;
    let high = input.prompts.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (input.prompts[middle]!.rowIndex <= row.index) low = middle + 1;
      else high = middle;
    }
    const id = input.prompts[Math.max(0, low - 1)]?.messageID ?? null;
    currentID.current = id;
    setActiveMessageID((current) => (current === id ? current : id));
  }, [input.bottomInset, input.prompts, input.viewport, input.virtualizer]);
  useLayoutEffect(() => {
    activeTracking.current = railVisible;
    activeUpdate.current = updateActive;
  }, [railVisible, updateActive]);
  useEffect(() => {
    if (!railVisible) return;
    const viewport = input.viewport.current;
    if (!viewport) return;
    scheduleActive();
    viewport.addEventListener("scroll", scheduleActive, { passive: true });
    return () => {
      viewport.removeEventListener("scroll", scheduleActive);
      if (activeFrame.current !== null) cancelAnimationFrame(activeFrame.current);
      activeFrame.current = null;
    };
  }, [railVisible, input.viewport, input.scopeID, scheduleActive]);
  useEffect(() => {
    scheduleActive();
  }, [updateActive, totalSize, size.width, size.height, scheduleActive]);
  useLayoutEffect(
    () => () => {
      activeTracking.current = false;
    },
    [],
  );
  const targetIndex = target
    ? input.rows.findIndex(
        (row) =>
          row.turn.users.some((message) => message.id === target?.messageID) ||
          row.turn.user?.id === target?.messageID,
      )
    : -1;
  const targetTurnID = input.rows[targetIndex]?.id;
  function cancel() {
    serial.current += 1;
    setTarget(null);
    setEarlierThan(null);
    input.clearAnchor();
  }
  useLayoutEffect(() => {
    serial.current += 1;
    setTarget(null);
    setEarlierThan(null);
    currentID.current = null;
    setActiveMessageID(null);
    return () => {
      serial.current += 1;
    };
  }, [input.scopeID, input.resetKey]);
  function jump(messageID: string) {
    serial.current += 1;
    setTarget(null);
    setEarlierThan(null);
    input.clearAnchor();
    input.unlock();
    currentID.current = messageID;
    if (!input.rows.some((row) => row.turn.users.some((user) => user.id === messageID))) {
      if (input.hasMore) loadEarlierThan(messageID, true);
      return;
    }
    setTarget({ messageID, scopeID: input.scopeID, serial: ++serial.current });
  }
  function loadEarlierThan(messageID: string, exact = false) {
    const request = {
      messageID,
      scopeID: input.scopeID,
      historyStartID: input.loading ? null : input.historyStartID,
      settled: input.loading,
      exact,
    };
    setEarlierThan(request);
    if (input.loading) return;
    void input.loadOlder().then(
      (loaded) =>
        setEarlierThan((current) =>
          current === request ? (loaded ? { ...request, settled: true } : null) : current,
        ),
      () => setEarlierThan((current) => (current === request ? null : current)),
    );
  }
  useEffect(() => {
    if (!earlierThan?.settled || input.loading || earlierThan.scopeID !== input.scopeID) return;
    const previous = earlierThan.exact
      ? input.rows.some((row) => row.turn.users.some((user) => user.id === earlierThan.messageID))
        ? earlierThan.messageID
        : null
      : adjacentPromptID(ids, earlierThan.messageID, "previous");
    if (previous) {
      jump(previous);
    } else if (input.hasMore && input.historyStartID !== earlierThan.historyStartID) {
      // Continue only after an actual prepend, not unrelated streaming updates or a failed page.
      loadEarlierThan(earlierThan.messageID, earlierThan.exact);
    } else setEarlierThan(null);
  });
  useEffect(() => {
    if (!target || target.scopeID !== input.scopeID) return;
    if (!targetTurnID) {
      setTarget(null);
      return;
    }
    input.pin(targetTurnID);
    input.virtualizer.scrollToIndex(targetIndex, { align: "start" });
    let frame = 0;
    let stableFrames = 0;
    const startedAt = performance.now();
    const align = () => {
      if (serial.current !== target.serial) return;
      const viewport = input.viewport.current;
      const element = viewport?.querySelector<HTMLElement>(
        `[data-turn-row-id="${CSS.escape(targetTurnID)}"]`,
      );
      if (viewport && element) {
        const correction =
          element.getBoundingClientRect().top - viewport.getBoundingClientRect().top;
        if (Math.abs(correction) > 0.5) viewport.scrollTop += correction;
        stableFrames = Math.abs(correction) <= 0.5 ? stableFrames + 1 : 0;
      }
      const elapsed = performance.now() - startedAt;
      if (elapsed >= 700 || (stableFrames >= 3 && elapsed >= 100)) setTarget(null);
      else frame = requestAnimationFrame(align);
    };
    frame = requestAnimationFrame(align);
    return () => {
      cancelAnimationFrame(frame);
      input.pin(null);
    };
  }, [target, targetIndex, targetTurnID, input.virtualizer, input.scopeID, input.pin]);
  function move(direction: "previous" | "next") {
    setEarlierThan(null);
    const viewport = input.viewport.current;
    const visible = viewport
      ? input.rows.find((row) => {
          if (!row.turn.user) return false;
          const element = viewport.querySelector<HTMLElement>(
            `[data-turn-row-id="${CSS.escape(row.id)}"]`,
          );
          return (
            element && element.getBoundingClientRect().bottom > viewport.getBoundingClientRect().top
          );
        })?.turn.user?.id
      : null;
    const current = target ? currentID.current : (visible ?? currentID.current);
    const next = adjacentPromptID(ids, current ?? null, direction);
    if (next) jump(next);
    else if (direction === "previous" && input.hasMore && !input.loading) {
      const boundary = current ?? ids[0];
      if (boundary) loadEarlierThan(boundary);
    }
  }
  return {
    jump,
    move,
    cancel,
    activeMessageID,
    railHeight,
    railTop,
    railVisible,
    railCompact,
    onGeometryChange: scheduleActive,
    isNavigating: target !== null || earlierThan !== null,
  };
}
