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
        "relative z-10 flex w-2.5 items-center justify-center ring-offset-background after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:bg-border after:transition-colors after:duration-150 data-[separator=active]:after:bg-ring/55 data-[separator=focus]:after:bg-foreground/35 data-[separator=hover]:after:bg-foreground/35 focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-hidden aria-[orientation=vertical]:aria-disabled:w-0 aria-[orientation=horizontal]:h-2.5 aria-[orientation=horizontal]:w-full aria-[orientation=horizontal]:aria-disabled:h-0 aria-[orientation=horizontal]:after:top-1/2 aria-[orientation=horizontal]:after:bottom-auto aria-[orientation=horizontal]:after:left-0 aria-[orientation=horizontal]:after:h-px aria-[orientation=horizontal]:after:w-full aria-[orientation=horizontal]:after:translate-x-0 aria-[orientation=horizontal]:after:-translate-y-1/2 [&[aria-orientation=horizontal]>div]:rotate-90",
        className,
      )}
      {...props}
    >
      {withHandle && <div className="z-10 flex h-6 w-1 shrink-0 rounded-lg bg-border" />}
    </ResizablePrimitive.Separator>
  );
}

export { ResizableHandle, ResizablePanel, ResizablePanelGroup };
