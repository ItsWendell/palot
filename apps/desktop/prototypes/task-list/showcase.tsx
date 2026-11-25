/**
 * A dev-only page that renders the real task list (`components/task-list`) over a fixture
 * source, with the sidebar prototype's scenarios. `?scenario=busy`, `?theme=light`,
 * `?width=220|272|340|420` and `?motion=reduced` change the page.
 */

import { useEffect, useMemo, useState } from "react";
import {
  TaskList,
  DEFAULT_TASK_LIST_PREFERENCES,
  type TaskListPreferences,
} from "@/components/task-list";
import { createFixtureSource } from "@/components/task-list/fixture-source";
import { DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Toaster, toast } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import { permission, question, resetMockSequence, SCENARIOS, scenarioByID } from "./scenarios";

const params = new URLSearchParams(window.location.search);
const WIDTHS = ["220", "272", "340", "420"] as const;

/** The plan's showcase states first, then every other prototype scenario. */
const FEATURED = ["busy", "approvals", "scale", "projects", "servers"];

function useScenario() {
  const [id, setID] = useState(() => scenarioByID(params.get("scenario")).id);
  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("scenario", id);
    window.history.replaceState(null, "", url);
  }, [id]);
  return [scenarioByID(id), setID] as const;
}

export function Showcase() {
  const [scenario, setScenario] = useScenario();
  const [width, setWidth] = useState(() => {
    const value = params.get("width") ?? scenario.settings?.width;
    return WIDTHS.find((item) => item === value) ?? "272";
  });

  const { source, initial } = useMemo(() => {
    resetMockSequence();
    const seed = scenario.seed(Date.now());
    const source = createFixtureSource({
      tasks: seed.tasks,
      projects: seed.projects,
      servers: seed.servers,
      openTaskID: seed.openTaskID,
      hasOlder: true,
    });
    const initial: TaskListPreferences = {
      ...DEFAULT_TASK_LIST_PREFERENCES,
      view: {
        ...DEFAULT_TASK_LIST_PREFERENCES.view,
        grouping: scenario.settings?.grouping ?? "inbox",
      },
      shelves: { ...DEFAULT_TASK_LIST_PREFERENCES.shelves, ...seed.shelves },
      collapsed: seed.collapsed ?? [],
    };
    return { source, initial };
  }, [scenario]);
  const [preferences, setPreferences] = useState(initial);
  useEffect(() => setPreferences(initial), [initial]);

  // Scripted events (a request arriving while you read, a finish).
  useEffect(() => {
    const timers = (scenario.script ?? []).map((step) =>
      window.setTimeout(() => {
        const task = source.getSnapshot().tasks.find((item) => item.id === step.event.taskID);
        if (!task) return;
        const now = Date.now();
        if (step.event.type === "request") {
          const request =
            step.event.request === "permission"
              ? permission(
                  now,
                  "bun run build",
                  "bun run build --filter desktop",
                  "bun run build *",
                )
              : question(now, "Keep the old API?", ["Keep it", "Remove it", "Deprecate first"]);
          source.update([
            {
              ...task,
              requests: [...task.requests, request],
              attentionAt: now,
              run: task.run ?? { startedAt: now - 30_000, lastUpdateAt: now, detail: null },
            },
          ]);
        } else if (step.event.type === "finish" && task.run) {
          source.update([
            {
              ...task,
              run: null,
              runEndedAt: now,
              activityAt: now,
              unread: true,
              summary: { durationMs: now - task.run.startedAt, filesChanged: 2, commands: 3 },
            },
          ]);
        }
      }, step.at),
    );
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [scenario, source]);

  const openTaskID = useOpenTask(source);
  const openTitle = source.getSnapshot().tasks.find((task) => task.id === openTaskID)?.title;
  const ordered = [
    ...FEATURED.map((id) => SCENARIOS.find((item) => item.id === id)!),
    ...SCENARIOS.filter((item) => !FEATURED.includes(item.id) && item.id !== "rail"),
  ];

  return (
    <TooltipProvider>
      <Toaster>
        <div className="flex h-screen min-h-0 flex-col bg-background text-foreground">
          <header className="flex shrink-0 flex-wrap items-center gap-1 border-b border-border px-3 py-2 text-meta">
            <span className="mr-2 font-medium">Task list showcase</span>
            {ordered.map((item) => (
              <button
                key={item.id}
                type="button"
                data-scenario={item.id}
                className={cn(
                  "rounded-md px-2 py-1 text-muted-foreground hover:bg-muted",
                  item.id === scenario.id && "bg-muted text-foreground",
                  FEATURED.includes(item.id) && "font-medium",
                )}
                onClick={() => setScenario(item.id)}
              >
                {item.label.replace(/^\d+\. /, "")}
              </button>
            ))}
            <span className="ml-auto flex items-center gap-1">
              {WIDTHS.map((value) => (
                <button
                  key={value}
                  type="button"
                  className={cn(
                    "rounded-md px-1.5 py-1 text-muted-foreground tabular-nums hover:bg-muted",
                    value === width && "bg-muted text-foreground",
                  )}
                  onClick={() => setWidth(value)}
                >
                  {value}
                </button>
              ))}
            </span>
          </header>
          <div className="flex min-h-0 flex-1">
            <div
              className="w-11 shrink-0 border-r border-sidebar-border bg-sidebar"
              aria-hidden="true"
            />
            <div
              className="flex h-full min-h-0 shrink-0 flex-col border-r border-sidebar-border"
              style={{ width: Number(width) }}
            >
              <TaskList
                key={scenario.id}
                source={source}
                preferences={preferences}
                onPreferencesChange={setPreferences}
                onSearch={() =>
                  toast.add({ title: "Search", description: "The command palette opens here." })
                }
                viewMenuItems={
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => toast.add({ title: "Add project folder…" })}>
                      Add project folder…
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => toast.add({ title: "Import task…" })}>
                      Import task…
                    </DropdownMenuItem>
                  </>
                }
              />
            </div>
            <main className="flex min-w-0 flex-1 flex-col gap-3 p-8">
              <p className="m-0 text-meta text-muted-foreground">{scenario.hint}</p>
              <h1 className="m-0 text-page-title">{openTitle ?? "No task open"}</h1>
              <div className="flex max-w-xl flex-col gap-2" aria-hidden="true">
                {[90, 76, 84, 60].map((size) => (
                  <div key={size} className="h-3 rounded bg-muted" style={{ width: `${size}%` }} />
                ))}
              </div>
              <ul
                className="m-0 mt-6 list-none p-0 text-micro text-muted-foreground"
                aria-label="Calls"
              >
                <CallLog source={source} />
              </ul>
            </main>
          </div>
        </div>
      </Toaster>
    </TooltipProvider>
  );
}

function useOpenTask(source: ReturnType<typeof createFixtureSource>) {
  const [id, setID] = useState(source.getSnapshot().openTaskID);
  useEffect(() => {
    setID(source.getSnapshot().openTaskID);
    return source.subscribe(() => setID(source.getSnapshot().openTaskID));
  }, [source]);
  return id;
}

/** The last few source calls, so a click shows what the list asked the app to do. */
function CallLog({ source }: { source: ReturnType<typeof createFixtureSource> }) {
  const [count, setCount] = useState(0);
  useEffect(() => source.subscribe(() => setCount(source.calls.length)), [source]);
  useEffect(() => {
    const timer = window.setInterval(() => setCount(source.calls.length), 500);
    return () => window.clearInterval(timer);
  }, [source]);
  return (
    <>
      {source.calls.slice(Math.max(0, count - 6)).map((call, index) => (
        <li key={`${count}-${index}`} className="font-mono">
          {call.action}({call.args.map((arg) => JSON.stringify(arg)).join(", ")})
        </li>
      ))}
    </>
  );
}
