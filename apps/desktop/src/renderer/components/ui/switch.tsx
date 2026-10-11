"use client"

import { Switch as SwitchPrimitive } from "@base-ui/react/switch"

import { cn } from "@/lib/cn"

// Fluid Functionalism switch motion: the thumb springs between ends on spring.fast
// (motion's `spring(0.08, 0)` as a CSS `linear()` curve) and stretches slightly while
// pressed, growing away from the end it rests on. Geometry lives in CSS variables on the
// root so both sizes share one rule: travel is the track's inner width minus the thumb.
function Switch({
  className,
  size = "default",
  ...props
}: SwitchPrimitive.Root.Props & {
  size?: "sm" | "default"
}) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      data-size={size}
      className={cn(
        "peer group/switch relative inline-flex shrink-0 items-center rounded-full border border-transparent transition-all outline-none after:absolute after:-inset-x-3 after:-inset-y-2 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20 data-[size=default]:h-[16.6px] data-[size=default]:w-[28px] data-[size=sm]:h-[14px] data-[size=sm]:w-[24px] dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 data-checked:bg-primary data-unchecked:bg-input dark:data-unchecked:bg-input/80 data-disabled:cursor-not-allowed data-disabled:opacity-50",
        "[--switch-press:0px] [--switch-thumb:--spacing(3.5)] [--switch-travel:12px] active:not-data-disabled:[--switch-press:3px] data-[size=sm]:[--switch-thumb:--spacing(3)] data-[size=sm]:[--switch-travel:10px] data-[size=sm]:active:not-data-disabled:[--switch-press:2px]",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block h-(--switch-thumb) w-[calc(var(--switch-thumb)+var(--switch-press))] rounded-full bg-background ring-0 transition-[translate,width] duration-200 ease-[linear(0,0.6409,0.9317,0.9892,0.9984,0.9998,1)] motion-reduce:transition-none data-checked:translate-x-[calc(var(--switch-travel)-var(--switch-press))] data-unchecked:translate-x-0 dark:data-checked:bg-primary-foreground dark:data-unchecked:bg-foreground"
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
