"use client";

import * as ResizablePrimitive from "react-resizable-panels";

import { cn } from "@/lib/cn";

function ResizablePanelGroup({ className, ...props }: ResizablePrimitive.GroupProps) {
  return (
    <ResizablePrimitive.Group
      data-slot="resizable-panel-group"
      className={cn("flex h-full w-full aria-[orientation=vertical]:flex-col", className)}
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
