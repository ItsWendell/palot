import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/cn";

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-md border border-transparent bg-clip-padding text-sm/relaxed font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_[data-icon]]:pointer-events-none [&_[data-icon]]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_[data-icon]:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/80",
        outline:
          "border-border hover:bg-(--control-hover) hover:text-foreground active:bg-(--control-pressed) aria-expanded:bg-(--control-selected-inactive) aria-expanded:text-foreground dark:bg-input/30",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-(--control-hover) active:bg-(--control-pressed) aria-expanded:bg-(--control-selected-inactive) aria-expanded:text-secondary-foreground",
        ghost:
          "hover:bg-(--control-hover) hover:text-foreground active:bg-(--control-pressed) aria-expanded:bg-(--control-selected-inactive) aria-expanded:text-foreground",
        destructive:
          "bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:hover:bg-destructive/30 dark:focus-visible:ring-destructive/40",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default:
          "h-7 gap-1 px-2 text-sm/relaxed has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5 [&_[data-icon]:not([class*='size-'])]:size-3.5",
        xs: "h-5 gap-1 rounded-sm px-2 text-micro! has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-2.5 [&_[data-icon]:not([class*='size-'])]:size-2.5",
        sm: "h-6 gap-1 px-2 text-sm/relaxed has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3 [&_[data-icon]:not([class*='size-'])]:size-3",
        context:
          "h-6 gap-1 px-1.5 text-meta leading-none [&_svg:not([class*='size-'])]:size-3 [&_[data-icon]:not([class*='size-'])]:size-3",
        lg: "h-8 gap-1 px-2.5 text-sm/relaxed has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 [&_svg:not([class*='size-'])]:size-4 [&_[data-icon]:not([class*='size-'])]:size-4",
        icon: "size-7 [&_svg:not([class*='size-'])]:size-3.5 [&_[data-icon]:not([class*='size-'])]:size-3.5",
        "icon-xs":
          "size-5 rounded-sm [&_svg:not([class*='size-'])]:size-2.5 [&_[data-icon]:not([class*='size-'])]:size-2.5",
        "icon-sm":
          "size-6 [&_svg:not([class*='size-'])]:size-3 [&_[data-icon]:not([class*='size-'])]:size-3",
        "icon-lg":
          "size-8 [&_svg:not([class*='size-'])]:size-4 [&_[data-icon]:not([class*='size-'])]:size-4",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      data-size={size}
      data-variant={variant}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
