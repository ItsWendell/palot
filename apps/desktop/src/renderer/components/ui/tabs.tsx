"use client";

import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "@/lib/cn";
import { FluidHoverHighlight } from "@/components/ui/fluid-hover-highlight";
import {
  FluidSelectionPill,
  chainHandlers,
  useFluidList,
} from "@/components/ui/fluid-list";

function Tabs({ className, orientation = "horizontal", ...props }: TabsPrimitive.Root.Props) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      data-orientation={orientation}
      className={cn("group/tabs flex gap-2 data-horizontal:flex-col", className)}
      {...props}
    />
  );
}

const tabsListVariants = cva(
  "group/tabs-list inline-flex w-fit items-center justify-center rounded-lg p-[3px] text-muted-foreground group-data-horizontal/tabs:h-8 group-data-vertical/tabs:h-fit group-data-vertical/tabs:flex-col data-[variant=line]:rounded-none",
  {
    variants: {
      variant: {
        default: "bg-muted",
        line: "gap-1 bg-transparent",
        // Fluid Functionalism TabsSubtle (horizontal): no track, a sliding pill under the
        // active tab and a lighter pill that follows the pointer.
        subtle: "relative isolate gap-0.5 bg-transparent",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

type TabsListProps = TabsPrimitive.List.Props &
  VariantProps<typeof tabsListVariants> & { ref?: React.Ref<HTMLDivElement> };

function TabsList({ className, variant = "default", ...props }: TabsListProps) {
  if (variant === "subtle") return <SubtleTabsList className={className} {...props} />;
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-variant={variant}
      className={cn(tabsListVariants({ variant }), className)}
      {...props}
    />
  );
}

const isSelectedTab = (element: HTMLElement) => element.getAttribute("aria-selected") === "true";

function SubtleTabsList({
  className,
  children,
  ref,
  ...props
}: Omit<TabsListProps, "variant">) {
  const fluid = useFluidList(ref, {
    itemSelector: '[role="tab"]',
    axis: "x",
    isSelected: isSelectedTab,
    followFocus: true,
    reach: 4,
  });
  const { activeIndex, itemRects } = fluid.hover;
  const selectedRect = fluid.selectedIndex === null ? null : itemRects[fluid.selectedIndex];
  const hoveringOther = activeIndex !== null && activeIndex !== fluid.selectedIndex;
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-variant="subtle"
      ref={fluid.ref}
      className={cn(tabsListVariants({ variant: "subtle" }), className)}
      {...chainHandlers(props, fluid.handlers)}
    >
      <FluidSelectionPill rect={selectedRect} dimmed={hoveringOther} className="bg-muted" />
      <FluidHoverHighlight
        hover={fluid.hover}
        hidden={!hoveringOther}
        from={selectedRect}
        className="bg-muted/50"
      />
      {children}
    </TabsPrimitive.List>
  );
}

function TabsTrigger({ className, ...props }: TabsPrimitive.Tab.Props) {
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-trigger"
      className={cn(
        "relative inline-flex h-[calc(100%-1px)] flex-1 items-center justify-center gap-1.5 rounded-md border border-transparent px-1.5 py-0.5 text-sm font-medium whitespace-nowrap text-foreground/75 transition-all group-data-vertical/tabs:w-full group-data-vertical/tabs:justify-start group-data-vertical/tabs:py-[calc(--spacing(1.25))] hover:text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 has-data-[icon=inline-end]:pr-1 has-data-[icon=inline-start]:pl-1 aria-disabled:pointer-events-none aria-disabled:opacity-50 dark:text-muted-foreground dark:hover:text-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
        "group-data-[variant=line]/tabs-list:bg-transparent group-data-[variant=line]/tabs-list:data-active:bg-transparent dark:group-data-[variant=line]/tabs-list:data-active:border-transparent dark:group-data-[variant=line]/tabs-list:data-active:bg-transparent",
        // Subtle tabs draw no fill of their own; the list's pills sit behind them.
        "group-data-[variant=subtle]/tabs-list:text-muted-foreground group-data-[variant=subtle]/tabs-list:data-active:border-transparent group-data-[variant=subtle]/tabs-list:data-active:bg-transparent group-data-[variant=subtle]/tabs-list:data-active:text-foreground dark:group-data-[variant=subtle]/tabs-list:data-active:border-transparent dark:group-data-[variant=subtle]/tabs-list:data-active:bg-transparent",
        "data-active:bg-background data-active:text-foreground dark:data-active:border-input dark:data-active:bg-input/30 dark:data-active:text-foreground",
        "after:absolute after:bg-foreground after:opacity-0 after:transition-opacity group-data-horizontal/tabs:after:inset-x-0 group-data-horizontal/tabs:after:bottom-[-5px] group-data-horizontal/tabs:after:h-0.5 group-data-vertical/tabs:after:inset-y-0 group-data-vertical/tabs:after:-right-1 group-data-vertical/tabs:after:w-0.5 group-data-[variant=line]/tabs-list:data-active:after:opacity-100",
        className,
      )}
      {...props}
    />
  );
}

function TabsContent({ className, ...props }: TabsPrimitive.Panel.Props) {
  return (
    <TabsPrimitive.Panel
      data-slot="tabs-content"
      className={cn("flex-1 text-sm/relaxed outline-none", className)}
      {...props}
    />
  );
}

export { Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants };
