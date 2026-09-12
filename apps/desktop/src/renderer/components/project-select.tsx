import { ChevronDown, FolderGit2 } from "lucide-react";
import { useState } from "react";
import type { PalotProject } from "../../shared";
import { cn } from "../lib/cn";
import { projectName } from "../lib/view-models";
import { ProjectPickerContent } from "./project-picker";
import { buttonVariants } from "./ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { sidebarItemVariants } from "./ui/sidebar-styles";

export function ProjectSelect({
  projects,
  value,
  onValueChange,
  ariaLabel,
  allLabel,
  align = "start",
  variant = "compact",
  className,
}: {
  projects: PalotProject[];
  value: string | null;
  onValueChange(value: string | null): void;
  ariaLabel: string;
  allLabel?: string;
  align?: "start" | "center" | "end";
  variant?: "compact" | "context" | "heading" | "sidebar" | "settings";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = projects.find((project) => project.id === value);
  const label = selected ? projectName(selected) : (allLabel ?? "Select project");

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            role="combobox"
            aria-label={ariaLabel}
            aria-expanded={open}
            className={cn(
              "inline-flex items-center justify-between gap-1.5 rounded-md outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/30 disabled:pointer-events-none disabled:opacity-50",
              variant === "compact" && "h-7 max-w-48 bg-transparent px-2 text-sm font-medium",
              variant === "context" &&
                cn(buttonVariants({ variant: "ghost", size: "context" }), "max-w-48"),
              variant === "heading" &&
                "h-auto max-w-[min(24rem,70vw)] px-1.5 py-0.5 text-hero/tight font-normal tracking-[-0.035em] underline decoration-foreground/35 decoration-1 underline-offset-[7px] hover:bg-muted/45 max-[720px]:text-2xl",
              variant === "sidebar" && cn(sidebarItemVariants(), "w-full bg-transparent"),
              variant === "settings" && "h-7 w-44 bg-background/70 px-2 text-sm",
              className,
            )}
          />
        }
      >
        {variant !== "heading" ? (
          <FolderGit2
            className={cn(variant !== "context" && "size-3.5", "shrink-0 text-muted-foreground")}
            aria-hidden="true"
          />
        ) : null}
        <span className="min-w-0 flex-1 truncate text-left">{label}</span>
        <ChevronDown
          className={cn(variant !== "context" && "size-3.5", "shrink-0 text-muted-foreground")}
          aria-hidden="true"
        />
      </PopoverTrigger>
      <PopoverContent align={align} className="w-80 gap-0 p-1">
        <ProjectPickerContent
          projects={projects}
          value={value}
          allLabel={allLabel}
          onValueChange={(next) => {
            onValueChange(next);
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
