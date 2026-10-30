import { useLayoutEffect, useRef, useState } from "react";
import { cn } from "../lib/cn";
import { fitPath } from "../lib/fit-path";

let measureContext: CanvasRenderingContext2D | null | undefined;

/**
 * A path that shortens in the middle to fit its width, keeping its start and its last two folders
 * ("/Users/me/…/team/project"). The full path stays in the tooltip. CSS truncation at the end is the
 * fallback when text can't be measured.
 */
export function FittedPath({ path, className }: { path: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [text, setText] = useState(path);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const fit = () => {
      measureContext ??= document.createElement("canvas").getContext("2d");
      const width = element.clientWidth;
      if (!measureContext || width === 0) return setText(path);
      measureContext.font = getComputedStyle(element).font;
      const context = measureContext;
      setText(fitPath(path, (candidate) => context.measureText(candidate).width <= width));
    };
    fit();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(fit);
    observer.observe(element);
    return () => observer.disconnect();
  }, [path]);
  return (
    <span ref={ref} className={cn("min-w-0 truncate", className)} title={path}>
      {text}
    </span>
  );
}
