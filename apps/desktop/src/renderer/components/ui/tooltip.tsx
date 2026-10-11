"use client";

import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";

import { cn } from "@/lib/cn";
import { SurfaceBackdrop } from "@/components/ui/surface-backdrop";

/**
 * Fluid Functionalism tooltip motion: a 4px slide toward the trigger and a fade on
 * spring.fast (motion's `spring(0.08, 0)` as a CSS `linear()` curve), a quicker exit, and
 * no animation when Base UI swaps tooltips instantly between adjacent triggers.
 */
const tooltipMotionClassName =
  "transition-[opacity,translate] duration-200 ease-[linear(0,0.6409,0.9317,0.9892,0.9984,0.9998,1)] data-starting-style:opacity-0 data-ending-style:opacity-0 data-ending-style:duration-60 data-ending-style:ease-out data-instant:transition-none motion-safe:data-[side=top]:data-starting-style:translate-y-1 motion-safe:data-[side=top]:data-ending-style:translate-y-1 motion-safe:data-[side=bottom]:data-starting-style:-translate-y-1 motion-safe:data-[side=bottom]:data-ending-style:-translate-y-1 motion-safe:data-[side=left]:data-starting-style:translate-x-1 motion-safe:data-[side=left]:data-ending-style:translate-x-1 motion-safe:data-[side=right]:data-starting-style:-translate-x-1 motion-safe:data-[side=right]:data-ending-style:-translate-x-1";

function TooltipProvider({ delay = 0, ...props }: TooltipPrimitive.Provider.Props) {
  return <TooltipPrimitive.Provider data-slot="tooltip-provider" delay={delay} {...props} />;
}

function Tooltip({ ...props }: TooltipPrimitive.Root.Props) {
  return <TooltipPrimitive.Root data-slot="tooltip" {...props} />;
}

function TooltipTrigger({ ...props }: TooltipPrimitive.Trigger.Props) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />;
}

function TooltipContent({
  className,
  side = "top",
  sideOffset = 4,
  align = "center",
  alignOffset = 0,
  children,
  ...props
}: TooltipPrimitive.Popup.Props &
  Pick<TooltipPrimitive.Positioner.Props, "align" | "alignOffset" | "side" | "sideOffset">) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
        className="palot-glass-positioner isolate z-50 rounded-md"
      >
        <TooltipPrimitive.Popup
          data-slot="tooltip-content"
          className={cn(
            "isolate z-50 inline-flex w-fit max-w-xs origin-(--transform-origin) items-center gap-1 rounded-md border border-border/80 bg-popover px-2 py-1 text-meta leading-none text-popover-foreground shadow-md has-data-[slot=kbd]:pr-1.5 **:data-[slot=kbd]:relative **:data-[slot=kbd]:isolate **:data-[slot=kbd]:z-50 **:data-[slot=kbd]:rounded-sm",
            tooltipMotionClassName,
            className,
          )}
          {...props}
        >
          <SurfaceBackdrop />
          {children}
        </TooltipPrimitive.Popup>
      </TooltipPrimitive.Positioner>
    </TooltipPrimitive.Portal>
  );
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider };
