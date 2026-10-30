import { useEffect, useRef, type PointerEvent as ReactPointerEvent, type MouseEvent } from "react";
import { SESSION_TRIAGE_BATCH_LIMIT } from "../../shared";

/** Stage a sweep until release. No mutations on Escape, lost focus, or pointer cancellation. */
export function useInboxSweep<T>({
  items,
  keyOf,
  canSettle,
  settle,
  scopeKey,
}: {
  items: readonly T[];
  keyOf(item: T): string;
  canSettle(item: T): boolean;
  settle(items: T[]): unknown;
  scopeKey?: string;
}) {
  const current = useRef({ items, keyOf, canSettle, settle });
  useEffect(() => {
    current.current = { items, keyOf, canSettle, settle };
  });
  const cancelRef = useRef<(() => void) | null>(null);
  const suppressClick = useRef(false);
  useEffect(() => () => cancelRef.current?.(), [scopeKey]);
  return {
    onPointerDownCapture(event: ReactPointerEvent<HTMLElement>) {
      const target =
        event.target instanceof Element ? event.target.closest("[data-inbox-settle]") : null;
      if (!target || target.hasAttribute("disabled") || event.button !== 0) return;
      const container = event.currentTarget;
      const rows = new Map<string, HTMLElement>();
      const add = (element: Element | null) => {
        const row = element?.closest<HTMLElement>("[data-inbox-sweep-key]");
        const key = row?.dataset.inboxSweepKey;
        if (!row || !key || !container.contains(row) || rows.size >= SESSION_TRIAGE_BATCH_LIMIT)
          return;
        const value = current.current.items.find((item) => current.current.keyOf(item) === key);
        if (!value || !current.current.canSettle(value)) return;
        rows.set(key, row);
        row.dataset.inboxSweep = "true";
      };
      cancelRef.current?.();
      suppressClick.current = true;
      event.preventDefault();
      event.stopPropagation();
      add(target);
      const move = (event: PointerEvent) => {
        if (event.pointerId === pointerID)
          add(document.elementFromPoint(event.clientX, event.clientY));
      };
      const clean = () => {
        for (const row of rows.values()) delete row.dataset.inboxSweep;
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", cancel);
        window.removeEventListener("blur", cancel);
        window.removeEventListener("keydown", key);
        cancelRef.current = null;
        setTimeout(() => {
          suppressClick.current = false;
        }, 0);
      };
      const cancel = () => {
        clean();
      };
      const key = (event: KeyboardEvent) => {
        if (event.key === "Escape") cancel();
      };
      const pointerID = event.pointerId;
      const up = (event: PointerEvent) => {
        if (event.pointerId !== pointerID) return;
        add(document.elementFromPoint(event.clientX, event.clientY));
        clean();
        const latest = current.current;
        void latest.settle(
          latest.items.filter((item) => rows.has(latest.keyOf(item)) && latest.canSettle(item)),
        );
      };
      cancelRef.current = cancel;
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", cancel);
      window.addEventListener("blur", cancel);
      window.addEventListener("keydown", key);
    },
    onClickCapture(event: MouseEvent<HTMLElement>) {
      if (suppressClick.current && event.detail !== 0) {
        suppressClick.current = false;
        event.preventDefault();
        event.stopPropagation();
      }
    },
  };
}
