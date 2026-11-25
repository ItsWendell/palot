/** A ticking clock shared by the turn bar and other live transcript rows. */

import { useEffect, useState } from "react";

export function useCurrentTime(active = true): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!active) return;
    const interval = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, [active]);

  return now;
}
