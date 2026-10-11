import * as React from "react"
import { Toggle as TogglePrimitive } from "@base-ui/react/toggle"
import { ToggleGroup as ToggleGroupPrimitive } from "@base-ui/react/toggle-group"
import { type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/cn"
import { toggleVariants } from "@/components/ui/toggle"
import { FluidHoverHighlight } from "@/components/ui/fluid-hover-highlight"
import {
  FluidSelectionPill,
  chainHandlers,
  useFluidList,
} from "@/components/ui/fluid-list"

type ToggleVariant = VariantProps<typeof toggleVariants>["variant"]
/**
 * `segmented`: a single-choice control on a borderless track. The pressed segment is a
 * raised pill that slides between segments; a lighter pill follows the pointer.
 */
type ToggleGroupVariant = ToggleVariant | "segmented"

const ToggleGroupContext = React.createContext<
  Omit<VariantProps<typeof toggleVariants>, "variant"> & {
    variant?: ToggleGroupVariant
    spacing?: number
    orientation?: "horizontal" | "vertical"
  }
>({
  size: "default",
  variant: "default",
  spacing: 2,
  orientation: "horizontal",
})

type ToggleGroupProps = ToggleGroupPrimitive.Props &
  Omit<VariantProps<typeof toggleVariants>, "variant"> & {
    variant?: ToggleGroupVariant
    spacing?: number
    orientation?: "horizontal" | "vertical"
    ref?: React.Ref<HTMLDivElement>
  }

function ToggleGroup({
  className,
  variant,
  size,
  spacing = 2,
  orientation = "horizontal",
  children,
  ...props
}: ToggleGroupProps) {
  if (variant === "segmented") {
    return (
      <SegmentedToggleGroup className={className} size={size} {...props}>
        {children}
      </SegmentedToggleGroup>
    )
  }
  return (
    <ToggleGroupPrimitive
      data-slot="toggle-group"
      data-variant={variant}
      data-size={size}
      data-spacing={spacing}
      data-orientation={orientation}
      style={{ "--gap": spacing } as React.CSSProperties}
      className={cn(
        "group/toggle-group flex w-fit flex-row items-center gap-[--spacing(var(--gap))] rounded-md data-[size=sm]:rounded-[min(var(--radius-md),8px)] data-vertical:flex-col data-vertical:items-stretch",
        className
      )}
      {...props}
    >
      <ToggleGroupContext.Provider
        value={{ variant, size, spacing, orientation }}
      >
        {children}
      </ToggleGroupContext.Provider>
    </ToggleGroupPrimitive>
  )
}

const isPressed = (element: HTMLElement) =>
  element.getAttribute("aria-pressed") === "true"

function SegmentedToggleGroup({
  className,
  size,
  children,
  ref,
  ...props
}: Omit<ToggleGroupProps, "variant" | "spacing" | "orientation">) {
  const fluid = useFluidList(ref, {
    itemSelector: '[data-slot="toggle-group-item"]',
    axis: "x",
    isSelected: isPressed,
    followFocus: true,
    reach: 2,
  })
  const { activeIndex, itemRects } = fluid.hover
  const selectedRect =
    fluid.selectedIndex === null ? null : itemRects[fluid.selectedIndex]
  const hoveringOther =
    activeIndex !== null && activeIndex !== fluid.selectedIndex
  return (
    <ToggleGroupPrimitive
      data-slot="toggle-group"
      data-variant="segmented"
      data-size={size}
      data-orientation="horizontal"
      ref={fluid.ref}
      className={cn(
        "group/toggle-group relative isolate flex w-fit shrink-0 flex-row items-center rounded-md bg-muted/60 p-0.5",
        className
      )}
      {...chainHandlers(props, fluid.handlers)}
    >
      <FluidSelectionPill
        rect={selectedRect}
        className="rounded-[min(var(--radius-md),8px)] bg-background shadow-xs dark:bg-input/60"
      />
      <FluidHoverHighlight
        hover={fluid.hover}
        hidden={!hoveringOther}
        from={selectedRect}
        className="rounded-[min(var(--radius-md),8px)] bg-background/50 dark:bg-input/30"
      />
      <ToggleGroupContext.Provider
        value={{ variant: "segmented", size, orientation: "horizontal" }}
      >
        {children}
      </ToggleGroupContext.Provider>
    </ToggleGroupPrimitive>
  )
}

function ToggleGroupItem({
  className,
  children,
  variant = "default",
  size = "default",
  ...props
}: TogglePrimitive.Props & VariantProps<typeof toggleVariants>) {
  const context = React.useContext(ToggleGroupContext)
  const segmented = context.variant === "segmented"
  const resolvedVariant: ToggleVariant = segmented
    ? "default"
    : (context.variant as ToggleVariant) || variant

  return (
    <TogglePrimitive
      data-slot="toggle-group-item"
      data-variant={context.variant || variant}
      data-size={context.size || size}
      data-spacing={context.spacing}
      className={cn(
        "shrink-0 group-data-[spacing=0]/toggle-group:rounded-none group-data-[spacing=0]/toggle-group:px-2 focus:z-10 focus-visible:z-10 group-data-[spacing=0]/toggle-group:has-data-[icon=inline-end]:pr-1.5 group-data-[spacing=0]/toggle-group:has-data-[icon=inline-start]:pl-1.5 group-data-horizontal/toggle-group:data-[spacing=0]:first:rounded-l-md group-data-vertical/toggle-group:data-[spacing=0]:first:rounded-t-md group-data-horizontal/toggle-group:data-[spacing=0]:last:rounded-r-md group-data-vertical/toggle-group:data-[spacing=0]:last:rounded-b-md group-data-horizontal/toggle-group:data-[spacing=0]:data-[variant=outline]:border-l-0 group-data-vertical/toggle-group:data-[spacing=0]:data-[variant=outline]:border-t-0 group-data-horizontal/toggle-group:data-[spacing=0]:data-[variant=outline]:first:border-l group-data-vertical/toggle-group:data-[spacing=0]:data-[variant=outline]:first:border-t",
        toggleVariants({
          variant: resolvedVariant,
          size: context.size || size,
        }),
        // Segments draw no fill of their own; the group's pills sit behind them.
        segmented &&
          "relative text-muted-foreground hover:bg-transparent hover:text-foreground aria-pressed:bg-transparent aria-pressed:text-foreground",
        className
      )}
      {...props}
    >
      {children}
    </TogglePrimitive>
  )
}

export { ToggleGroup, ToggleGroupItem }
