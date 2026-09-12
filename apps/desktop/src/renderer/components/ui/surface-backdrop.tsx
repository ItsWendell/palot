import type { ComponentProps } from "react";

import { cn } from "@/lib/cn";

export type SurfaceBackdropTone = "popover" | "command" | "composer" | "inspector";

export function SurfaceBackdropFilters() {
  return (
    <svg
      aria-hidden="true"
      data-slot="surface-backdrop-filters"
      className="pointer-events-none fixed size-0"
      focusable="false"
    >
      <defs>
        <filter
          id="palot-alpha-safe-blur-20"
          x="-100%"
          y="-100%"
          width="300%"
          height="300%"
          colorInterpolationFilters="sRGB"
        >
          <feComponentTransfer in="SourceGraphic" result="opaque-source">
            <feFuncA type="linear" slope={0} intercept={1} />
          </feComponentTransfer>
          <feMorphology
            in="opaque-source"
            operator="dilate"
            radius="0.5"
            result="thickened-source"
          />
          <feGaussianBlur
            in="thickened-source"
            stdDeviation="12"
            edgeMode="duplicate"
            result="blurred-source"
          />
          <feColorMatrix
            in="SourceGraphic"
            type="matrix"
            values="0 0 0 0 0
                    0 0 0 0 0
                    0 0 0 0 0
                    0 0 0 1 0"
            result="source-alpha"
          />
          <feMorphology in="source-alpha" operator="dilate" radius="4" result="expanded-alpha" />
          <feGaussianBlur
            in="expanded-alpha"
            stdDeviation="12"
            edgeMode="duplicate"
            result="blurred-alpha"
          />
          <feComposite
            in="blurred-source"
            in2="blurred-alpha"
            operator="in"
            result="alpha-safe-blur"
          />
          <feComponentTransfer in="alpha-safe-blur">
            <feFuncA type="linear" slope={1.8} />
          </feComponentTransfer>
        </filter>
      </defs>
    </svg>
  );
}

export function SurfaceBackdrop({
  className,
  tone = "popover",
  ...props
}: ComponentProps<"div"> & { tone?: SurfaceBackdropTone }) {
  return (
    <div
      aria-hidden="true"
      data-slot="surface-backdrop"
      data-tone={tone}
      className={cn("palot-surface-backdrop", className)}
      {...props}
    />
  );
}
