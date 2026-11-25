import { Server } from "lucide-react";
import { cn } from "../lib/cn";

/**
 * Names the OpenCode machine a path or call is on (`devbox`), beside a file name or in a tool
 * row. Machines are linked to the task's server; see Settings → Machines.
 */
export function MachineBadge({ machine, className }: { machine: string; className?: string }) {
  return (
    <span
      data-machine={machine}
      title={`On machine ${machine}`}
      className={cn(
        "inline-flex max-w-[12ch] shrink-0 items-center gap-0.5 rounded-sm bg-muted px-1 align-baseline font-sans text-tag leading-[1.4] font-medium text-muted-foreground",
        className,
      )}
    >
      <Server className="size-[0.9em] shrink-0" aria-hidden="true" />
      <span className="truncate">{machine}</span>
    </span>
  );
}
