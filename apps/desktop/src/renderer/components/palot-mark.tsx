import type { ComponentProps } from "react";
import { cn } from "../lib/cn";

/** The approved Beacon B1 geometry. Motion wrappers leave the resting artwork unchanged. */
export function PalotMark({ className, ...props }: ComponentProps<"svg">) {
  return (
    <svg
      viewBox="0 0 64 64"
      className={cn("size-5 shrink-0 text-foreground", className)}
      fill="none"
      aria-hidden="true"
      {...props}
    >
      <g className="palot-beacon-lean" data-beacon-lean>
        <g className="palot-beacon-loop">
          <path
            d="M17 53V29C17 17 26 9 38 9C50 9 56 17 56 28C56 39 49 45 38 45H35.5"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="10"
          />
        </g>
      </g>
      <g className="palot-beacon-tracking" data-beacon-tracking>
        <g className="palot-beacon-gaze">
          <circle className="palot-beacon-core" cx="36.5" cy="28" r="5.25" fill="currentColor" />
        </g>
      </g>
    </svg>
  );
}
