import { MotionConfig } from "motion/react";
import type { ReactNode } from "react";
import { useReducedMotion } from "../hooks/use-reduced-motion";

/**
 * App-wide motion defaults. Motion follows the OS preference on its own; Palot's native
 * accessibility signal (`data-reduced-motion`) can disagree on Linux, so it forces the
 * reduced mode too. Reduced mode drops transform and layout animation and keeps fades.
 */
export function MotionPreferences({ children }: { children: ReactNode }) {
  const reduceMotion = useReducedMotion();
  return <MotionConfig reducedMotion={reduceMotion ? "always" : "user"}>{children}</MotionConfig>;
}
