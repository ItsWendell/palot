/**
 * What the launcher shows for a state: ranking, per-kind caps, grouping and the "Suggested"
 * rules over the items `launcher-items.ts` builds. Pure, so the list, the key handling and the
 * tests agree.
 */

import type { StashedPrompt } from "../../lib/prompt-stash";
import type { RecentProjectOutputTask } from "../../lib/recent-project-outputs";
import {
  CATEGORY_TITLES,
  LAUNCHER_CATEGORIES,
  basename,
  categoryItems,
  rootItems,
  stashPreview,
  timeAgo,
  type LauncherAction,
  type LauncherCategory,
  type LauncherIcon,
  type LauncherItem,
  type LauncherItemKind,
  type LauncherSection,
  type LauncherSourceID,
  type LauncherSources,
} from "./launcher-items";
import { canGoBack, type LauncherState } from "./launcher-state";

const MAX_ROOT_RESULTS = 8;
const MAX_CATEGORY_RESULTS = 20;
/** Today's per-kind caps for `@` sources other than workspace search. */
const MAX_MENTIONS_PER_KIND = 10;
const MAX_SUGGESTIONS = 4;
const COMPACT_SUGGESTION_PERCENT = 70;

const KIND_GROUP: Record<LauncherItemKind, string> = {
  category: "Categories",
  attach: "Actions",
  shell: "Actions",
  "send-to-models": "Actions",
  output: "Recent outputs",
  stash: "Stashed prompts",
  command: "Commands",
  skill: "Skills",
  file: "Files",
  task: "Tasks",
  agent: "Agents",
  reference: "References",
  approval: "Approvals",
  review: "Review",
  suggestion: "Suggested",
};

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/^[/@$]+/, "")
    .trim();
}

/**
 * How well an item matches: 0 title prefix, 1 a word in the title starts with the query,
 * 2 title substring, 3 description or keyword substring; null when nothing matches.
 */
export function matchTier(
  item: Pick<LauncherItem, "title" | "description" | "keywords">,
  query: string,
): number | null {
  const needle = normalize(query);
  if (!needle) return 0;
  const title = normalize(item.title);
  if (title.startsWith(needle)) return 0;
  if (title.split(/[\s/._:-]+/).some((word) => word.startsWith(needle))) return 1;
  if (title.includes(needle)) return 2;
  const extra = [item.description, ...(item.keywords ?? [])];
  return extra.some((value) => value?.toLowerCase().includes(needle)) ? 3 : null;
}

/** Today's `/` ranking: name prefix, then name contains, then description contains. */
function commandTier(
  item: Pick<LauncherItem, "title" | "description">,
  query: string,
): number | null {
  const needle = normalize(query);
  const name = normalize(item.title);
  if (name.startsWith(needle)) return 0;
  if (name.includes(needle)) return 1;
  return item.description?.toLowerCase().includes(needle) ? 2 : null;
}

/** Workspace search already matched these rows; they rank after the local matches. */
const SERVER_MATCH_TIER = 2;

export function rankItems(
  items: readonly LauncherItem[],
  query: string,
  tier: (item: LauncherItem, query: string) => number | null = matchTier,
): LauncherItem[] {
  return (
    items
      .flatMap((item, order) => {
        const local = tier(item, query);
        // Server search matches fuzzily; never drop what it returned.
        const score = item.preMatched
          ? Math.min(local ?? SERVER_MATCH_TIER, SERVER_MATCH_TIER)
          : local;
        return score === null ? [] : [{ item, order, score }];
      })
      // Each source lists one kind contiguously, so comparing recency only within a kind
      // keeps the order consistent.
      .toSorted(
        (left, right) =>
          left.score - right.score ||
          (left.item.kind === right.item.kind
            ? (right.item.recency ?? 0) - (left.item.recency ?? 0)
            : 0) ||
          left.order - right.order,
      )
      .map((entry) => entry.item)
  );
}

/** At most `cap` rows of each kind, keeping order. */
function capPerKind(items: readonly LauncherItem[], cap: number, kinds: ReadonlySet<string>) {
  const counts = new Map<string, number>();
  return items.filter((item) => {
    if (!kinds.has(item.kind)) return true;
    const count = (counts.get(item.kind) ?? 0) + 1;
    counts.set(item.kind, count);
    return count <= cap;
  });
}

/**
 * Groups a ranked list by kind, in order of each group's best row. Labels appear only when
 * kinds mix; a single kind is one unlabelled section.
 */
function groupItems(items: readonly LauncherItem[], idPrefix: string): LauncherSection[] {
  const groups = new Map<string, LauncherItem[]>();
  for (const item of items) {
    const label = KIND_GROUP[item.kind];
    const group = groups.get(label);
    if (group) group.push(item);
    else groups.set(label, [item]);
  }
  if (groups.size === 0) return [];
  if (groups.size === 1) return [{ id: `${idPrefix}:all`, label: null, items: [...items] }];
  return Array.from(groups, ([label, rows]) => ({
    id: `${idPrefix}:${label}`,
    label,
    items: rows,
  }));
}

/* Suggested */

interface LauncherSuggestionInput {
  sources: LauncherSources;
  now: number;
}

/**
 * One rule for "Suggested": deterministic, cheap, from state the app already has. A later
 * source (intent-based suggestions) plugs in beside these.
 */
export type LauncherSuggestionSource = (input: LauncherSuggestionInput) => readonly LauncherItem[];

function suggestion(
  id: string,
  title: string,
  description: string,
  icon: LauncherIcon,
  action: LauncherAction,
): LauncherItem {
  return {
    id: `suggestion:${id}`,
    kind: "suggestion",
    title,
    description,
    icon,
    category: null,
    action,
  };
}

const reviewChangesSuggestion: LauncherSuggestionSource = ({ sources }) => {
  const changed = sources.session?.changedFiles ?? 0;
  if (changed <= 0) return [];
  const files = changed === 1 ? "1 file" : `${changed} files`;
  return [
    suggestion("review", "Review changes", `${files} changed in the last turn`, "review", {
      type: "review-changes",
    }),
  ];
};

const compactContextSuggestion: LauncherSuggestionSource = ({ sources }) => {
  const percent = sources.session?.contextPercent;
  if (percent == null || percent < COMPACT_SUGGESTION_PERCENT) return [];
  return [
    suggestion("compact", "Compact context", `${Math.round(percent)}% full`, "compact", {
      type: "command",
      name: "compact",
    }),
  ];
};

/** The most recently edited file (a recent output here), else the active open file. */
const recentFileSuggestion: LauncherSuggestionSource = ({ sources, now }) => {
  const edited = sources.outputs
    .flatMap((group) => group.outputs)
    .filter((output) => output.path !== null)
    .reduce<RecentProjectOutputTask["outputs"][number] | null>(
      (newest, output) => (!newest || output.at > newest.at ? output : newest),
      null,
    );
  if (edited?.path) {
    return [
      suggestion(
        "recent-file",
        edited.name,
        `Edited ${timeAgo(edited.at, now)} · mention it`,
        "file",
        { type: "mention", mention: { kind: "file", path: edited.path } },
      ),
    ];
  }
  const open = sources.openFiles[0];
  if (!open) return [];
  return [
    suggestion("recent-file", basename(open), "Open in the workbench · mention it", "file", {
      type: "mention",
      mention: { kind: "file", path: open },
    }),
  ];
};

const newestStashSuggestion: LauncherSuggestionSource = ({ sources, now }) => {
  const newest = sources.stash.reduce<StashedPrompt | null>(
    (best, entry) => (!best || entry.createdAt > best.createdAt ? entry : best),
    null,
  );
  if (!newest) return [];
  return [
    suggestion(
      "stash",
      stashPreview(newest),
      `Stashed ${timeAgo(newest.createdAt, now)} · restore it`,
      "stash",
      { type: "restore-stash", id: newest.id },
    ),
  ];
};

const DEFAULT_SUGGESTION_SOURCES: readonly LauncherSuggestionSource[] = [
  reviewChangesSuggestion,
  compactContextSuggestion,
  recentFileSuggestion,
  newestStashSuggestion,
];

export function launcherSuggestions(
  input: LauncherSuggestionInput,
  rules: readonly LauncherSuggestionSource[] = DEFAULT_SUGGESTION_SOURCES,
): LauncherItem[] {
  const seen = new Set<string>();
  const items: LauncherItem[] = [];
  for (const rule of rules) {
    for (const item of rule(input)) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      items.push(item);
      if (items.length === MAX_SUGGESTIONS) return items;
    }
  }
  return items;
}

/* The view */

export interface LauncherView {
  /** The open category's title; null at the root. */
  title: string | null;
  canGoBack: boolean;
  sections: LauncherSection[];
  /** Every row in visual order, for keyboard movement and `aria-activedescendant`. */
  items: LauncherItem[];
  /** A source this view needs is still loading. */
  loading: boolean;
  error: string | null;
  /** Shown when nothing is listed and nothing is loading. */
  empty: string | null;
  /** One line above the rows about the level's state (Custom approvals). */
  notice: string | null;
  /** Preview of the draft `+` set aside. */
  keptDraft: string | null;
}

const EMPTY_CATEGORY: Record<LauncherCategory, string> = {
  outputs: "No recent outputs in loaded tasks of this project.",
  stash: "No stashed prompts in this project.",
  commands: "No commands available.",
  skills: "No skills in this project.",
  mention: "Nothing to mention yet.",
  approvals: "Approvals can't be changed here.",
  review: "Nothing to review here.",
};

const CATEGORY_SOURCES: Record<LauncherCategory, readonly LauncherSourceID[]> = {
  outputs: [],
  stash: [],
  commands: ["commands"],
  skills: ["skills"],
  mention: ["mention", "files"],
  approvals: [],
  review: [],
};

const ROOT_QUERY_SOURCES: readonly LauncherSourceID[] = ["commands", "skills", "mention", "files"];

interface LauncherViewOptions {
  now: number;
  suggestions?: readonly LauncherSuggestionSource[];
}

export function buildLauncherView(
  state: LauncherState,
  sources: LauncherSources,
  options: LauncherViewOptions,
): LauncherView {
  const open = state.status === "open" ? state : null;
  const category = open?.category ?? null;
  const query = open?.query.trim() ?? "";
  let sections: LauncherSection[];
  let relevant: readonly LauncherSourceID[] = [];

  if (category) {
    relevant = CATEGORY_SOURCES[category];
    const all = categoryItems(category, sources, options.now);
    const ranked = rankItems(all, query, category === "commands" ? commandTier : matchTier);
    const capped =
      category === "mention"
        ? capPerKind(ranked, MAX_MENTIONS_PER_KIND, new Set(["reference", "agent", "task"]))
        : ranked;
    sections = groupItems(capped.slice(0, MAX_CATEGORY_RESULTS), category);
  } else if (query) {
    relevant = ROOT_QUERY_SOURCES;
    const everything = [
      ...rootItems(sources),
      ...LAUNCHER_CATEGORIES.flatMap((id) => categoryItems(id, sources, options.now)),
    ];
    sections = groupItems(rankItems(everything, query).slice(0, MAX_ROOT_RESULTS), "search");
  } else {
    const suggested = launcherSuggestions({ sources, now: options.now }, options.suggestions);
    sections = [
      { id: "root", label: null, items: rootItems(sources) },
      ...(suggested.length ? [{ id: "suggested", label: "Suggested", items: suggested }] : []),
    ];
  }

  const items = sections.flatMap((section) => section.items);
  const loading =
    relevant.some((source) => sources.loading.includes(source)) ||
    (relevant.includes("files") && sources.files.pending);
  const error = relevant.map((source) => sources.errors[source]).find((message) => message) ?? null;
  return {
    title: category ? CATEGORY_TITLES[category] : null,
    canGoBack: canGoBack(state),
    sections,
    items,
    loading,
    error,
    empty:
      items.length || loading
        ? null
        : query
          ? `Nothing matches “${open?.query.trim()}”`
          : category
            ? EMPTY_CATEGORY[category]
            : null,
    keptDraft: open?.keptDraft ?? null,
    notice:
      category === "approvals" && sources.approvals?.mode === "custom"
        ? "Custom session rules are active. Choosing a preset replaces them."
        : category === "review" && !sources.review?.instructions.length
          ? "Save instructions you reuse under Settings → General → Review instructions."
          : null,
  };
}
