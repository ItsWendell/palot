import { useState, type CSSProperties, type ReactNode } from "react";
import { cn } from "../lib/cn";

const SHIMMER_DURATION_MS = 1_600;

export function ThinkingShimmer({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const [animationDelay] = useState(
    () => `-${Math.round(performance.now() % SHIMMER_DURATION_MS)}ms`,
  );

  return (
    <span
      className={cn("palot-thinking-shimmer", className)}
      style={{ animationDelay } satisfies CSSProperties}
    >
      {children}
    </span>
  );
}
