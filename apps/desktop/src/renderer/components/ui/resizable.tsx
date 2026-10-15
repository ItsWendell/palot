"use client";

import * as React from "react";
import * as ResizablePrimitive from "react-resizable-panels";

import { cn } from "@/lib/cn";

/** The library's default pointer hit size around each separator, in pixels. */
const SEPARATOR_HIT_SIZE = { fine: 10, coarse: 20 } as const;

/**
 * The separator's hit area extends past its 1px line over the neighbouring panes, where
 * an edge scrollbar often sits. The library claims presses there from a document-level
 * capture listener, but the scrollbar beneath would still start its own drag and win.
 * Stop such presses at the group, after the library has seen them, so they only resize.
 */
function claimSeparatorHitArea(group: HTMLElement, event: PointerEvent): void {
  if (event.pointerType === "mouse" && event.button !== 0) return;
  const target = event.target;
  if (!(target instanceof Element) || target.closest('[data-slot="resizable-handle"]')) return;
  const coarse =
    typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
  const reach = (coarse ? SEPARATOR_HIT_SIZE.coarse : SEPARATOR_HIT_SIZE.fine) / 2;
  for (const separator of group.querySelectorAll<HTMLElement>('[data-slot="resizable-handle"]')) {
    if (
      separator.closest('[data-slot="resizable-panel-group"]') !== group ||
      separator.getAttribute("aria-disabled") === "true"
    )
      continue;
    const rect = separator.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) continue;
    const vertical = separator.getAttribute("aria-orientation") !== "horizontal";
    // Strict, like the library's own hit test, so no edge pixel is claimed but not resized.
    const across = vertical
      ? event.clientX > rect.left - reach && event.clientX < rect.right + reach
      : event.clientY > rect.top - reach && event.clientY < rect.bottom + reach;
    const along = vertical
      ? event.clientY >= rect.top && event.clientY <= rect.bottom
      : event.clientX >= rect.left && event.clientX <= rect.right;
    if (!across || !along) continue;
    event.stopPropagation();
    event.preventDefault();
    return;
  }
}

function ResizablePanelGroup({ className, elementRef, ...props }: ResizablePrimitive.GroupProps) {
  const [element, setElement] = React.useState<HTMLDivElement | null>(null);
  React.useEffect(() => {
    if (!element) return;
    const listener = (event: PointerEvent) => claimSeparatorHitArea(element, event);
    element.addEventListener("pointerdown", listener, { capture: true });
    return () => element.removeEventListener("pointerdown", listener, { capture: true });
  }, [element]);
  const setElementRef = React.useCallback(
    (node: HTMLDivElement | null) => {
      setElement(node);
      if (typeof elementRef === "function") elementRef(node);
      else if (elementRef) elementRef.current = node;
    },
    [elementRef],
  );
  return (
    <ResizablePrimitive.Group
      data-slot="resizable-panel-group"
      className={cn("flex h-full w-full aria-[orientation=vertical]:flex-col", className)}
      elementRef={setElementRef}
      {...props}
    />
  );
}

function ResizablePanel({ ...props }: ResizablePrimitive.PanelProps) {
  return <ResizablePrimitive.Panel data-slot="resizable-panel" {...props} />;
}

function ResizableHandle({
  withHandle,
  className,
  ...props
}: ResizablePrimitive.SeparatorProps & {
  withHandle?: boolean;
}) {
  return (
    <ResizablePrimitive.Separator
      data-slot="resizable-handle"
      className={cn(
        // The separator is the visible 1px line, so panes meet it edge to edge.
        // react-resizable-panels expands the pointer hit area around it
        // (Group `resizeTargetMinimumSize`), so the layout never reserves a gutter.
        "relative z-10 flex w-px shrink-0 items-center justify-center bg-border ring-offset-background transition-colors duration-150 data-[separator=active]:bg-ring/55 data-[separator=focus]:bg-foreground/35 data-[separator=hover]:bg-foreground/35 focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-hidden aria-[orientation=vertical]:aria-disabled:w-0 aria-[orientation=horizontal]:h-px aria-[orientation=horizontal]:w-full aria-[orientation=horizontal]:aria-disabled:h-0 [&[aria-orientation=horizontal]>div]:rotate-90",
        className,
      )}
      {...props}
    >
      {withHandle && <div className="z-10 flex h-6 w-1 shrink-0 rounded-lg bg-border" />}
    </ResizablePrimitive.Separator>
  );
}

export { ResizableHandle, ResizablePanel, ResizablePanelGroup };
