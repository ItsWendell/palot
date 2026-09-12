import { type ComponentProps, useCallback, useEffect, useRef, useState } from "react";
import { cn } from "../../lib/cn";

export function ScrollFadeArea({
  className,
  containerClassName,
  children,
  ...props
}: ComponentProps<"div"> & { containerClassName?: string }) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ top: false, bottom: false });
  const updateEdges = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const remaining = viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop;
    setEdges({ top: viewport.scrollTop > 1, bottom: remaining > 1 });
  }, []);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    updateEdges();
    const observer = new ResizeObserver(updateEdges);
    observer.observe(viewport);
    if (viewport.firstElementChild) observer.observe(viewport.firstElementChild);
    return () => observer.disconnect();
  }, [children, updateEdges]);

  return (
    <div className={cn("relative min-h-0", containerClassName)}>
      <div
        ref={viewportRef}
        className={cn("size-full overflow-auto", className)}
        onScroll={updateEdges}
        {...props}
      >
        {children}
      </div>
      <span
        className="palot-scroll-fade palot-scroll-fade-top"
        data-visible={edges.top}
        aria-hidden="true"
      />
      <span
        className="palot-scroll-fade palot-scroll-fade-bottom"
        data-visible={edges.bottom}
        aria-hidden="true"
      />
    </div>
  );
}
