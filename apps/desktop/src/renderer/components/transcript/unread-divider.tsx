import { createContext, useContext, useEffect, useRef } from "react";

export const UnreadContext = createContext<{ rowID: string | null; seen(): void }>({
  rowID: null,
  seen() {},
});

export function NewMessagesDivider() {
  const unread = useContext(UnreadContext);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    // Leave the landing cue visible while reading; clear when the user moves on.
    let seen = false;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) seen = true;
      else if (seen) unread.seen();
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [unread]);
  return (
    <div
      ref={ref}
      data-palot-unread=""
      className="my-4 flex items-center gap-3 text-meta text-info"
    >
      <span className="h-px flex-1 bg-border" />
      New
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}
