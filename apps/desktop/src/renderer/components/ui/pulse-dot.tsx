import type { ComponentProps } from "react";
import { cn } from "../../lib/cn";

function PulseDot({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      data-slot="pulse-dot"
      className={cn("inline-flex size-4 shrink-0 items-center justify-center", className)}
      {...props}
    >
      <span
        className="size-1.5 rounded-full bg-foreground/55 motion-safe:animate-pulse"
        aria-hidden="true"
      />
    </span>
  );
}

export { PulseDot };
