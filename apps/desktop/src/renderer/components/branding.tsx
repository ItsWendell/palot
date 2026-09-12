import type { ReactNode } from "react";
import { palotBuild } from "../lib/build";
import { PalotBeacon } from "./palot-beacon";
import { Badge } from "./ui/badge";

export { PalotMark } from "./palot-mark";

export function BuildBadge() {
  if (!palotBuild.label) return null;
  return (
    <Badge variant="secondary" title={`Palot ${palotBuild.version} ${palotBuild.channel}`}>
      {palotBuild.label}
    </Badge>
  );
}

export function PalotLoading({ children }: { children: ReactNode }) {
  return (
    <main
      className="flex size-full flex-col items-center justify-center gap-5 text-center"
      aria-label="Loading Palot"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <PalotBeacon className="size-16" />
      <div className="space-y-1.5">
        <p className="text-base font-semibold text-foreground">Palot</p>
        <p className="text-compact text-muted-foreground">{children}</p>
      </div>
    </main>
  );
}
