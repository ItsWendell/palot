import { ChevronRight } from "lucide-react";
import { useState } from "react";
import type { PalotProject } from "../../../shared";
import { useSessionStats, type SessionStatsQueryInput } from "../../hooks/use-session-stats";
import { cacheHitRate } from "../../lib/usage-analytics";
import { projectName } from "../../lib/view-models";
import { Button } from "../ui/button";
import { Skeleton } from "../ui/skeleton";
import { CURRENCY, NUMBER, formatModelTokens, formatRate } from "./usage-format";

const INITIAL_PROJECTS = 8;

/**
 * Per-project usage. OpenCode's stats have no group-by, so each project is one more
 * `session.stats` call; it runs only when that project is expanded, and stays cached per range.
 */
export function UsageProjectsSection({
  projects,
  range,
  onSelectProject,
}: {
  projects: readonly PalotProject[];
  range: { from: number; to: number; timezone: string };
  onSelectProject(projectID: string): void;
}) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [showAll, setShowAll] = useState(false);
  if (!projects.length) return null;
  const shown = showAll ? projects : projects.slice(0, INITIAL_PROJECTS);
  return (
    <section className="min-w-0 rounded-xl border border-border/75 p-5" aria-label="Projects">
      <div className="mb-3 grid gap-0.5">
        <h2 className="text-sm font-medium">Projects</h2>
        <p className="text-xs text-muted-foreground">Open a project to load its usage</p>
      </div>
      <ul className="flex flex-col">
        {shown.map((project) => {
          const open = expanded.has(project.id);
          return (
            <li key={project.id} className="min-w-0 border-t border-border/60 first:border-t-0">
              <button
                type="button"
                aria-expanded={open}
                aria-controls={`usage-project-${project.id}`}
                className="flex w-full min-w-0 items-center gap-2 rounded-md px-1 py-2 text-left text-sm outline-none transition-colors hover:bg-muted/45 focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() =>
                  setExpanded((current) => {
                    const next = new Set(current);
                    if (open) next.delete(project.id);
                    else next.add(project.id);
                    return next;
                  })
                }
              >
                <ChevronRight
                  aria-hidden="true"
                  className={`size-3.5 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`}
                />
                <span className="min-w-0 truncate font-medium">{projectName(project)}</span>
                <span className="min-w-0 flex-1 truncate text-meta text-muted-foreground">
                  {project.canonical}
                </span>
              </button>
              {open ? (
                <div id={`usage-project-${project.id}`} className="pb-3 pl-6">
                  <ProjectUsage
                    projectID={project.id}
                    range={range}
                    onSelect={() => onSelectProject(project.id)}
                  />
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
      {projects.length > INITIAL_PROJECTS ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="mt-2"
          onClick={() => setShowAll((value) => !value)}
        >
          {showAll ? "Show fewer" : `Show all ${NUMBER.format(projects.length)} projects`}
        </Button>
      ) : null}
    </section>
  );
}

function ProjectUsage({
  projectID,
  range,
  onSelect,
}: {
  projectID: string;
  range: { from: number; to: number; timezone: string };
  onSelect(): void;
}) {
  const input: SessionStatsQueryInput = {
    from: range.from,
    to: range.to,
    timezone: range.timezone,
    tools: "none",
    project: projectID,
  };
  const stats = useSessionStats(input);
  if (!stats.data) {
    if (stats.error)
      return (
        <div className="flex flex-wrap items-center gap-3 text-sm text-destructive">
          <span>Could not load this project.</span>
          <Button type="button" variant="outline" size="sm" onClick={() => void stats.refetch()}>
            Retry
          </Button>
        </div>
      );
    return <Skeleton className="h-14 w-full" />;
  }
  const data = stats.data;
  const topModels = data.models.toSorted((left, right) => right.cost - left.cost).slice(0, 3);
  return (
    <div className="grid gap-3" aria-busy={stats.isFetching}>
      <dl className="grid grid-cols-2 gap-x-5 gap-y-2 @min-[34rem]/usage:grid-cols-5">
        <ProjectValue label="Cost" value={CURRENCY.format(data.cost)} />
        <ProjectValue label="Model tokens" value={formatModelTokens(data.tokens)} />
        <ProjectValue label="Cache hit rate" value={formatRate(cacheHitRate(data.tokens))} />
        <ProjectValue label="Sessions" value={NUMBER.format(data.sessions)} />
        <ProjectValue label="Prompts" value={NUMBER.format(data.prompts)} />
      </dl>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="min-w-0 truncate text-meta text-muted-foreground">
          {topModels.length
            ? topModels
                .map((usage) => `${usage.model.id} ${CURRENCY.format(usage.cost)}`)
                .join(" · ")
            : "No model usage in this range."}
        </p>
        <Button type="button" variant="ghost" size="sm" onClick={onSelect}>
          Show only this project
        </Button>
      </div>
    </div>
  );
}

function ProjectValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col-reverse">
      <dt className="truncate text-meta text-muted-foreground">{label}</dt>
      <dd className="text-base font-medium tracking-tight tabular-nums">{value}</dd>
    </div>
  );
}
