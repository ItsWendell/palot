import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent,
  type MouseEvent,
} from "react";
import { createPortal } from "react-dom";
import { useAtomValue } from "jotai";
import { runtimeAtom } from "../atoms/workspace";
import { PanelsTopLeft } from "lucide-react";
import { palot } from "../services/palot";
import { showErrorToast } from "../lib/toast-error";
import type { OpenCodeRuntimeStatus } from "../../shared";

/** Pointer capture keeps the gesture owned by the row when it leaves the window.
 * This deliberately isn't a file/text OS drag and never exports session content.
 */
export function useSessionWindowDrag(sessionID: string, owner?: OpenCodeRuntimeStatus | null) {
  const activeRuntime = useAtomValue(runtimeAtom);
  // An explicitly unavailable owner must never fall back to the focused server.
  const runtime = owner === undefined ? activeRuntime : owner;
  const gesture = useRef<{
    id: number;
    x: number;
    y: number;
    dragging: boolean;
    target: HTMLElement;
    connectionID: string;
    profileID: string;
    sessionID: string;
  } | null>(null);
  const suppressClick = useRef(false);
  const [hint, setHint] = useState<"inside" | "outside" | null>(null);
  const outside = (x: number, y: number) =>
    x < 0 || y < 0 || x >= window.innerWidth || y >= window.innerHeight;
  const cancel = useCallback(() => {
    const current = gesture.current;
    gesture.current = null;
    setHint(null);
    if (current?.target.hasPointerCapture(current.id))
      current.target.releasePointerCapture(current.id);
  }, []);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !gesture.current) return;
      event.preventDefault();
      suppressClick.current = gesture.current.dragging;
      cancel();
    };
    window.addEventListener("keydown", escape, true);
    window.addEventListener("blur", cancel);
    return () => {
      window.removeEventListener("keydown", escape, true);
      window.removeEventListener("blur", cancel);
      const current = gesture.current;
      gesture.current = null;
      if (current?.target.hasPointerCapture(current.id))
        current.target.releasePointerCapture(current.id);
    };
  }, [cancel]);
  useEffect(() => {
    cancel();
  }, [sessionID, runtime?.connectionID, runtime?.profileID, runtime?.connected, cancel]);
  return {
    handleProps: {
      "data-session-drag-handle": sessionID,
      draggable: false,
      onPointerDown(event: PointerEvent<HTMLElement>) {
        if (event.button !== 0 || event.pointerType !== "mouse" || !event.isPrimary) return;
        suppressClick.current = false;
        if (!runtime?.connected || !runtime.connectionID) return;
        gesture.current = {
          id: event.pointerId,
          x: event.clientX,
          y: event.clientY,
          dragging: false,
          target: event.currentTarget,
          connectionID: runtime.connectionID,
          profileID: runtime.profileID,
          sessionID,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
      },
      onPointerMove(event: PointerEvent<HTMLElement>) {
        const current = gesture.current;
        if (!current || current.id !== event.pointerId) return;
        if (
          !current.dragging &&
          Math.hypot(event.clientX - current.x, event.clientY - current.y) < 8
        )
          return;
        current.dragging = true;
        suppressClick.current = true;
        event.preventDefault();
        setHint(outside(event.clientX, event.clientY) ? "outside" : "inside");
      },
      onPointerUp(event: PointerEvent<HTMLElement>) {
        const current = gesture.current;
        if (!current || current.id !== event.pointerId) return;
        const open =
          current.dragging &&
          current.sessionID === sessionID &&
          runtime?.connected &&
          current.connectionID === runtime.connectionID &&
          current.profileID === runtime.profileID &&
          outside(event.clientX, event.clientY);
        cancel();
        if (open)
          void palot
            .openSessionWindow(current.sessionID, current.connectionID)
            .catch((error) => showErrorToast("Could not open task in a new window", error));
      },
      onPointerCancel(event: PointerEvent<HTMLElement>) {
        if (gesture.current?.id === event.pointerId) cancel();
      },
      onLostPointerCapture(event: PointerEvent<HTMLElement>) {
        const current = gesture.current;
        // Capture events bubble. A different pointer (or a descendant releasing
        // its capture) does not revoke this row's ownership of the gesture.
        if (current?.id === event.pointerId && !current.target.hasPointerCapture(current.id))
          cancel();
      },
      onClickCapture(event: MouseEvent<HTMLElement>) {
        if (!suppressClick.current) return;
        suppressClick.current = false;
        // A cancelled drag must not swallow a later keyboard activation.
        if (event.detail === 0) return;
        event.preventDefault();
        event.stopPropagation();
      },
      onDragStart(event: React.DragEvent<HTMLElement>) {
        event.preventDefault();
      },
    },
    hint: hint
      ? createPortal(
          <div
            role="status"
            data-session-window-drag-hint
            className="pointer-events-none fixed inset-x-4 bottom-4 z-50 flex justify-center"
          >
            <div className="flex items-center gap-2 rounded-md border bg-popover px-3 py-2 text-sm text-popover-foreground shadow-sm">
              <PanelsTopLeft className="size-4" aria-hidden="true" />
              {hint === "outside"
                ? "Release to open a new window"
                : "Drag outside the window to open this task"}
            </div>
          </div>,
          document.body,
        )
      : null,
  };
}
