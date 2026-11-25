import { describe, expect, it } from "vitest";
import type { PalotAgent, PalotCommand } from "../../../shared";
import type { StashedPrompt } from "../../lib/prompt-stash";
import type { RecentProjectOutputTask } from "../../lib/recent-project-outputs";
import {
  EMPTY_LAUNCHER_SOURCES,
  stashPreview,
  type LauncherItem,
  type LauncherSources,
} from "./launcher-items";
import {
  buildLauncherView,
  launcherSuggestions,
  matchTier,
  rankItems,
  type LauncherSuggestionSource,
} from "./launcher-view";
import { CLOSED_LAUNCHER, transition, type LauncherState } from "./launcher-state";

const NOW = Date.UTC(2026, 10, 11, 12);

const command = (name: string, description: string | null = null): PalotCommand => ({
  name,
  description,
  agent: null,
  model: null,
  subtask: false,
});

const agent = (id: string, patch: Partial<PalotAgent> = {}): PalotAgent => ({
  id,
  name: id,
  description: null,
  mode: "subagent",
  hidden: false,
  color: null,
  steps: null,
  model: null,
  permissions: [],
  ...patch,
});

const stash = (id: string, text: string, createdAt: number): StashedPrompt => ({
  id,
  createdAt,
  draft: { text, mentions: [], command: null },
  files: [],
});

const outputs = (
  entries: { name: string; path: string | null; at: number }[],
): RecentProjectOutputTask[] => [
  {
    sessionID: "ses_1",
    title: "Earlier task",
    updatedAt: NOW,
    outputs: entries.map((entry) => ({
      key: `ses_1:/repo/${entry.name}`,
      kind: "changed",
      absolutePath: `/repo/${entry.name}`,
      path: entry.path,
      name: entry.name,
      at: entry.at,
      userMessageID: null,
    })),
  },
];

const sources = (patch: Partial<LauncherSources> = {}): LauncherSources => ({
  ...EMPTY_LAUNCHER_SOURCES,
  ...patch,
});

const plus = (patch: Partial<Extract<LauncherState, { status: "open" }>> = {}): LauncherState => ({
  ...(transition(CLOSED_LAUNCHER, { type: "open", via: "button", draftPreview: null })
    .state as Extract<LauncherState, { status: "open" }>),
  ...patch,
});

const titles = (items: readonly LauncherItem[]) => items.map((item) => item.title);
const view = (state: LauncherState, input: LauncherSources) =>
  buildLauncherView(state, input, { now: NOW });

describe("the root", () => {
  it("lists actions and categories, adding several models only for a new task", () => {
    const root = view(plus(), sources());
    expect(root.sections.map((section) => section.label)).toEqual([null]);
    expect(titles(root.items)).toEqual([
      "Attach files",
      "Recent outputs",
      "Stashed prompts",
      "Commands",
      "Skills",
      "Mention a file, task or agent",
      "Run a shell command",
    ]);
    expect(root.items.find((item) => item.id === "category:mention")?.hint).toBe("@");
    expect(titles(view(plus(), sources({ newTask: true })).items).at(-1)).toBe(
      "Send to several models…",
    );
    expect(root.title).toBeNull();
    expect(root.canGoBack).toBe(false);
    expect(root.empty).toBeNull();
  });

  it("ranks one flat list for a query, at most eight rows, labelled only when kinds mix", () => {
    const many = Array.from({ length: 30 }, (_, index) => command(`review-${index}`));
    const single = view(plus({ query: "review" }), sources({ commands: many }));
    expect(single.items).toHaveLength(8);
    expect(single.sections).toHaveLength(1);
    expect(single.sections[0]!.label).toBeNull();

    const mixed = view(
      plus({ query: "co" }),
      sources({
        commands: [command("compact", "Free context")],
        agents: [agent("code-reviewer")],
      }),
    );
    expect(mixed.sections.map((section) => section.label)).toEqual([
      "Categories",
      "Commands",
      "Agents",
      "Actions",
    ]);
    // Groups follow their best row: the substring match in "Run a shell command" comes last.
    expect(titles(mixed.items)).toEqual([
      "Commands",
      "/compact",
      "@code-reviewer",
      "Run a shell command",
    ]);
  });

  it("says when nothing matches", () => {
    expect(view(plus({ query: "zzzz" }), sources()).empty).toBe("Nothing matches “zzzz”");
  });
});

describe("ranking", () => {
  it("orders prefix, then word start, then substring, then description", () => {
    const rows: LauncherItem[] = [
      {
        id: "d",
        kind: "task",
        title: "Other",
        description: "about turns",
        icon: "task",
        category: "mention",
        action: { type: "shell" },
      },
      {
        id: "c",
        kind: "task",
        title: "Return path",
        icon: "task",
        category: "mention",
        action: { type: "shell" },
      },
      {
        id: "b",
        kind: "task",
        title: "Mount turns",
        icon: "task",
        category: "mention",
        action: { type: "shell" },
      },
      {
        id: "a",
        kind: "task",
        title: "Turn boundary",
        icon: "task",
        category: "mention",
        action: { type: "shell" },
      },
    ];
    expect(rankItems(rows, "turn").map((row) => row.id)).toEqual(["a", "b", "c", "d"]);
    expect(matchTier({ title: "Nothing" }, "turn")).toBeNull();
  });

  it("breaks ties by recency within a kind", () => {
    const rows: LauncherItem[] = [
      {
        id: "old",
        kind: "stash",
        title: "Fix it",
        recency: 1,
        icon: "stash",
        category: "stash",
        action: { type: "shell" },
      },
      {
        id: "new",
        kind: "stash",
        title: "Fix that",
        recency: 5,
        icon: "stash",
        category: "stash",
        action: { type: "shell" },
      },
    ];
    expect(rankItems(rows, "fix").map((row) => row.id)).toEqual(["new", "old"]);
  });

  it("keeps today's command ranking, twenty rows at most", () => {
    const commands = [
      command("model", "Open the model selector"),
      command("reopen"),
      command("open", "Search files"),
      ...Array.from({ length: 30 }, (_, index) => command(`opener-${index}`)),
    ];
    const list = view(plus({ category: "commands", query: "open" }), sources({ commands }));
    expect(list.items).toHaveLength(20);
    expect(list.items[0]!.title).toBe("/open");
    const description = view(
      plus({ category: "commands", query: "selector" }),
      sources({ commands }),
    );
    expect(titles(description.items)).toEqual(["/model"]);
    const order = view(
      plus({ category: "commands", query: "op" }),
      sources({ commands: commands.slice(0, 3) }),
    );
    // Name prefix, then name contains, then description contains.
    expect(titles(order.items)).toEqual(["/open", "/reopen", "/model"]);
  });
});

describe("categories", () => {
  it("lists `@` sources in today's order with group labels, without repeating open files", () => {
    const list = view(
      plus({ category: "mention" }),
      sources({
        references: [
          {
            name: "docs",
            path: "/docs",
            description: null,
            hidden: false,
            sourceType: "local",
            source: "/docs",
          },
        ],
        agents: [
          agent("explore"),
          agent("build", { mode: "primary" }),
          agent("secret", { hidden: true }),
        ],
        openFiles: ["src/app.ts"],
        files: { paths: ["src/app.ts", "src/main.ts"], pending: false },
        tasks: [{ id: "ses_a", title: "Older task", project: "palot", updatedAt: 1 }],
      }),
    );
    expect(list.title).toBe("Mention a file, task or agent");
    expect(list.canGoBack).toBe(true);
    expect(list.sections.map((section) => section.label)).toEqual([
      "References",
      "Agents",
      "Files",
      "Tasks",
    ]);
    expect(titles(list.items)).toEqual(["@docs", "@explore", "app.ts", "main.ts", "Older task"]);
    expect(list.items[2]!.badge).toBe("Open");
  });

  it("keeps the previous search rows visible but not pickable while the next result loads", () => {
    const list = view(
      plus({ category: "mention", query: "mai" }),
      sources({
        agents: [agent("maintainer")],
        files: { paths: ["src/main.ts", "src/other.ts"], pending: true },
      }),
    );
    // Server rows are never dropped by the local match.
    expect(titles(list.items)).toEqual(["@maintainer", "main.ts", "other.ts"]);
    expect(list.items.filter((item) => item.disabled).map((item) => item.title)).toEqual([
      "main.ts",
      "other.ts",
    ]);
    expect(list.loading).toBe(true);
    expect(list.empty).toBeNull();
  });

  it("caps agents, references and tasks at ten and the category at twenty", () => {
    const list = view(
      plus({ category: "mention" }),
      sources({
        agents: Array.from({ length: 15 }, (_, index) => agent(`agent-${index}`)),
        tasks: Array.from({ length: 15 }, (_, index) => ({
          id: `ses_${index}`,
          title: `Task ${index}`,
          project: "palot",
          updatedAt: index,
        })),
      }),
    );
    expect(list.items.filter((item) => item.kind === "agent")).toHaveLength(10);
    expect(list.items.filter((item) => item.kind === "task")).toHaveLength(10);
    expect(list.items[10]!.title).toBe("Task 14");
  });

  it("offers recent outputs as mentions, and says why one outside the folder is not", () => {
    const list = view(
      plus({ category: "outputs" }),
      sources({
        outputs: outputs([
          { name: "a.ts", path: "a.ts", at: NOW - 120_000 },
          { name: "b.ts", path: null, at: NOW - 60_000 },
        ]),
      }),
    );
    // Only things to mention: opening the task an output came from is navigation.
    expect(titles(list.items)).toEqual(["b.ts", "a.ts"]);
    expect(list.items[0]).toMatchObject({ disabled: true, badge: "Changed" });
    expect(list.items[1]).toMatchObject({
      description: "a.ts · 2m ago",
      action: { type: "mention", mention: { kind: "file", path: "a.ts" } },
    });
  });

  it("restores stashed prompts and explains an empty category", () => {
    const list = view(
      plus({ category: "stash" }),
      sources({ stash: [stash("s1", "Refactor the queue\nmore", NOW - 3_600_000)] }),
    );
    expect(list.items[0]).toMatchObject({
      title: "Refactor the queue",
      description: "Stashed 1h ago",
      action: { type: "restore-stash", id: "s1" },
    });
    expect(view(plus({ category: "stash" }), sources()).empty).toBe(
      "No stashed prompts in this project.",
    );
  });

  it("shows loading and errors only for the sources the level needs", () => {
    const loading = sources({ loading: ["commands", "skills"] });
    expect(view(plus({ category: "commands" }), loading)).toMatchObject({
      loading: true,
      empty: null,
    });
    expect(view(plus({ category: "stash" }), loading).loading).toBe(false);
    const failed = sources({ errors: { files: "Could not search workspace files." } });
    expect(view(plus({ category: "mention" }), failed).error).toBe(
      "Could not search workspace files.",
    );
    expect(view(plus({ category: "commands" }), failed).error).toBeNull();
  });
});

describe("suggested", () => {
  const busy = sources({
    session: { contextPercent: 82.4, changedFiles: 3 },
    openFiles: ["src/open.ts"],
    outputs: outputs([
      { name: "old.ts", path: "old.ts", at: NOW - 600_000 },
      { name: "turn-boundary.ts", path: "lib/turn-boundary.ts", at: NOW - 180_000 },
    ]),
    stash: [stash("s1", "Older", NOW - 7_200_000), stash("s2", "Newest idea", NOW - 60_000)],
  });

  it("suggests review, compact, the latest file and the newest stash, four at most", () => {
    const root = view(plus(), busy);
    expect(root.sections.map((section) => section.label)).toEqual([null, "Suggested"]);
    expect(root.sections[1]!.items.map((item) => [item.title, item.description])).toEqual([
      ["Review changes", "3 files changed in the last turn"],
      ["Compact context", "82% full"],
      ["turn-boundary.ts", "Edited 3m ago · mention it"],
      ["Newest idea", "Stashed 1m ago · restore it"],
    ]);
  });

  it("compacts only from 70% and reviews only when the last turn changed files", () => {
    const quiet = sources({ session: { contextPercent: 69, changedFiles: 0 } });
    expect(launcherSuggestions({ sources: quiet, now: NOW })).toEqual([]);
    const full = sources({ session: { contextPercent: 70, changedFiles: 1 } });
    expect(titles(launcherSuggestions({ sources: full, now: NOW }))).toEqual([
      "Review changes",
      "Compact context",
    ]);
    expect(launcherSuggestions({ sources: full, now: NOW })[0]!.description).toBe(
      "1 file changed in the last turn",
    );
  });

  it("falls back to the open file, and a new task gets no task suggestions", () => {
    const fresh = sources({ newTask: true, openFiles: ["src/open.ts"] });
    expect(
      launcherSuggestions({ sources: fresh, now: NOW }).map((item) => item.description),
    ).toEqual(["Open in the workbench · mention it"]);
  });

  it("takes extra suggestion sources and stays within four rows", () => {
    const extra: LauncherSuggestionSource = () => [
      {
        id: "suggestion:intent",
        kind: "suggestion",
        title: "Continue",
        icon: "review",
        category: null,
        action: { type: "review-changes" },
      },
    ];
    const items = launcherSuggestions({ sources: busy, now: NOW }, [extra, () => [], extra]);
    expect(titles(items)).toEqual(["Continue"]);
    const root = buildLauncherView(plus(), busy, { now: NOW, suggestions: [extra] });
    expect(titles(root.sections[1]!.items)).toEqual(["Continue"]);
  });

  it("is not part of a query's results", () => {
    expect(
      view(plus({ query: "review" }), busy).items.some((item) => item.kind === "suggestion"),
    ).toBe(false);
  });
});

describe("stash preview", () => {
  it("shows a task mention as its title, not its session ID", () => {
    const id = "ses_0123456789abcdefABCDEFGHIJ";
    const mention = `@session:${id}`;
    const text = `Compare with ${mention} and ${mention}\nsecond line`;
    const first = text.indexOf(mention);
    const second = text.lastIndexOf(mention);
    const entry: StashedPrompt = {
      id: "s",
      createdAt: NOW,
      draft: {
        text,
        mentions: [
          {
            localID: "a",
            kind: "task",
            value: id,
            title: "Fix login",
            text: mention,
            start: first,
            end: first + mention.length,
          },
          {
            localID: "b",
            kind: "task",
            value: id,
            text: mention,
            start: second,
            end: second + mention.length,
          },
        ],
        command: null,
      },
      files: [],
    };
    expect(stashPreview(entry)).toBe(`Compare with @Fix login and @${id}`);
  });
});
