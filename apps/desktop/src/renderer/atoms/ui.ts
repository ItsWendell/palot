import { atom } from "jotai";
import type { ModelRef } from "@opencode/client";
import type { SidebarMode } from "../../shared";
import {
  emptyComposerDraft,
  normalizeComposerDraft,
  type ComposerDraft,
} from "../lib/composer-draft";
import {
  DEFAULT_SESSION_PROJECTION_PREFERENCE,
  isSessionProjectionPreference,
  migrateSessionProjectionPreference,
  type SessionProjectionPreference,
} from "../lib/session-projection-policy";
import type { ModelPickerPreferences } from "../lib/model-preferences";
import type { InboxOrdering } from "../lib/session-inbox";
import { isUsageRangeDays, type UsageRangeDays } from "../lib/route-search";
import {
  loadPersistedValue,
  flushScheduledPersistedValues,
  loadScopedPersistedValue,
  persistedAtom,
  persistedStorageKey,
  removePersistedValue,
  removeScopedPersistedValue,
  saveScopedPersistedValue,
  scheduledScopedPersistence,
  subscribeScopedPersistedValue,
} from "./persisted";

const LEGACY_COMPOSER_DRAFT_STORAGE_KEY = "palot.composer.draft.v1";
const COMPOSER_DRAFT_STORAGE_KEY_PREFIX = "palot.composer.draft.v2:";
const MAX_PERSISTED_COMPOSER_DRAFTS = 100;
const MAX_PERSISTED_TURN_DISCLOSURES = 500;
const MAX_PERSISTED_ACTIVITY_DISCLOSURES = 1_000;
const MAX_COMPOSER_DRAFT_LENGTH = 100_000;

export type ComposerDelivery = "steer" | "queue";
export type DefaultWorkspaceMode = "worktree" | "current";
export type DefaultWorktreeBase = "repository-default" | "current";
export type DefaultSidebarMode = "remember" | SidebarMode;
export type InboxStateFilter = "attention" | "running" | "failed" | "unread";
export interface InboxFilters {
  projectID: string | null;
  states: InboxStateFilter[];
}
export interface InboxViewPreferences {
  ordering: InboxOrdering;
  unreadFirst: boolean;
  showSnoozed: boolean;
  showSettled: boolean;
}

export const navigationOpenAtom = persistedAtom({
  key: "ui.navigation-open",
  initialValue: true,
  validate: (value): value is boolean => typeof value === "boolean",
  legacyKeys: ["palot.ui.navigation-open.v1"],
});
export const commandPaletteOpenAtom = atom(false);
export const commandPaletteReturnFocusAtom = atom<HTMLElement | null>(null);
export const sidebarModeAtom = persistedAtom({
  key: "ui.sidebar-mode",
  initialValue: "inbox" as SidebarMode,
  validate: (value): value is SidebarMode => value === "project" || value === "inbox",
});
export const defaultSidebarModeAtom = persistedAtom({
  key: "ui.default-sidebar-mode",
  initialValue: "inbox" as DefaultSidebarMode,
  validate: (value): value is DefaultSidebarMode =>
    value === "remember" || value === "project" || value === "inbox",
});
export const inboxFiltersAtom = persistedAtom({
  key: "ui.inbox-filters",
  initialValue: { projectID: null, states: [] } as InboxFilters,
  validate: (value): value is InboxFilters => {
    if (!value || typeof value !== "object") return false;
    const filters = value as Partial<InboxFilters>;
    return (
      (filters.projectID === null || typeof filters.projectID === "string") &&
      Array.isArray(filters.states) &&
      filters.states.every(
        (state) =>
          state === "attention" || state === "running" || state === "failed" || state === "unread",
      )
    );
  },
});
export const inboxViewPreferencesAtom = persistedAtom({
  key: "ui.inbox-view-preferences",
  initialValue: {
    ordering: "newest",
    unreadFirst: false,
    showSnoozed: true,
    showSettled: true,
  } as InboxViewPreferences,
  validate: (value): value is InboxViewPreferences => {
    if (!value || typeof value !== "object") return false;
    const preferences = value as Partial<InboxViewPreferences>;
    return (
      (preferences.ordering === "newest" ||
        preferences.ordering === "oldest" ||
        preferences.ordering === "attention") &&
      typeof preferences.unreadFirst === "boolean" &&
      typeof preferences.showSnoozed === "boolean" &&
      typeof preferences.showSettled === "boolean"
    );
  },
});
export const inboxShelvesAtom = persistedAtom({
  key: "ui.inbox-shelves",
  initialValue: { pinned: true, inbox: true, snoozed: false, settled: false },
  validate: (
    value,
  ): value is { pinned: boolean; inbox: boolean; snoozed: boolean; settled: boolean } => {
    if (!value || typeof value !== "object") return false;
    const shelves = value as {
      pinned?: unknown;
      inbox?: unknown;
      snoozed?: unknown;
      settled?: unknown;
    };
    return (
      typeof shelves.pinned === "boolean" &&
      typeof shelves.inbox === "boolean" &&
      typeof shelves.snoozed === "boolean" &&
      typeof shelves.settled === "boolean"
    );
  },
  migrate: (value) => {
    if (!value || typeof value !== "object") return undefined;
    const shelves = value as { inbox?: unknown; snoozed?: unknown; settled?: unknown };
    if (typeof shelves.snoozed !== "boolean" || typeof shelves.settled !== "boolean") {
      return undefined;
    }
    return {
      pinned: true,
      inbox: typeof shelves.inbox === "boolean" ? shelves.inbox : true,
      snoozed: shelves.snoozed,
      settled: shelves.settled,
    };
  },
});
export const defaultDeliveryAtom = persistedAtom({
  key: "composer.default-delivery",
  initialValue: "queue" as ComposerDelivery,
  validate: (value): value is ComposerDelivery => value === "steer" || value === "queue",
  legacyKeys: ["palot.composer.default-delivery.v1"],
});
export const autoBackgroundOnSteerAtom = persistedAtom({
  key: "composer.auto-background-on-steer",
  initialValue: false,
  validate: (value): value is boolean => typeof value === "boolean",
});
export const defaultWorkspaceModeAtom = persistedAtom({
  key: "workspace.default-mode",
  initialValue: "worktree" as DefaultWorkspaceMode,
  validate: (value): value is DefaultWorkspaceMode => value === "worktree" || value === "current",
  legacyKeys: ["palot.workspace.default-mode.v1"],
});
export const defaultWorktreeBaseAtom = persistedAtom({
  key: "worktree.default-base",
  initialValue: "repository-default" as DefaultWorktreeBase,
  validate: (value): value is DefaultWorktreeBase =>
    value === "repository-default" || value === "current",
});
export const defaultModelsAtom = persistedAtom({
  key: "models.project-defaults",
  initialValue: {} as Record<string, ModelRef>,
  validate: (value): value is Record<string, ModelRef> => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    return Object.values(value).every(
      (model) =>
        model &&
        typeof model === "object" &&
        typeof model.id === "string" &&
        typeof model.providerID === "string" &&
        (model.variant === undefined || typeof model.variant === "string"),
    );
  },
  legacyKeys: ["palot.models.project-defaults.v1"],
});
export const modelPickerPreferencesAtom = persistedAtom({
  key: "models.picker-preferences",
  initialValue: {} as ModelPickerPreferences,
  validate: (value): value is ModelPickerPreferences => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    return Object.values(value).every((preference) => {
      if (!preference || typeof preference !== "object" || Array.isArray(preference)) return false;
      return (
        Array.isArray(preference.hidden) &&
        preference.hidden.every((key: unknown) => typeof key === "string") &&
        Array.isArray(preference.order) &&
        preference.order.every((key: unknown) => typeof key === "string")
      );
    });
  },
});
export const showTimelineCacheBustsAtom = persistedAtom({
  key: "timeline.show-likely-cache-busts",
  initialValue: false,
  validate: (value): value is boolean => typeof value === "boolean",
});
export const remoteMarkdownFaviconsAtom = persistedAtom({
  key: "markdown.remote-favicons",
  initialValue: false,
  validate: (value): value is boolean => typeof value === "boolean",
});
export const usageRangeAtom = persistedAtom({
  key: "usage.range-days",
  initialValue: 7 as UsageRangeDays,
  validate: (value): value is UsageRangeDays =>
    typeof value === "number" && isUsageRangeDays(value),
});
export const usageToolDetailsOpenAtom = persistedAtom({
  key: "usage.tool-details-open",
  initialValue: false,
  validate: (value): value is boolean => typeof value === "boolean",
});
export const sessionProjectionPreferenceAtom = persistedAtom({
  key: "timeline.projection",
  initialValue: DEFAULT_SESSION_PROJECTION_PREFERENCE as SessionProjectionPreference,
  validate: isSessionProjectionPreference,
  legacyKeys: [persistedStorageKey("timeline.compact-tools"), "palot.timeline.compact-tools.v1"],
  migrate: migrateSessionProjectionPreference,
});

const turnActivityOpenAtoms = new Map<string, ReturnType<typeof createTurnActivityOpenAtom>>();

function createTurnActivityOpenAtom(scope: string) {
  const valueAtom = atom(
    loadScopedPersistedValue({
      family: "timeline.turn-open",
      scope,
      maxEntries: MAX_PERSISTED_TURN_DISCLOSURES,
      initialValue: null as boolean | null,
      validate: (value): value is boolean | null => value === null || typeof value === "boolean",
    }),
  );
  return atom(
    (get) => get(valueAtom),
    (_get, set, value: boolean | null) => {
      set(valueAtom, value);
      if (value === null) removeScopedPersistedValue("timeline.turn-open", scope);
      else
        saveScopedPersistedValue(
          "timeline.turn-open",
          scope,
          value,
          MAX_PERSISTED_TURN_DISCLOSURES,
        );
    },
  );
}

export function turnActivityOpenAtomFamily(sessionID: string, turnID: string) {
  const scope = `${sessionID}:${turnID}`;
  const cached = turnActivityOpenAtoms.get(scope);
  if (cached) return cached;
  const disclosureAtom = createTurnActivityOpenAtom(scope);
  turnActivityOpenAtoms.set(scope, disclosureAtom);
  if (turnActivityOpenAtoms.size > MAX_PERSISTED_TURN_DISCLOSURES) {
    const oldest = turnActivityOpenAtoms.keys().next().value;
    if (oldest) turnActivityOpenAtoms.delete(oldest);
  }
  return disclosureAtom;
}

const activityGroupOpenAtoms = new Map<string, ReturnType<typeof createActivityGroupOpenAtom>>();

function createActivityGroupOpenAtom(scope: string) {
  const valueAtom = atom(
    loadScopedPersistedValue({
      family: "timeline.activity-open",
      scope,
      maxEntries: MAX_PERSISTED_ACTIVITY_DISCLOSURES,
      initialValue: null as boolean | null,
      validate: (value): value is boolean | null => value === null || typeof value === "boolean",
    }),
  );
  return atom(
    (get) => get(valueAtom),
    (_get, set, value: boolean | null) => {
      set(valueAtom, value);
      if (value === null) removeScopedPersistedValue("timeline.activity-open", scope);
      else
        saveScopedPersistedValue(
          "timeline.activity-open",
          scope,
          value,
          MAX_PERSISTED_ACTIVITY_DISCLOSURES,
        );
    },
  );
}

export function activityGroupOpenAtomFamily(sessionID: string, groupID: string) {
  const scope = `${sessionID}:${groupID}`;
  const cached = activityGroupOpenAtoms.get(scope);
  if (cached) return cached;
  const disclosureAtom = createActivityGroupOpenAtom(scope);
  activityGroupOpenAtoms.set(scope, disclosureAtom);
  if (activityGroupOpenAtoms.size > MAX_PERSISTED_ACTIVITY_DISCLOSURES) {
    const oldest = activityGroupOpenAtoms.keys().next().value;
    if (oldest) activityGroupOpenAtoms.delete(oldest);
  }
  return disclosureAtom;
}
export const draftAtom = persistedAtom({
  key: "composer.legacy-draft",
  initialValue: "",
  validate: (value): value is string =>
    typeof value === "string" && value.length <= MAX_COMPOSER_DRAFT_LENGTH,
  legacyKeys: [LEGACY_COMPOSER_DRAFT_STORAGE_KEY],
});
export function isComposerDraft(value: unknown): value is ComposerDraft {
  if (!value || typeof value !== "object") return false;
  const draft = value as Partial<ComposerDraft>;
  if (typeof draft.text !== "string" || draft.text.length > MAX_COMPOSER_DRAFT_LENGTH) return false;
  if (!Array.isArray(draft.mentions)) return false;
  if (
    !draft.mentions.every(
      (mention) =>
        mention &&
        typeof mention === "object" &&
        typeof mention.localID === "string" &&
        (mention.kind === "file" || mention.kind === "skill") &&
        typeof mention.value === "string" &&
        typeof mention.text === "string" &&
        Number.isInteger(mention.start) &&
        Number.isInteger(mention.end),
    )
  ) {
    return false;
  }
  return (
    draft.command === null ||
    (typeof draft.command === "object" &&
      typeof draft.command.name === "string" &&
      Number.isInteger(draft.command.start) &&
      Number.isInteger(draft.command.end))
  );
}

function loadComposerDraft(scopeKey: string): ComposerDraft {
  const stored = loadScopedPersistedValue({
    family: "composer.draft",
    scope: scopeKey,
    maxEntries: MAX_PERSISTED_COMPOSER_DRAFTS,
    initialValue: emptyComposerDraft(),
    validate: isComposerDraft,
    legacyKeys: [`${COMPOSER_DRAFT_STORAGE_KEY_PREFIX}${encodeURIComponent(scopeKey)}`],
  });
  if (stored.text || stored.mentions.length > 0 || stored.command)
    return normalizeComposerDraft(stored);

  const legacy = loadPersistedValue({
    key: "composer.legacy-draft",
    initialValue: "",
    validate: (value): value is string =>
      typeof value === "string" && value.length <= MAX_COMPOSER_DRAFT_LENGTH,
    legacyKeys: [LEGACY_COMPOSER_DRAFT_STORAGE_KEY],
  });
  if (!legacy) return stored;
  const migrated = { ...emptyComposerDraft(), text: legacy };
  saveScopedPersistedValue("composer.draft", scopeKey, migrated, MAX_PERSISTED_COMPOSER_DRAFTS);
  removePersistedValue("composer.legacy-draft");
  return migrated;
}

const composerDraftPersistence = scheduledScopedPersistence<ComposerDraft>(
  "composer.draft",
  MAX_PERSISTED_COMPOSER_DRAFTS,
);

export const flushComposerDrafts = composerDraftPersistence.flush;

function persistComposerDraft(scopeKey: string, draft: ComposerDraft): void {
  if (draft.text.length === 0 && draft.mentions.length === 0 && draft.command === null) {
    composerDraftPersistence.remove(scopeKey);
    return;
  }
  composerDraftPersistence.save(scopeKey, draft);
}

const composerDraftAtoms = new Map<string, ReturnType<typeof createComposerDraftAtom>>();

function createComposerDraftAtom(scopeKey: string) {
  const valueAtom = atom(loadComposerDraft(scopeKey));
  valueAtom.onMount = (setValue) => {
    const refresh = () => {
      const next = normalizeComposerDraft(loadComposerDraft(scopeKey));
      // Equivalent storage events must not reset the editor's local selection.
      setValue((previous) => (JSON.stringify(previous) === JSON.stringify(next) ? previous : next));
    };
    const unsubscribe = subscribeScopedPersistedValue("composer.draft", scopeKey, refresh);
    // Cached atoms can have missed changes while their composer was unmounted.
    refresh();
    return () => {
      unsubscribe();
      flushScheduledPersistedValues();
    };
  };
  return atom(
    (get) => get(valueAtom),
    (get, set, update: ComposerDraft | ((previous: ComposerDraft) => ComposerDraft)) => {
      const next = typeof update === "function" ? update(get(valueAtom)) : update;
      const normalized = normalizeComposerDraft(next);
      set(valueAtom, normalized);
      persistComposerDraft(scopeKey, normalized);
    },
  );
}

/** Pass a captured composerScope so async completions keep writing to their original profile. */
export function composerDraftAtomFamily(scopeKey: string) {
  const cached = composerDraftAtoms.get(scopeKey);
  if (cached) return cached;
  const composerDraftAtom = createComposerDraftAtom(scopeKey);
  composerDraftAtoms.set(scopeKey, composerDraftAtom);
  return composerDraftAtom;
}
