import { useNavigate, useSearch } from "@tanstack/react-router";
import {
  BellRing,
  CalendarClock,
  Check,
  Circle,
  CircleAlert,
  ExternalLink,
  LoaderCircle,
  MoreHorizontal,
  Pause,
  Play,
  Plus,
  Search,
} from "lucide-react";
import { Fragment, useEffect, useMemo, useState } from "react";
import { useAtomValue, useStore } from "jotai";
import type { AutomationDraft, AutomationRecord, AutomationRun } from "../../../shared";
import { runtimeAtom } from "../../atoms/workspace";
import { useAutomations } from "../../hooks/use-automations";
import { usePalotNavigation } from "../../hooks/use-navigation";
import { useProjectCatalog, useSessionCatalog } from "../../hooks/use-session-catalog";
import {
  automationScheduleLabel,
  automationRunActionLabel,
  automationRunOpenTarget,
  automationRunStateLabel,
  latestAutomationRun,
  nextRunLabel,
  runIsActive,
  runNeedsReview,
  runTimestamp,
} from "../../lib/automation-view";
import { orderProjects, visibleProjects } from "../../lib/view-models";
import { Button } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "../ui/empty";
import { Input } from "../ui/input";
import { Spinner } from "../ui/spinner";
import { AutomationEditor } from "./automation-editor";

type Filter = "all" | "active" | "paused";

const EMPTY_AUTOMATIONS: AutomationRecord[] = [];
const EMPTY_AUTOMATION_RUNS: AutomationRun[] = [];

const SUGGESTIONS: Array<{
  name: string;
  description: string;
  schedule: "daily" | "weekdays" | "weekly";
  prompt: string;
  icon: typeof BellRing;
  color: string;
}> = [
  {
    name: "Daily brief",
    description: "Summarize current project activity, changes, and priorities.",
    schedule: "weekdays",
    prompt:
      "Review the current project state and recent activity. Produce a concise daily brief with completed work, open risks, and the three most important next actions.",
    icon: BellRing,
    color: "text-blue-500",
  },
  {
    name: "Weekly review",
    description: "Turn the week’s work into a clear status update.",
    schedule: "weekly",
    prompt:
      "Review the project work from the last week. Summarize shipped changes, unresolved issues, risks, and recommended priorities for next week.",
    icon: CalendarClock,
    color: "text-violet-500",
  },
  {
    name: "Regression monitor",
    description: "Run focused checks and flag anything that needs attention.",
    schedule: "daily",
    prompt:
      "Inspect the current project for recent regressions. Run the narrowest meaningful validation, investigate failures, and report only actionable findings with evidence.",
    icon: CircleAlert,
    color: "text-emerald-500",
  },
];

export function ScheduledPage() {
  const profileID = useAtomValue(runtimeAtom)?.profileID;
  return <ScheduledProfilePage key={profileID} />;
}

function ScheduledProfilePage() {
  const store = useStore();
  const search = useSearch({ from: "/_workspace/scheduled" });
  const navigate = useNavigate();
  const { openSession } = usePalotNavigation();
  const projects = useProjectCatalog();
  const sessions = useSessionCatalog();
  const { snapshot, loading, error, dispatch, refresh } = useAutomations(false);
  const runtime = useAtomValue(runtimeAtom);
  const schedulingAvailable = runtime?.capabilities?.scheduledAutomations !== false;
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [suggestedDraft, setSuggestedDraft] = useState<AutomationDraft | null>(null);
  const [createEditorVersion, setCreateEditorVersion] = useState(0);
  const taskProjects = useMemo(
    () => visibleProjects(orderProjects(projects, sessions)),
    [projects, sessions],
  );
  const automations = snapshot?.automations ?? EMPTY_AUTOMATIONS;
  const runs = snapshot?.runs ?? EMPTY_AUTOMATION_RUNS;
  const selectedRun = search.runID ? (runs.find((run) => run.id === search.runID) ?? null) : null;
  const selectedAutomationID = search.automationID ?? selectedRun?.automationID;
  const selectedAutomation = selectedAutomationID
    ? (automations.find((automation) => automation.id === selectedAutomationID) ?? null)
    : null;
  const detailOpen = search.mode === "create" || selectedAutomation !== null;
  const draftProject = taskProjects[0] ?? null;
  const draftSessionID = search.sessionID ?? null;
  const selectedRuns = selectedAutomation
    ? runs.filter((run) => run.automationID === selectedAutomation.id && run.archivedAt === null)
    : [];
  const automationIDs = useMemo(
    () => new Set(automations.map((automation) => automation.id)),
    [automations],
  );
  const orphanedRuns = runs.filter(
    (run) => !automationIDs.has(run.automationID) && run.archivedAt === null,
  );
  const runsByAutomation = useMemo(() => {
    const values = new Map<string, AutomationRun[]>();
    for (const run of runs) {
      const current = values.get(run.automationID) ?? [];
      current.push(run);
      values.set(run.automationID, current);
    }
    return values;
  }, [runs]);
  const unreadByAutomation = useMemo(() => {
    const counts = new Map<string, number>();
    for (const run of runs) {
      if (
        run.readAt !== null ||
        run.archivedAt !== null ||
        !["succeeded", "failed", "interrupted", "unknown", "needs-attention"].includes(run.state)
      ) {
        continue;
      }
      counts.set(run.automationID, (counts.get(run.automationID) ?? 0) + 1);
    }
    return counts;
  }, [runs]);
  const orderedAutomations = useMemo(
    () =>
      automations
        .filter((automation) => filter === "all" || automation.status === filter)
        .filter((automation) => {
          const value = query.trim().toLowerCase();
          if (!value) return true;
          return `${automation.name}\n${automation.action.prompt}\n${automationScheduleLabel(automation.trigger)}`
            .toLowerCase()
            .includes(value);
        })
        .toSorted((left, right) => {
          const section = automationSection(runsByAutomation.get(left.id) ?? []);
          const otherSection = automationSection(runsByAutomation.get(right.id) ?? []);
          const priority = sectionPriority(section) - sectionPriority(otherSection);
          if (priority) return priority;
          const unread =
            (unreadByAutomation.get(right.id) ?? 0) - (unreadByAutomation.get(left.id) ?? 0);
          if (unread) return unread;
          if (left.status !== right.status) return left.status === "active" ? -1 : 1;
          return (
            (left.nextRunAt ?? Number.MAX_SAFE_INTEGER) -
            (right.nextRunAt ?? Number.MAX_SAFE_INTEGER)
          );
        }),
    [automations, filter, query, runsByAutomation, unreadByAutomation],
  );
  const draft = useMemo(
    () =>
      suggestedDraft ??
      (selectedAutomation
        ? automationDraft(selectedAutomation)
        : defaultDraft(draftProject, draftSessionID)),
    [draftProject, draftSessionID, selectedAutomation, suggestedDraft],
  );

  useEffect(() => {
    if (selectedRun?.readAt === null) {
      void dispatch({ type: "mark-read", runID: selectedRun.id });
    }
  }, [dispatch, selectedRun?.id, selectedRun?.readAt]);

  function closeDetail() {
    if (store.get(runtimeAtom)?.profileID !== runtime?.profileID) return;
    setSuggestedDraft(null);
    void navigate({ to: "/scheduled", search: { profileID: runtime?.profileID }, replace: true });
  }

  function createTask(initial?: AutomationDraft) {
    setSuggestedDraft(initial ?? null);
    setCreateEditorVersion((current) => current + 1);
    void navigate({ to: "/scheduled", search: { mode: "create", profileID: runtime?.profileID } });
  }

  async function save(draftValue: AutomationDraft) {
    setSaving(true);
    try {
      if (selectedAutomation) {
        await dispatch({ type: "update", automationID: selectedAutomation.id, draft: draftValue });
        return;
      }
      const before = new Set(automations.map((automation) => automation.id));
      const value = await dispatch({ type: "create", draft: draftValue });
      const created = value.automations.find((automation) => !before.has(automation.id));
      if (store.get(runtimeAtom)?.profileID !== value.profileID) return;
      setSuggestedDraft(null);
      void navigate({
        to: "/scheduled",
        search: { profileID: value.profileID, ...(created ? { automationID: created.id } : {}) },
        replace: true,
      });
    } finally {
      setSaving(false);
    }
  }

  async function automationAction(
    automation: AutomationRecord,
    type: "run-now" | "pause" | "resume" | "delete",
  ) {
    if (type === "run-now" && automation.activeRunID) {
      const activeRun = (runsByAutomation.get(automation.id) ?? []).find(
        (run) => run.id === automation.activeRunID,
      );
      if (activeRun) runAction(activeRun, "open");
      return;
    }
    if (
      type === "delete" &&
      !window.confirm(
        `Delete “${automation.name}”? Previous OpenCode sessions will remain${
          automation.activeRunID ? ", and the current run will continue" : ""
        }.`,
      )
    ) {
      return;
    }
    await dispatch({ type, automationID: automation.id });
    if (type === "delete" && selectedAutomation?.id === automation.id) closeDetail();
  }

  async function action(type: "run-now" | "pause" | "resume" | "delete") {
    if (!selectedAutomation) return;
    await automationAction(selectedAutomation, type);
  }

  function runAction(run: AutomationRun, type: "open" | "cancel" | "read" | "archive") {
    if (type === "open") {
      if (run.readAt === null) void dispatch({ type: "mark-read", runID: run.id });
      const target = automationRunOpenTarget(run);
      if (target.type === "request") {
        void openSession(target.sessionID, {
          profileID: run.profileID,
          focus: "request",
          requestID: target.requestID,
          requestType: target.requestType,
        });
        return;
      }
      if (target.type === "session") {
        void openSession(target.sessionID, { profileID: run.profileID });
        return;
      }
      void navigate({
        to: "/scheduled",
        search: { automationID: run.automationID, runID: run.id, profileID: run.profileID },
        replace: true,
      });
      return;
    }
    if (type === "cancel") void dispatch({ type: "cancel-run", runID: run.id });
    if (type === "read") {
      void dispatch({ type: run.readAt === null ? "mark-read" : "mark-unread", runID: run.id });
    }
    if (type === "archive") {
      void dispatch({
        type: run.archivedAt === null ? "archive-run" : "unarchive-run",
        runID: run.id,
      });
    }
  }

  return (
    <main
      className="palot-main-surface relative grid size-full min-h-0 min-w-0 overflow-hidden bg-background data-[detail=true]:grid-cols-[minmax(420px,1fr)_minmax(440px,560px)] max-[1320px]:data-[detail=true]:grid-cols-1"
      data-detail={detailOpen}
      aria-label="Scheduled tasks"
    >
      <section
        className="flex min-h-0 min-w-0 flex-col overflow-hidden max-[1320px]:data-[detail=true]:hidden"
        data-detail={detailOpen}
      >
        <div className="window-drag h-(--shell-header-height) shrink-0" aria-hidden="true" />
        <div className="palot-native-scrollbar min-h-0 flex-1 overflow-y-auto px-6 pb-16 max-[720px]:px-3">
          <div className="mx-auto w-full max-w-3xl pt-5">
            <header className="mb-5 flex items-start gap-4 px-2 max-[560px]:flex-col">
              <div className="min-w-0 flex-1">
                <h1 className="text-page-title/tight font-medium tracking-[-0.035em]">
                  Scheduled tasks
                </h1>
                <p className="mt-1 text-sm text-muted-foreground">
                  Run OpenCode tasks on a schedule, even when no Palot window is open.
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                disabled={!schedulingAvailable}
                onClick={() => createTask()}
                className="max-[560px]:self-start"
              >
                <Plus aria-hidden="true" /> Create
              </Button>
            </header>

            {!schedulingAvailable ? (
              <div className="mb-5 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-foreground">
                Scheduled tasks are paused for this remote OpenCode server. Existing definitions and
                due times are preserved.
              </div>
            ) : null}

            <div className="relative mb-5">
              <Search
                className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search scheduled tasks"
                className="h-9 rounded-full bg-muted/55 pl-9"
              />
            </div>

            <div className="mb-4 flex items-center gap-1">
              {(["all", "active", "paused"] as const).map((value) => (
                <Button
                  key={value}
                  type="button"
                  variant={filter === value ? "secondary" : "ghost"}
                  aria-pressed={filter === value}
                  size="sm"
                  className="h-7 rounded-full px-3 capitalize"
                  onClick={() => setFilter(value)}
                >
                  {value}
                </Button>
              ))}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="ml-auto text-muted-foreground"
                onClick={() => void dispatch({ type: "mark-all-read" })}
              >
                <Check aria-hidden="true" /> Mark all as read
              </Button>
            </div>

            {loading && !snapshot ? (
              <div className="flex items-center justify-center py-20 text-muted-foreground">
                <Spinner />
              </div>
            ) : error ? (
              <Empty className="py-20">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <CircleAlert />
                  </EmptyMedia>
                  <EmptyTitle>Scheduled tasks did not load</EmptyTitle>
                  <EmptyDescription>{error}</EmptyDescription>
                </EmptyHeader>
                <Button type="button" variant="outline" onClick={() => void refresh()}>
                  Try again
                </Button>
              </Empty>
            ) : (
              <div className="space-y-1">
                {orderedAutomations.map((automation, index) => {
                  const automationRuns = runsByAutomation.get(automation.id) ?? [];
                  const currentRun = automationRuns.find(runIsActive);
                  const latestRun = latestAutomationRun(automationRuns);
                  const attention = automationRuns.some(runNeedsReview);
                  const unread = unreadByAutomation.get(automation.id) ?? 0;
                  const section = automationSection(automationRuns);
                  const previousAutomation =
                    index > 0 ? orderedAutomations.at(index - 1) : undefined;
                  const previousSection = previousAutomation
                    ? automationSection(runsByAutomation.get(previousAutomation.id) ?? [])
                    : null;
                  return (
                    <Fragment key={automation.id}>
                      {section !== previousSection ? (
                        <h2 className="px-3 pt-3 pb-1 text-meta font-medium uppercase tracking-wide text-muted-foreground">
                          {section}
                        </h2>
                      ) : null}
                      <div className="group flex items-start rounded-xl transition-colors hover:bg-muted/55 focus-within:bg-muted/55">
                        <button
                          type="button"
                          className="flex min-w-0 flex-1 items-start gap-3 rounded-xl px-3 py-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          onClick={() =>
                            void navigate({
                              to: "/scheduled",
                              search: { automationID: automation.id },
                            })
                          }
                        >
                          <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center">
                            {currentRun ? (
                              <LoaderCircle
                                className="size-4 animate-spin text-info"
                                aria-label="Running"
                              />
                            ) : attention ? (
                              <CircleAlert
                                className="size-4 text-destructive"
                                aria-label="Needs review"
                              />
                            ) : automation.status === "paused" ? (
                              <Pause className="size-4 text-muted-foreground" aria-label="Paused" />
                            ) : (
                              <Circle className="size-4 text-muted-foreground" aria-hidden="true" />
                            )}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium">
                              {automation.name}
                            </span>
                            <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                              {automationScheduleLabel(automation.trigger)}
                              <span aria-hidden="true"> · </span>
                              {nextRunLabel(automation)}
                            </span>
                            {latestRun ? (
                              <span className="mt-0.5 block truncate text-meta text-muted-foreground">
                                Latest: {automationRunStateLabel(latestRun)} ·{" "}
                                {runTimestamp(latestRun)}
                              </span>
                            ) : null}
                          </span>
                          {unread > 0 ? (
                            <span
                              className="mt-2 size-2 shrink-0 rounded-full bg-info"
                              aria-label={`${unread} unread runs`}
                            />
                          ) : null}
                        </button>
                        {latestRun ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            className="mt-2 shrink-0 text-muted-foreground"
                            aria-label={`${automationRunActionLabel(latestRun)} for ${automation.name}`}
                            onClick={() => runAction(latestRun, "open")}
                          >
                            <ExternalLink aria-hidden="true" />
                          </Button>
                        ) : null}
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            render={
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                className="mt-2 mr-2 shrink-0 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100"
                                aria-label={`Actions for ${automation.name}`}
                              />
                            }
                          >
                            <MoreHorizontal aria-hidden="true" />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {latestRun ? (
                              <DropdownMenuItem onClick={() => runAction(latestRun, "open")}>
                                <ExternalLink aria-hidden="true" />
                                {automationRunActionLabel(latestRun)}
                              </DropdownMenuItem>
                            ) : null}
                            <DropdownMenuItem
                              onClick={() => void automationAction(automation, "run-now")}
                            >
                              <Play aria-hidden="true" />
                              {currentRun ? "Open current run" : "Run now"}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onClick={() =>
                                void automationAction(
                                  automation,
                                  automation.status === "active" ? "pause" : "resume",
                                )
                              }
                            >
                              {automation.status === "active" ? (
                                <Pause aria-hidden="true" />
                              ) : (
                                <Play aria-hidden="true" />
                              )}
                              {automation.status === "active" ? "Pause" : "Resume"}
                            </DropdownMenuItem>
                            {unread > 0 ? (
                              <DropdownMenuItem
                                onClick={() => {
                                  for (const run of automationRuns) {
                                    if (run.readAt === null && run.archivedAt === null) {
                                      void dispatch({ type: "mark-read", runID: run.id });
                                    }
                                  }
                                }}
                              >
                                <Check aria-hidden="true" /> Mark runs read
                              </DropdownMenuItem>
                            ) : null}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </Fragment>
                  );
                })}
              </div>
            )}

            {orphanedRuns.length ? (
              <section className="mt-6 border-t pt-4" aria-labelledby="deleted-runs-heading">
                <h2
                  id="deleted-runs-heading"
                  className="mb-1 px-3 text-meta font-medium uppercase tracking-wide text-muted-foreground"
                >
                  Deleted task runs
                </h2>
                {orphanedRuns.map((run) => (
                  <button
                    key={run.id}
                    type="button"
                    className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left hover:bg-muted/55"
                    disabled={!run.rootSessionID}
                    onClick={() => runAction(run, "open")}
                  >
                    <Circle className="size-4 text-muted-foreground" aria-hidden="true" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">Deleted scheduled task</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {automationRunStateLabel(run)} ·{" "}
                        {run.summary ?? run.error?.message ?? runTimestamp(run)}
                      </span>
                    </span>
                  </button>
                ))}
              </section>
            ) : null}

            {!loading && orderedAutomations.length === 0 && orphanedRuns.length === 0 ? (
              <p className="px-3 py-8 text-center text-sm text-muted-foreground">
                {query
                  ? "No scheduled tasks match this search."
                  : "No scheduled tasks in this view."}
              </p>
            ) : null}

            <section className="mt-8 border-t pt-4" aria-labelledby="suggestions-heading">
              <h2 id="suggestions-heading" className="mb-2 px-2 text-sm font-medium">
                Suggestions
              </h2>
              <div className="divide-y">
                {SUGGESTIONS.map((suggestion) => {
                  const Icon = suggestion.icon;
                  return (
                    <button
                      key={suggestion.name}
                      type="button"
                      className="flex w-full items-start gap-3 rounded-xl px-3 py-3 text-left hover:bg-muted/55"
                      onClick={() =>
                        createTask(suggestionDraft(suggestion, taskProjects[0] ?? null))
                      }
                    >
                      <Icon
                        className={`mt-0.5 size-4 shrink-0 ${suggestion.color}`}
                        aria-hidden="true"
                      />
                      <span className="min-w-0">
                        <span className="text-sm font-medium">{suggestion.name}</span>
                        <span className="ml-2 text-xs text-muted-foreground">
                          {suggestion.schedule === "weekdays"
                            ? "Weekdays at 9:00 AM"
                            : suggestion.schedule === "weekly"
                              ? "Fridays at 4:00 PM"
                              : "Daily at 9:00 AM"}
                        </span>
                        <span className="mt-0.5 block text-xs text-muted-foreground">
                          {suggestion.description}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          </div>
        </div>
      </section>

      {detailOpen ? (
        <AutomationEditor
          key={
            selectedAutomation?.id ??
            `create:${search.sessionID ?? "standalone"}:${createEditorVersion}`
          }
          automation={selectedAutomation}
          initialDraft={draft}
          projects={taskProjects}
          sessions={sessions}
          runs={selectedRuns}
          selectedRunID={selectedRun?.id}
          saving={saving}
          onClose={closeDetail}
          onSave={save}
          onAction={action}
          onRunAction={runAction}
        />
      ) : null}
    </main>
  );
}

function automationDraft(automation: AutomationRecord): AutomationDraft {
  return {
    name: automation.name,
    status: automation.status,
    action: automation.action,
    destination: automation.destination,
    trigger: automation.trigger,
    missedRuns: automation.missedRuns,
    notifications: automation.notifications,
    createdFromSessionID: automation.createdFromSessionID,
  };
}

function defaultDraft(
  project: AutomationProject | null,
  sessionID: string | null = null,
): AutomationDraft {
  const start = nextHour();
  return {
    name: "",
    status: "active",
    action: { prompt: "", agent: null, model: null, skills: [] },
    destination: sessionID
      ? { type: "session", sessionID }
      : project
        ? {
            type: "standalone",
            projectID: project.id,
            sourceDirectory: project.canonical,
            workspace: { type: "new-worktree" },
          }
        : { type: "session", sessionID: "" },
    trigger: {
      version: 1,
      type: "recurring",
      dtstart: start,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      rrule: "FREQ=DAILY;INTERVAL=1",
    },
    missedRuns: { type: "catch-up-once", maxAgeMs: 24 * 60 * 60 * 1_000 },
    notifications: "background-only",
    createdFromSessionID: sessionID,
  };
}

type AutomationProject = Pick<import("../../../shared").PalotProject, "id" | "canonical">;

function suggestionDraft(
  suggestion: (typeof SUGGESTIONS)[number],
  project: AutomationProject | null,
): AutomationDraft {
  const draft = defaultDraft(project);
  const date = new Date(draft.trigger.type === "recurring" ? draft.trigger.dtstart : Date.now());
  if (suggestion.schedule === "weekly") {
    date.setHours(16, 0, 0, 0);
    return {
      ...draft,
      name: suggestion.name,
      action: { ...draft.action, prompt: suggestion.prompt },
      trigger: {
        version: 1,
        type: "recurring",
        dtstart: date.getTime(),
        timezone: draft.trigger.timezone,
        rrule: "FREQ=WEEKLY;BYDAY=FR",
      },
    };
  }
  date.setHours(9, 0, 0, 0);
  return {
    ...draft,
    name: suggestion.name,
    action: { ...draft.action, prompt: suggestion.prompt },
    trigger: {
      version: 1,
      type: "recurring",
      dtstart: date.getTime(),
      timezone: draft.trigger.timezone,
      rrule:
        suggestion.schedule === "weekdays"
          ? "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR"
          : "FREQ=DAILY;INTERVAL=1",
    },
  };
}

function nextHour(): number {
  const value = new Date();
  value.setMinutes(0, 0, 0);
  value.setHours(value.getHours() + 1);
  return value.getTime();
}

function automationSection(runs: AutomationRun[]): "Needs attention" | "Running" | "Scheduled" {
  if (
    runs.some(
      (run) => run.state === "needs-attention" || (run.readAt === null && runNeedsReview(run)),
    )
  ) {
    return "Needs attention";
  }
  if (runs.some(runIsActive)) return "Running";
  return "Scheduled";
}

function sectionPriority(section: ReturnType<typeof automationSection>): number {
  if (section === "Needs attention") return 0;
  if (section === "Running") return 1;
  return 2;
}
