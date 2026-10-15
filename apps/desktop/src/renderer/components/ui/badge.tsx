import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/cn";

const badgeVariants = cva(
  "group/badge inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-full border border-transparent px-2 py-0.5 text-tag font-medium whitespace-nowrap transition-all focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&>svg]:pointer-events-none [&>svg]:size-2.5!",
  {
    variants: {
      variant: {
        default: "bg-primary/85 text-primary-foreground [a]:hover:bg-primary/75",
        secondary:
          "bg-secondary/65 text-secondary-foreground backdrop-blur-sm [a]:hover:bg-secondary/80",
        destructive:
          "bg-destructive/10 text-destructive focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:focus-visible:ring-destructive/40 [a]:hover:bg-destructive/20",
        outline:
          "border-border/80 bg-input/12 text-foreground backdrop-blur-sm dark:bg-input/18 [a]:hover:bg-muted/60 [a]:hover:text-muted-foreground",
        ghost: "hover:bg-muted hover:text-muted-foreground dark:hover:bg-muted/50",
        link: "text-primary underline-offset-4 hover:underline",
        // Status tints: a light wash of the status color; text mixes toward the foreground
        // so small labels keep their contrast on every theme.
        neutral: "bg-muted text-muted-foreground [a]:hover:bg-muted/80",
        info: "bg-info/12 text-[color-mix(in_oklch,var(--info)_72%,var(--foreground))] dark:bg-info/18",
        success:
          "bg-success/12 text-[color-mix(in_oklch,var(--success)_72%,var(--foreground))] dark:bg-success/18",
        warning:
          "bg-warning/14 text-[color-mix(in_oklch,var(--warning)_68%,var(--foreground))] dark:bg-warning/18",
      },
      size: {
        default: "",
        sm: "h-4 gap-0.5 px-1.5 py-0 has-data-[icon=inline-end]:pr-1 has-data-[icon=inline-start]:pl-1 [&>svg]:size-2!",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

/**
 * Short status or metadata label. Status variants (`neutral`, `info`, `success`,
 * `warning`, `destructive`) tint the pill; `outline` stays neutral; `size="sm"` fits
 * dense rows.
 */
function Badge({
  className,
  variant = "default",
  size = "default",
  render,
  ...props
}: useRender.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(
      {
        className: cn(badgeVariants({ variant, size }), className),
      },
      props,
    ),
    render,
    state: {
      slot: "badge",
      variant,
      size,
    },
  });
}

export { Badge, badgeVariants };
