import type { PalotMessageContent } from "../../shared";
import { projectToolExecution } from "./tool-executions";

export const ACTIVITY_CATEGORIES = [
  "reasoning",
  "read",
  "code-search",
  "edit",
  "command",
  "web",
  "delegation",
  "other",
] as const;

export type ActivityCategory = (typeof ACTIVITY_CATEGORIES)[number];
export type SessionProjectionPreset = "code-focus" | "compact" | "expanded";
export type ActivityPresentation = "individual" | "grouped" | "hidden";
export type DetailDefault = "collapsed" | "expanded";
export type FoldedTurnPlacement = "inside" | "pinned";
export type GroupTitleMode = "summary" | "latest-reasoning";

export interface ActivityProjectionPreference {
  presentation: ActivityPresentation;
  details: DetailDefault;
  foldedTurn: FoldedTurnPlacement;
}

export interface SessionProjectionPreference {
  version: 2;
  preset: SessionProjectionPreset;
  foldCompletedTurns?: boolean;
  groupTitle?: GroupTitleMode;
  groupSameFileReads?: boolean;
  showReasoningSummaries?: boolean;
  keepCurrentActivityExpanded?: boolean;
  categories?: Partial<Record<ActivityCategory, Partial<ActivityProjectionPreference>>>;
}

export interface ResolvedSessionProjectionPolicy {
  foldCompletedTurns: boolean;
  groupTitle: GroupTitleMode;
  groupSameFileReads: boolean;
  showReasoningSummaries: boolean;
  keepCurrentActivityExpanded: boolean;
  categories: Record<ActivityCategory, ActivityProjectionPreference>;
}

const grouped: ActivityProjectionPreference = {
  presentation: "grouped",
  details: "collapsed",
  foldedTurn: "inside",
};

const individual: ActivityProjectionPreference = {
  presentation: "individual",
  details: "expanded",
  foldedTurn: "inside",
};

const individualDelegation: ActivityProjectionPreference = {
  presentation: "individual",
  details: "collapsed",
  foldedTurn: "pinned",
};

export const SESSION_PROJECTION_PRESETS: Record<
  SessionProjectionPreset,
  ResolvedSessionProjectionPolicy
> = {
  "code-focus": {
    foldCompletedTurns: true,
    groupTitle: "summary",
    groupSameFileReads: true,
    showReasoningSummaries: false,
    keepCurrentActivityExpanded: false,
    categories: {
      reasoning: grouped,
      read: grouped,
      "code-search": grouped,
      edit: grouped,
      command: grouped,
      web: grouped,
      delegation: individualDelegation,
      other: grouped,
    },
  },
  compact: {
    foldCompletedTurns: true,
    groupTitle: "summary",
    groupSameFileReads: true,
    showReasoningSummaries: true,
    keepCurrentActivityExpanded: true,
    categories: {
      reasoning: grouped,
      read: grouped,
      "code-search": grouped,
      edit: grouped,
      command: grouped,
      web: grouped,
      delegation: individualDelegation,
      other: grouped,
    },
  },
  expanded: {
    foldCompletedTurns: false,
    groupTitle: "summary",
    groupSameFileReads: false,
    showReasoningSummaries: true,
    keepCurrentActivityExpanded: true,
    categories: {
      reasoning: { ...individual, details: "expanded" },
      read: { ...individual, details: "collapsed" },
      "code-search": { ...individual, details: "collapsed" },
      edit: { ...individual, details: "collapsed" },
      command: { ...individual, details: "collapsed" },
      web: { ...individual, details: "collapsed" },
      delegation: individualDelegation,
      other: { ...individual, details: "collapsed" },
    },
  },
};

export const DEFAULT_SESSION_PROJECTION_PREFERENCE: SessionProjectionPreference = {
  version: 2,
  preset: "compact",
};

export function resolveSessionProjectionPreference(
  preference: SessionProjectionPreference,
): ResolvedSessionProjectionPolicy {
  const preset = SESSION_PROJECTION_PRESETS[preference.preset];
  return {
    foldCompletedTurns: preference.foldCompletedTurns ?? preset.foldCompletedTurns,
    groupTitle: preference.groupTitle ?? preset.groupTitle,
    groupSameFileReads: preference.groupSameFileReads ?? preset.groupSameFileReads,
    showReasoningSummaries: preference.showReasoningSummaries ?? preset.showReasoningSummaries,
    keepCurrentActivityExpanded:
      preference.keepCurrentActivityExpanded ?? preset.keepCurrentActivityExpanded,
    categories: Object.fromEntries(
      ACTIVITY_CATEGORIES.map((category) => [
        category,
        { ...preset.categories[category], ...preference.categories?.[category] },
      ]),
    ) as ResolvedSessionProjectionPolicy["categories"],
  };
}

export function isSessionProjectionPreference(
  value: unknown,
): value is SessionProjectionPreference {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const preference = value as Partial<SessionProjectionPreference>;
  if (
    preference.version !== 2 ||
    !["code-focus", "compact", "expanded"].includes(preference.preset ?? "") ||
    (preference.foldCompletedTurns !== undefined &&
      typeof preference.foldCompletedTurns !== "boolean") ||
    (preference.groupTitle !== undefined &&
      !["summary", "latest-reasoning"].includes(preference.groupTitle)) ||
    (preference.groupSameFileReads !== undefined &&
      typeof preference.groupSameFileReads !== "boolean") ||
    (preference.showReasoningSummaries !== undefined &&
      typeof preference.showReasoningSummaries !== "boolean") ||
    (preference.keepCurrentActivityExpanded !== undefined &&
      typeof preference.keepCurrentActivityExpanded !== "boolean")
  ) {
    return false;
  }
  if (preference.categories === undefined) return true;
  if (!preference.categories || typeof preference.categories !== "object") return false;
  return Object.entries(preference.categories).every(([category, rule]) => {
    if (!ACTIVITY_CATEGORIES.includes(category as ActivityCategory)) return false;
    if (!rule || typeof rule !== "object" || Array.isArray(rule)) return false;
    const candidate = rule as Partial<ActivityProjectionPreference>;
    return (
      (candidate.presentation === undefined ||
        ["individual", "grouped", "hidden"].includes(candidate.presentation)) &&
      (candidate.details === undefined || ["collapsed", "expanded"].includes(candidate.details)) &&
      (candidate.foldedTurn === undefined || ["inside", "pinned"].includes(candidate.foldedTurn))
    );
  });
}

export function migrateSessionProjectionPreference(
  value: unknown,
  _version?: unknown,
): SessionProjectionPreference | undefined {
  if (value === true) return { version: 2, preset: "compact" };
  if (value === false) return { version: 2, preset: "expanded" };
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const previous = value as Partial<Omit<SessionProjectionPreference, "version">> & {
      version?: unknown;
    };
    if (
      previous.version === 1 &&
      ["code-focus", "compact", "expanded"].includes(previous.preset ?? "")
    ) {
      return {
        ...previous,
        version: 2,
        preset: previous.preset as SessionProjectionPreset,
      };
    }
  }
  return undefined;
}

export function activityCategory(part: PalotMessageContent, index: number): ActivityCategory {
  if (part.type === "reasoning") return "reasoning";
  if (part.type !== "tool") return "other";
  const execution = projectToolExecution(part, index);
  switch (execution.kind) {
    case "read":
    case "list":
    case "skill":
      return "read";
    case "search":
      return "code-search";
    case "file-change":
      return "edit";
    case "shell":
      return "command";
    case "web-search":
    case "web-fetch":
      return "web";
    case "subagent":
      return "delegation";
    case "execute":
    case "image-generation":
    case "generic":
      return "other";
  }
}
