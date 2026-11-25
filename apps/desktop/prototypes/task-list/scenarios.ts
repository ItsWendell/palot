/** Scenarios for the task list showcase, copied from the sidebar prototype's `mock.ts`. Times are relative to "now". */

import type { Grouping, ShelfID, WorkingPlacement } from "@/lib/task-list/model/sections";
import type {
  PermissionRequest,
  Project,
  QuestionRequest,
  Server,
  Task,
  TaskPullRequest,
} from "@/lib/task-list/types";

export type ColumnWidth = "220" | "272" | "340" | "420" | "rail";

const S = 1_000;
const M = 60 * S;
const H = 60 * M;
const D = 24 * H;

export const LOCAL: Server = { id: "local", name: "This Mac", online: true, lastSeenAt: null };
const DEVBOX: Server = { id: "devbox", name: "build-box", online: true, lastSeenAt: null };
const STAGING: Server = { id: "staging", name: "staging-runner", online: true, lastSeenAt: null };

const PROJECT_NAMES = [
  "palot",
  "opencode",
  "website",
  "infra",
  "docs",
  "mobile",
  "design-system",
  "billing",
];

function projects(count = 8, serverID = "local"): Project[] {
  return PROJECT_NAMES.slice(0, count).map((name) => ({ id: name, name, serverID }));
}

let sequence = 0;

/** A read, idle task; scenarios override what they need. */
function task(now: number, partial: Partial<Task> & Pick<Task, "title">): Task {
  sequence += 1;
  const activityAt = partial.activityAt ?? now - (20 + sequence * 7) * M;
  return {
    id: partial.id ?? `t${sequence}`,
    projectID: "palot",
    serverID: "local",
    branch: null,
    createdAt: activityAt - 40 * M,
    activityAt,
    run: null,
    runEndedAt: null,
    requests: [],
    requestIndex: 0,
    failure: null,
    stopped: false,
    unread: false,
    summary: { durationMs: 2 * M + 5 * S, filesChanged: 3, commands: 4 },
    pinnedAt: null,
    snoozedUntil: null,
    settledAt: null,
    pr: null,
    subagents: 0,
    schedule: null,
    lastAnswer:
      "Done. The inbox now keeps its order while the pointer is over it, and pending moves apply when it leaves. I added tests for the held order and for removal.",
    attentionAt: null,
    lingerUntil: null,
    ...partial,
  };
}

function working(now: number, startedAgo: number, detail: string, quietFor = 4 * S) {
  return {
    run: { startedAt: now - startedAgo, lastUpdateAt: now - quietFor, detail },
    activityAt: now - startedAgo,
    summary: null,
  } satisfies Partial<Task>;
}

let requestSequence = 0;

export function permission(
  arrivedAt: number,
  summary: string,
  detail: string,
  rule: string,
  from: string | null = null,
): PermissionRequest {
  requestSequence += 1;
  return { id: `r${requestSequence}`, kind: "permission", arrivedAt, summary, detail, rule, from };
}

export function question(arrivedAt: number, text: string, options: string[]): QuestionRequest {
  requestSequence += 1;
  return {
    id: `r${requestSequence}`,
    kind: "question",
    arrivedAt,
    question: text,
    options,
    from: null,
  };
}

function waiting(now: number, ago: number, ...requests: (PermissionRequest | QuestionRequest)[]) {
  return {
    run: { startedAt: now - ago - 3 * M, lastUpdateAt: now - ago, detail: null },
    requests,
    attentionAt: now - ago,
    activityAt: now - ago - 3 * M,
    summary: null,
  } satisfies Partial<Task>;
}

function pr(
  number: number,
  state: TaskPullRequest["state"] = "open",
  checks: TaskPullRequest["checks"] = "passing",
): TaskPullRequest {
  return { number, state, checks, readiness: null };
}

/** The steps a live task cycles through while "Live detail" is on. */
export const LIVE_DETAILS = [
  "Reading src/renderer/atoms/inbox.ts",
  "Running bun test",
  "Editing inbox-sidebar.tsx",
  "Thinking",
  "Searching for useStableOrder",
  "Running vp check --fix",
  "Editing session-inbox.ts",
  "Reading DESIGN.md",
];

const IDLE_TITLES = [
  "Rename the triage atoms",
  "Fix flaky branch memory test",
  "Draft release notes for 0.42",
  "Explain the session catalog cache",
  "Tighten composer focus ring",
  "Audit unused icons",
  "Trim the Linux package size",
  "Investigate slow cold start",
  "Move toast copy to sentence case",
  "Add Mod+B to the shortcut sheet",
  "Check OpenCode 2.3 changelog",
  "Port settings disclosure to Base UI",
  "Clean up the worktree picker",
  "Write the diff toolbar docs",
  "Profile the transcript scroller",
  "Remove the legacy Alert",
  "Document the peek timing",
  "Sort projects by recent activity",
  "Reproduce the stuck spinner",
  "Make sounds respect focus",
];

const SETTLED_TITLES = [
  "Ship the 0.41 release notes",
  "Fix the Wayland drag strip",
  "Add the Usage page",
  "Retire the old onboarding",
  "Bump Electron to 45",
  "Fix CSP for the browser pane",
  "Cache branch lookups",
  "Speed up first paint",
  "Write the theme catalog docs",
  "Fix scroll jump on resume",
  "Unify toast copy",
  "Trim the preload API",
  "Add OpenCode 2.2 support",
  "Fix the stuck reconnect",
  "Polish the diff toolbar",
];

export interface ScenarioSeed {
  tasks: Task[];
  servers: Server[];
  projects: Project[];
  openTaskID: string | null;
  /** The row that holds keyboard focus when the scenario starts. */
  focusTaskID?: string;
  shelves?: Partial<Record<ShelfID, boolean>>;
  collapsed?: string[];
  settledLimit?: number;
}

export interface ScenarioSettings {
  grouping: Grouping;
  workingPlacement: WorkingPlacement;
  width: ColumnWidth;
}

export type ScriptEvent =
  | { type: "request"; taskID: string; request: "permission" | "question" }
  | { type: "finish"; taskID: string }
  | { type: "pr-merged"; taskID: string };

export interface Scenario {
  id: string;
  group: string;
  label: string;
  /** One line shown beside the scenario picker. */
  hint: string;
  seed(now: number): ScenarioSeed;
  settings?: Partial<ScenarioSettings>;
  script?: { at: number; event: ScriptEvent }[];
  /** Live detail advances for working tasks. */
  live?: boolean;
  overlay?: "keyboard";
  /** Overrides the seed's keyboard focus (scenarios that share a seed). */
  focusTaskID?: string;
  /** Today's numbers for the closest comparable screen, from the comparison. */
  today?: { visible: string; tabStops: string; note: string };
}

const TODAY_IDLE = { visible: "35", tabStops: "66", note: "today, 15 idle tasks" };
const TODAY_BUSY = { visible: "37", tabStops: "65", note: "today, busy" };
const TODAY_PROJECTS = { visible: "≈53", tabStops: "65", note: "today, busy in Projects" };

function idleTasks(now: number, count: number, offset = 0, extra: Partial<Task> = {}): Task[] {
  return Array.from({ length: count }, (_, index) =>
    task(now, {
      title: IDLE_TITLES[(index + offset) % IDLE_TITLES.length]!,
      projectID: PROJECT_NAMES[(index + offset) % 4]!,
      branch: index % 3 === 0 ? null : `feature/${(index + offset) % 7}-cleanup`,
      activityAt: now - (35 + (index + offset) * 47) * M,
      ...extra,
    }),
  );
}

function calmMorning(now: number): ScenarioSeed {
  return {
    servers: [LOCAL],
    projects: projects(),
    openTaskID: "calm-open",
    tasks: [
      task(now, {
        id: "calm-pin",
        title: "Weekly dependency audit",
        projectID: "infra",
        pinnedAt: now - 3 * D,
        activityAt: now - 2 * D,
        schedule: "Weekly, Mon 09:00",
      }),
      task(now, {
        id: "calm-unseen",
        title: "Make the inbox order stable",
        branch: "feature/turns",
        unread: true,
        activityAt: now - 12 * M,
        pr: pr(412),
      }),
      task(now, {
        id: "calm-open",
        title: "Review the composer prototype",
        projectID: "palot",
        activityAt: now - 48 * M,
      }),
      ...idleTasks(now, 3),
    ],
  };
}

function busyFleet(now: number): ScenarioSeed {
  return {
    servers: [LOCAL],
    projects: projects(),
    openTaskID: "busy-open",
    tasks: [
      task(now, {
        id: "busy-a1",
        title: "Run the full desktop test suite",
        branch: "feature/turns",
        ...waiting(
          now,
          4 * M,
          permission(
            now - 4 * M,
            "bun test",
            "bun test --run apps/desktop/src/renderer",
            "bun test *",
          ),
        ),
      }),
      task(now, {
        id: "busy-a2",
        title: "Upgrade OpenCode runtime to 2.3",
        projectID: "opencode",
        branch: "chore/runtime-2.3",
        ...waiting(
          now,
          90 * S,
          permission(
            now - 90 * S,
            "edit package.json",
            "apps/desktop/package.json",
            "edit apps/desktop/*",
          ),
        ),
      }),
      task(now, {
        id: "busy-q1",
        title: "Pick a branch for the hotfix",
        projectID: "website",
        branch: "main",
        ...waiting(
          now,
          2 * M,
          question(now - 2 * M, "Which branch?", ["main", "release/0.41", "hotfix/csp"]),
        ),
      }),
      task(now, {
        id: "busy-w1",
        title: "Refactor session inbox sections",
        branch: "feature/sections",
        ...working(now, 3 * M + 12 * S, LIVE_DETAILS[0]!),
        pr: pr(418, "draft", "pending"),
      }),
      task(now, {
        id: "busy-w2",
        title: "Fix flaky worktree E2E",
        projectID: "palot",
        branch: "fix/worktree-e2e",
        ...working(now, 42 * S, LIVE_DETAILS[1]!),
        subagents: 2,
      }),
      task(now, {
        id: "busy-w3",
        title: "Generate API docs",
        projectID: "docs",
        ...working(now, 8 * M, LIVE_DETAILS[3]!),
      }),
      task(now, {
        id: "busy-w4",
        title: "Bump Tailwind and fix tokens",
        projectID: "website",
        branch: "chore/tailwind",
        ...working(now, 15 * M, LIVE_DETAILS[5]!),
      }),
      task(now, {
        id: "busy-w5",
        title: "Terraform plan for staging",
        projectID: "infra",
        ...working(now, 2 * M, LIVE_DETAILS[2]!),
      }),
      task(now, {
        id: "busy-open",
        title: "Design the calmer sidebar",
        activityAt: now - 25 * M,
        branch: "proto/sidebar",
      }),
      ...idleTasks(now, 9, 3),
    ],
  };
}

function inboxClear(now: number): ScenarioSeed {
  return {
    servers: [LOCAL],
    projects: projects(),
    openTaskID: null,
    tasks: [
      task(now, { title: "Migrate settings store", ...working(now, 6 * M, LIVE_DETAILS[2]!) }),
      task(now, {
        title: "Nightly dependency audit",
        projectID: "infra",
        schedule: "Daily 02:00",
        ...working(now, 50 * S, LIVE_DETAILS[1]!),
      }),
      ...Array.from({ length: 5 }, (_, index) =>
        task(now, { title: IDLE_TITLES[index + 4]!, settledAt: now - (index + 1) * H }),
      ),
    ],
  };
}

/** A chat is a task with no project: no branch, no worktree, no pull request. */
function chatsMixed(now: number): ScenarioSeed {
  const chat = (partial: Partial<Task> & Pick<Task, "title">) =>
    task(now, { projectID: null, branch: null, pr: null, ...partial });
  return {
    servers: [LOCAL],
    projects: projects(),
    openTaskID: "chat-idle-1",
    tasks: [
      chat({
        id: "chat-asks",
        title: "Which licence for the icon set?",
        ...waiting(
          now,
          3 * M,
          question(now - 3 * M, "Do you need attribution in the app?", [
            "Yes",
            "No",
            "Only in About",
          ]),
        ),
      }),
      chat({
        id: "chat-working",
        title: "Compare Base UI and Radix menus",
        ...working(now, 90 * S, "Reading the Base UI docs"),
      }),
      chat({
        id: "chat-unseen",
        title: "Explain OKLCH colour mixing",
        unread: true,
        activityAt: now - 18 * M,
        summary: { durationMs: 40 * S, filesChanged: 0, commands: 0 },
      }),
      chat({ id: "chat-idle-1", title: "Name ideas for the shelf", activityAt: now - 50 * M }),
      chat({
        id: "chat-idle-2",
        title: "Summarise the OpenCode 2.3 notes",
        activityAt: now - 4 * H,
      }),
      task(now, {
        title: "Make the inbox order stable",
        branch: "feature/turns",
        activityAt: now - 25 * M,
        pr: pr(412),
      }),
      task(now, {
        title: "Fix flaky branch memory test",
        branch: "fix/branch-memory",
        activityAt: now - 70 * M,
      }),
      task(now, { title: "Tighten composer focus ring", activityAt: now - 2 * H }),
      task(now, {
        title: "Speed up Linux packaging",
        projectID: "infra",
        branch: "chore/packaging",
        ...working(now, 6 * M, LIVE_DETAILS[5]!),
      }),
      task(now, {
        title: "Rotate staging certificates",
        projectID: "infra",
        activityAt: now - 3 * H,
      }),
      task(now, {
        title: "Write the migration guide",
        projectID: "docs",
        branch: "docs/2.3",
        unread: true,
        activityAt: now - 40 * M,
      }),
      task(now, { title: "Fix broken anchor links", projectID: "docs", activityAt: now - 5 * H }),
      task(now, {
        title: "Index the docs search",
        projectID: "docs",
        branch: "feature/search",
        activityAt: now - 9 * H,
      }),
    ],
  };
}

function threeApprovals(now: number): ScenarioSeed {
  return {
    servers: [LOCAL],
    projects: projects(),
    openTaskID: null,
    focusTaskID: "ap-1",
    tasks: [
      task(now, {
        id: "ap-1",
        title: "Run the migration dry run",
        projectID: "billing",
        branch: "feature/invoices",
        ...waiting(
          now,
          6 * M,
          permission(
            now - 6 * M,
            "bun run db:migrate",
            "bun run db:migrate --dry-run --env staging",
            "bun run db:migrate *",
          ),
        ),
      }),
      task(now, {
        id: "ap-2",
        title: "Delete generated snapshots",
        branch: "chore/snapshots",
        ...waiting(
          now,
          3 * M,
          permission(
            now - 3 * M,
            "rm -rf __snapshots__",
            "rm -rf apps/desktop/src/renderer/components/__snapshots__",
            "rm -rf *",
          ),
        ),
      }),
      task(now, {
        id: "ap-3",
        title: "Fetch the OpenCode schema",
        projectID: "opencode",
        ...waiting(
          now,
          40 * S,
          permission(
            now - 40 * S,
            "fetch schema.json",
            "https://opencode.ai/config.json",
            "webfetch opencode.ai",
          ),
        ),
      }),
      task(now, { title: "Polish rail tooltips", ...working(now, 4 * M, LIVE_DETAILS[6]!) }),
      ...idleTasks(now, 6, 8),
    ],
  };
}

function questionScenario(now: number): ScenarioSeed {
  return {
    servers: [LOCAL],
    projects: projects(),
    openTaskID: null,
    focusTaskID: "q-1",
    tasks: [
      task(now, {
        id: "q-1",
        title: "Choose the release channel",
        projectID: "palot",
        ...waiting(
          now,
          5 * M,
          question(now - 5 * M, "Which channel should 0.42 ship on?", [
            "Stable",
            "Beta",
            "Nightly only",
            "Hold the release",
            "Ask me tomorrow",
          ]),
        ),
      }),
      task(now, {
        id: "q-multi",
        title: "Clean up old worktrees",
        projectID: "infra",
        ...waiting(
          now,
          2 * M,
          permission(
            now - 2 * M,
            "git worktree remove",
            "git worktree remove ../palot-wt-old-1",
            "git worktree remove *",
          ),
          question(now - 2 * M + 5 * S, "Keep the branch for wt-old-2?", ["Keep it", "Delete it"]),
          permission(
            now - 2 * M + 9 * S,
            "rm -rf ../palot-wt-old-3",
            "rm -rf /home/me/Projects/palot-wt-old-3",
            "rm -rf ../palot-wt-*",
            "explore",
          ),
        ),
      }),
      ...idleTasks(now, 6, 2),
    ],
  };
}

function arrives(now: number): ScenarioSeed {
  return {
    servers: [LOCAL],
    projects: projects(),
    openTaskID: "arr-read",
    focusTaskID: "arr-target",
    tasks: [
      task(now, {
        id: "arr-read",
        title: "Read the stability notes",
        activityAt: now - 30 * M,
      }),
      task(now, {
        id: "arr-target",
        title: "Migrate settings store",
        branch: "feature/settings-store",
        ...working(now, 3 * M, LIVE_DETAILS[2]!),
      }),
      task(now, {
        title: "Generate API docs",
        projectID: "docs",
        ...working(now, 9 * M, LIVE_DETAILS[0]!),
      }),
      ...idleTasks(now, 7, 5),
    ],
  };
}

function failedStopped(now: number): ScenarioSeed {
  return {
    servers: [LOCAL],
    projects: projects(),
    openTaskID: null,
    tasks: [
      task(now, {
        id: "fail-1",
        title: "Summarise last week's PRs",
        projectID: "docs",
        failure: "rate limit reached",
        attentionAt: now - 8 * M,
        activityAt: now - 8 * M,
        summary: null,
      }),
      task(now, {
        id: "stop-1",
        title: "Rewrite the onboarding copy",
        projectID: "website",
        stopped: true,
        activityAt: now - 22 * M,
      }),
      task(now, {
        id: "stale-1",
        title: "Bisect the memory regression",
        branch: "fix/memory",
        ...working(now, 41 * M, "Running bun run perf", 12 * M),
      }),
      task(now, {
        title: "Index the docs search",
        projectID: "docs",
        ...working(now, 2 * M, LIVE_DETAILS[0]!),
      }),
      ...idleTasks(now, 6, 11),
    ],
  };
}

function overnight(now: number): ScenarioSeed {
  const finished = [
    ["Upgrade React to 19.3", "palot", 14 * M + 20 * S, 12],
    ["Translate settings to Dutch", "palot", 6 * M + 2 * S, 4],
    ["Fix CSP report-only header", "website", 3 * M + 40 * S, 1],
    ["Write migration guide for 2.3", "docs", 9 * M + 15 * S, 2],
    ["Speed up Linux packaging", "infra", 22 * M, 6],
    ["Audit unused translation keys", "palot", 1 * M + 30 * S, 0],
  ] as const;
  return {
    servers: [LOCAL],
    projects: projects(),
    openTaskID: null,
    focusTaskID: "night-0",
    tasks: [
      ...finished.map(([title, projectID, durationMs, filesChanged], index) =>
        task(now, {
          id: `night-${index}`,
          title,
          projectID,
          unread: true,
          activityAt: now - (7 * H + index * 23 * M),
          summary: { durationMs, filesChanged, commands: 3 + index },
          branch: filesChanged ? `agent/${title.toLowerCase().split(" ")[0]}` : null,
          pr: index === 0 ? pr(431) : index === 4 ? pr(433, "open", "failing") : null,
        }),
      ),
      ...idleTasks(now, 6, 1),
    ],
  };
}

function prMerged(now: number): ScenarioSeed {
  return {
    servers: [LOCAL],
    projects: projects(),
    openTaskID: null,
    tasks: [
      task(now, {
        id: "merge-1",
        title: "Hold inbox order under the pointer",
        branch: "feature/stable-order",
        activityAt: now - 2 * H,
        pr: pr(407, "open", "passing"),
      }),
      task(now, {
        title: "Add PR badge to compact rows",
        branch: "feature/pr-badge",
        unread: true,
        activityAt: now - 40 * M,
        pr: pr(409, "open", "pending"),
      }),
      ...idleTasks(now, 7, 4),
    ],
  };
}

function shelvesScenario(now: number): ScenarioSeed {
  return {
    servers: [LOCAL],
    projects: projects(),
    openTaskID: null,
    shelves: { working: true, snoozed: true, settled: true },
    settledLimit: 8,
    tasks: [
      task(now, { title: "Follow up on the Base UI issue", snoozedUntil: now + 2 * H }),
      task(now, {
        title: "Check the nightly crash rate",
        projectID: "infra",
        snoozedUntil: now + 20 * H,
      }),
      task(now, { title: "Re-run the perf baseline", snoozedUntil: now + 4 * D }),
      task(now, { title: "Polish rail tooltips", ...working(now, 4 * M, LIVE_DETAILS[6]!) }),
      ...idleTasks(now, 5, 6),
      ...Array.from({ length: 30 }, (_, index) =>
        task(now, {
          title: SETTLED_TITLES[index % SETTLED_TITLES.length]!,
          projectID: PROJECT_NAMES[index % 4]!,
          settledAt: now - (index + 1) * 5 * H,
          activityAt: now - (index + 1) * 5 * H,
        }),
      ),
    ],
  };
}

function eightProjects(now: number): ScenarioSeed {
  const all = projects(8);
  const tasks: Task[] = [];
  all.forEach((project, projectIndex) => {
    const count = 2 + (projectIndex % 3);
    for (let index = 0; index < count; index++) {
      const n = projectIndex * 3 + index;
      tasks.push(
        task(now, {
          title: IDLE_TITLES[n % IDLE_TITLES.length]!,
          projectID: project.id,
          branch: `feature/${project.id}-${index}`,
          activityAt: now - (30 + n * 33) * M,
          ...(index === 0 && projectIndex % 4 === 1
            ? working(now, (n + 1) * M, LIVE_DETAILS[n % 8]!)
            : {}),
          ...(index === 1 && projectIndex % 3 === 0 ? { unread: true } : {}),
        }),
      );
    }
  });
  tasks.push(
    task(now, {
      title: "Approve the deploy script",
      projectID: "infra",
      ...waiting(
        now,
        3 * M,
        permission(
          now - 3 * M,
          "./deploy.sh staging",
          "./scripts/deploy.sh staging --yes",
          "./scripts/deploy.sh *",
        ),
      ),
    }),
    task(now, {
      title: "What's a good name for the shelf?",
      projectID: null,
      activityAt: now - 3 * H,
    }),
    task(now, {
      title: "Explain OKLCH colour mixing",
      projectID: null,
      activityAt: now - 26 * H,
      unread: true,
    }),
  );
  return {
    servers: [LOCAL],
    projects: all,
    openTaskID: null,
    tasks,
    collapsed: [
      "group:project:billing",
      "group:project:design-system",
      "group:project:mobile",
      "group:project:docs",
    ],
  };
}

function threeServers(now: number): ScenarioSeed {
  const offline = { ...STAGING, online: false, lastSeenAt: now - 14 * M };
  return {
    servers: [LOCAL, DEVBOX, offline],
    projects: [
      ...projects(3, "local"),
      { id: "dev-palot", name: "palot", serverID: "devbox" },
      { id: "dev-infra", name: "infra", serverID: "devbox" },
      { id: "stg-website", name: "website", serverID: "staging" },
    ],
    openTaskID: null,
    tasks: [
      ...idleTasks(now, 4, 0),
      task(now, {
        title: "Run the full E2E suite",
        serverID: "devbox",
        projectID: "dev-palot",
        ...working(now, 11 * M, "Running bun run test:e2e"),
      }),
      task(now, {
        title: "Benchmark cold start",
        serverID: "devbox",
        projectID: "dev-palot",
        ...waiting(
          now,
          2 * M,
          permission(
            now - 2 * M,
            "strobe bench",
            "strobe bench apps/desktop/perf/startup.bench.ts --base main",
            "strobe *",
          ),
        ),
      }),
      task(now, {
        title: "Rotate staging certificates",
        serverID: "devbox",
        projectID: "dev-infra",
        unread: true,
        activityAt: now - 50 * M,
      }),
      task(now, {
        title: "Warm the CDN cache",
        serverID: "staging",
        projectID: "stg-website",
        ...working(now, 30 * M, "Running purge.sh", 14 * M),
      }),
      task(now, {
        title: "Check the 404 report",
        serverID: "staging",
        projectID: "stg-website",
        activityAt: now - 5 * H,
      }),
      task(now, {
        title: "Update robots.txt",
        serverID: "staging",
        projectID: "stg-website",
        activityAt: now - 2 * D,
      }),
    ],
  };
}

/** A long inbox under a few working tasks: the Working dock stays in view while it scrolls. */
function longInbox(count: number) {
  return (now: number): ScenarioSeed => ({
    servers: [LOCAL],
    projects: projects(),
    openTaskID: null,
    tasks: [
      task(now, {
        title: "Run the full desktop test suite",
        ...waiting(now, 2 * M, permission(now - 2 * M, "bun test", "bun test --run", "bun test *")),
      }),
      ...Array.from({ length: count }, (_, index) =>
        task(now, {
          title: IDLE_TITLES[(index + 2) % IDLE_TITLES.length]!,
          projectID: PROJECT_NAMES[index % 4]!,
          branch: `feature/dock-${index}`,
          ...working(now, (index + 1) * 50 * S, LIVE_DETAILS[index % 8]!),
        }),
      ),
      ...idleTasks(now, 30, 1),
    ],
  });
}

function fourHundred(now: number): ScenarioSeed {
  const tasks: Task[] = [];
  for (let index = 0; index < 400; index++) {
    const projectID = PROJECT_NAMES[index % 8]!;
    const base = {
      title: `${IDLE_TITLES[index % IDLE_TITLES.length]} #${index + 1}`,
      projectID,
      branch: index % 4 ? `feature/${projectID}-${index}` : null,
      activityAt: now - (10 + index * 23) * M,
    };
    if (index < 4)
      tasks.push(
        task(now, {
          ...base,
          ...waiting(
            now,
            (index + 1) * M,
            permission(now - (index + 1) * M, "bun test", "bun test --run", "bun test *"),
          ),
        }),
      );
    else if (index < 16)
      tasks.push(task(now, { ...base, ...working(now, index * 40 * S, LIVE_DETAILS[index % 8]!) }));
    else if (index < 30) tasks.push(task(now, { ...base, unread: true }));
    else if (index < 34) tasks.push(task(now, { ...base, pinnedAt: now - index * H }));
    else if (index < 330) tasks.push(task(now, base));
    else tasks.push(task(now, { ...base, settledAt: base.activityAt + H }));
  }
  return { servers: [LOCAL], projects: projects(8), openTaskID: null, tasks };
}

function subagents(now: number): ScenarioSeed {
  return {
    servers: [LOCAL],
    projects: projects(),
    openTaskID: "sub-1",
    tasks: [
      task(now, {
        id: "sub-1",
        title: "Survey the sidebar for clutter",
        branch: "research/sidebar",
        ...working(now, 6 * M, "Reading navigation-rail.tsx"),
        subagents: 4,
      }),
      task(now, {
        id: "sched-1",
        title: "Nightly dependency audit",
        projectID: "infra",
        schedule: "Daily 02:00",
        unread: true,
        activityAt: now - 6 * H,
        summary: { durationMs: 4 * M + 10 * S, filesChanged: 0, commands: 7 },
      }),
      task(now, {
        title: "Weekly usage report",
        projectID: "docs",
        schedule: "Weekly, Fri 17:00",
        activityAt: now - 3 * D,
      }),
      ...idleTasks(now, 6, 9),
    ],
  };
}

const PICKER_GROUPS = ["Basics", "Needs you", "Finishing work", "Scale", "Widths", "Keyboard"];

export const SCENARIOS: Scenario[] = [
  {
    id: "calm",
    group: "Basics",
    label: "1. Calm morning",
    hint: "4 idle, 1 finished-unseen, 1 pinned",
    seed: calmMorning,
    today: TODAY_IDLE,
  },
  {
    id: "busy",
    group: "Basics",
    label: "2. Busy fleet",
    hint: "5 working (live detail advancing), 2 approvals, 1 question",
    seed: busyFleet,
    live: true,
    today: TODAY_BUSY,
  },
  {
    id: "clear",
    group: "Basics",
    label: "3. Inbox is clear",
    hint: "Nothing but 2 working",
    seed: inboxClear,
    live: true,
  },
  {
    id: "chats",
    group: "Basics",
    label: "Chats and projects mixed",
    hint: "5 chats (tasks with no project) among 8 project tasks; one chat asks a question",
    seed: chatsMixed,
    live: true,
  },
  {
    id: "approvals",
    group: "Needs you",
    label: "4. Three approvals waiting",
    hint: "Allow (A) and deny (D) from the list; focus advances",
    seed: threeApprovals,
  },
  {
    id: "question",
    group: "Needs you",
    label: "5. Question and multi-request",
    hint: "Five options; a task with 1 of 3 requests",
    seed: questionScenario,
  },
  {
    id: "arrives",
    group: "Needs you",
    label: "6. A request arrives while reading",
    hint: "Focus is on “Migrate settings store”; at 2 s it asks. Press A at once: the guard ignores it",
    seed: arrives,
    live: true,
    script: [
      { at: 2_000, event: { type: "request", taskID: "arr-target", request: "permission" } },
    ],
  },
  {
    id: "failed",
    group: "Needs you",
    label: "7. Failed and stopped",
    hint: "Rate limit with Retry, a stopped task, a stale task",
    seed: failedStopped,
  },
  {
    id: "overnight",
    group: "Finishing work",
    label: "8. A batch finished overnight",
    hint: "Sweep a Settle button across rows, Shift+click, undo",
    seed: overnight,
  },
  {
    id: "merged",
    group: "Finishing work",
    label: "9. A pull request merged",
    hint: "At 1.5 s PR #407 merges and the task settles itself, with Undo",
    seed: prMerged,
    script: [{ at: 1_500, event: { type: "pr-merged", taskID: "merge-1" } }],
  },
  {
    id: "shelves",
    group: "Finishing work",
    label: "10. Snoozed and settled shelves",
    hint: "Wake, move back, load older",
    seed: shelvesScenario,
  },
  {
    id: "projects",
    group: "Scale",
    label: "11. Grouped by project, 8 projects",
    hint: "Collapsed groups show one rollup mark",
    seed: eightProjects,
    settings: { grouping: "project" },
    live: true,
    today: TODAY_PROJECTS,
  },
  {
    id: "servers",
    group: "Scale",
    label: "12. Three servers, one offline",
    hint: "Offline rows are stale and their actions disabled",
    seed: threeServers,
    settings: { grouping: "server" },
  },
  {
    id: "dock-2",
    group: "Scale",
    label: "Long inbox, 2 working",
    hint: "Working is docked at the bottom; the inbox scrolls above it",
    seed: longInbox(2),
    live: true,
  },
  {
    id: "dock-6",
    group: "Scale",
    label: "Long inbox, 6 working",
    hint: "The dock shows about four rows and scrolls inside itself",
    seed: longInbox(6),
    live: true,
  },
  {
    id: "scale",
    group: "Scale",
    label: "13. 400 tasks",
    hint: "Virtualised: watch “rows mounted” while scrolling",
    seed: fourHundred,
    live: true,
  },
  {
    id: "subagents",
    group: "Scale",
    label: "14. Subagents and a scheduled run",
    hint: "“· 4 agents” and the schedule mark",
    seed: subagents,
    live: true,
  },
  {
    id: "w220",
    group: "Widths",
    label: "15. 220 px",
    hint: "Context drops first, then the PR number",
    seed: busyFleet,
    settings: { width: "220" },
    live: true,
  },
  {
    id: "w420",
    group: "Widths",
    label: "16. 420 px",
    hint: "Room for every context",
    seed: busyFleet,
    settings: { width: "420" },
    live: true,
  },
  {
    id: "rail",
    group: "Widths",
    label: "17. Rail only with peek",
    hint: "Rest on Tasks or the rail edge to peek",
    seed: busyFleet,
    settings: { width: "rail" },
    live: true,
  },
  {
    id: "keyboard",
    group: "Keyboard",
    label: "18. Guided keyboard pass",
    hint: "Follow the overlay: settle, snooze, approve, quick look, jump",
    seed: busyFleet,
    overlay: "keyboard",
    focusTaskID: "busy-open",
    live: true,
  },
];

// Numbered in picker order, so adding a scenario never leaves a stale number behind.
SCENARIOS.forEach((scenario, index) => {
  scenario.label = `${index + 1}. ${scenario.label.replace(/^\d+\. /, "")}`;
});

export const SCENARIO_GROUPS = PICKER_GROUPS;

export function scenarioByID(id: string | null): Scenario {
  return SCENARIOS.find((scenario) => scenario.id === id) ?? SCENARIOS[0]!;
}

/** Fresh ids per seed, so React keys never collide across scenario switches. */
export function resetMockSequence() {
  sequence = 0;
  requestSequence = 0;
}

export { D, H, M, S };
