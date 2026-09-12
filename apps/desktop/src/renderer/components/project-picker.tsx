import { Check } from "lucide-react";
import type { PalotProject } from "../../shared";
import { projectLocation, projectName } from "../lib/view-models";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "./ui/command";

export function ProjectPickerContent({
  projects,
  value,
  onValueChange,
  allLabel,
}: {
  projects: PalotProject[];
  value: string | null;
  onValueChange(value: string | null): void;
  allLabel?: string;
}) {
  return (
    <Command className="bg-transparent p-0">
      <CommandInput placeholder="Search projects…" aria-label="Search projects" autoFocus />
      <CommandList className="max-h-72">
        <CommandEmpty>No projects found</CommandEmpty>
        <CommandGroup>
          {allLabel ? (
            <CommandItem
              value="all projects"
              className="[&>svg:last-child]:hidden"
              data-checked={value === null || undefined}
              onSelect={() => onValueChange(null)}
            >
              <ProjectPickerCheckbox checked={value === null} />
              <span className="min-w-0 flex-1 truncate">{allLabel}</span>
            </CommandItem>
          ) : null}
          {projects.map((project) => (
            <CommandItem
              key={project.id}
              value={`${projectName(project)} ${projectLocation(project)} ${project.id}`}
              className="[&>svg:last-child]:hidden"
              data-checked={value === project.id || undefined}
              onSelect={() => onValueChange(project.id)}
            >
              <ProjectPickerCheckbox checked={value === project.id} />
              <span className="min-w-0 max-w-[55%] shrink truncate">{projectName(project)}</span>
              <span
                dir="rtl"
                className="min-w-0 flex-1 truncate text-left text-meta text-muted-foreground"
                title={projectLocation(project)}
              >
                {projectLocation(project)}
              </span>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </Command>
  );
}

function ProjectPickerCheckbox({ checked }: { checked: boolean }) {
  return (
    <span
      className="flex size-3.5 shrink-0 items-center justify-center rounded-[3px] border border-input text-primary-foreground opacity-0 transition-opacity group-hover/command-item:opacity-100 group-data-[selected=true]/command-item:opacity-100 group-data-[checked=true]/command-item:border-primary group-data-[checked=true]/command-item:bg-primary group-data-[checked=true]/command-item:opacity-100"
      aria-hidden="true"
    >
      {checked ? <Check className="size-3" /> : null}
    </span>
  );
}
