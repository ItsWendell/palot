import { cva } from "class-variance-authority";

export const sidebarItemVariants = cva(
  "px-1.5 py-1 text-sm font-normal text-sidebar-foreground data-active:bg-(--palot-sidebar-selected) data-active:text-sidebar-foreground",
  {
    variants: {
      density: {
        single: "h-7 gap-2",
        rich: "",
      },
      interactive: {
        true: "rounded-md outline-none transition-colors hover:bg-(--palot-sidebar-hover) hover:text-sidebar-foreground/95 active:bg-(--palot-sidebar-selected) data-open:hover:bg-(--palot-sidebar-hover) data-open:hover:text-sidebar-foreground/95 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sidebar-ring",
        false: "",
      },
      icons: {
        primary:
          "[&_[data-icon]]:size-(--theme-ui-icon-size) [&_svg]:size-(--theme-ui-icon-size) [&>svg]:text-sidebar-foreground/90 hover:[&>svg]:text-sidebar-foreground/95",
        custom: "",
      },
    },
    defaultVariants: {
      density: "single",
      interactive: true,
      icons: "primary",
    },
  },
);

export const sidebarSectionLabelVariants = cva(
  "flex h-7 w-full items-center rounded-md px-1.5 py-1 text-xs font-semibold text-sidebar-secondary",
);

export const sidebarSectionTriggerVariants = cva(
  "group/section-label flex h-7 w-full cursor-pointer items-center rounded-md px-1.5 py-1 text-xs font-semibold text-sidebar-secondary outline-none transition-colors hover:text-sidebar-foreground focus-visible:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sidebar-ring",
);

export const sidebarSectionIconVariants = cva(
  "size-(--theme-ui-meta-icon-size)! shrink-0 text-sidebar-foreground/45 transition-colors group-hover/section-label:text-sidebar-foreground/75 group-focus-visible/section-label:text-sidebar-foreground/75",
  {
    // Lucide's 24-unit viewBox has unused space after the chevron path:
    // down ends at x=18, right at x=15. Align the drawing, not that empty space.
    variants: {
      direction: {
        down: "translate-x-1/4",
        right: "translate-x-[37.5%]",
      },
    },
    defaultVariants: { direction: "down" },
  },
);
