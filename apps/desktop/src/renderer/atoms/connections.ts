import { persistedAtom } from "./persisted";

/** Project IDs are server-local; collapse preferences must include their owner. */
export const overviewProjectSectionsAtom = persistedAtom({
  key: "connections.project-sections",
  initialValue: {} as Record<string, boolean>,
  validate: (value): value is Record<string, boolean> =>
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.entries(value).every(([key, open]) => key.length <= 2048 && typeof open === "boolean"),
});

const profileIDs = (value: unknown): value is string[] =>
  Array.isArray(value) &&
  value.length <= 100 &&
  new Set(value).size === value.length &&
  value.every((id) => typeof id === "string" && id.length > 0 && id.length <= 512);

/** Monitoring is independent of the sidebar's temporary visibility filter. */
export const includedProfileIDsAtom = persistedAtom({
  key: "connections.included-profiles",
  initialValue: [] as string[],
  validate: profileIDs,
});

export const visibleProfileIDsAtom = persistedAtom({
  key: "connections.visible-profiles",
  initialValue: null as string[] | null,
  validate: (value): value is string[] | null => value === null || profileIDs(value),
});

/** UI-only owner-qualified project key; never forwarded to an OpenCode operation. */
export const overviewProjectFilterAtom = persistedAtom({
  key: "connections.project-filter",
  initialValue: null as string | null,
  validate: (value): value is string | null =>
    value === null || (typeof value === "string" && value.length <= 2048),
});
