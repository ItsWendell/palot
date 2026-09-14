import { atom } from "jotai";
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

/** Distinguish first discovery from an explicitly disabled server, including after reload. */
export const discoveredProfileIDsAtom = persistedAtom({
  key: "connections.discovered-profiles",
  initialValue: null as string[] | null,
  validate: (value): value is string[] | null => value === null || profileIDs(value),
});

export const disabledProfileIDsAtom = atom((get) =>
  (get(discoveredProfileIDsAtom) ?? []).filter((id) => !get(includedProfileIDsAtom).includes(id)),
);

export const discoverProfilesAtom = atom(
  null,
  (get, set, { ids, activeProfileID }: { ids: string[]; activeProfileID: string | null }) => {
    const known = get(discoveredProfileIDsAtom);
    const included = get(includedProfileIDsAtom);
    const added =
      known === null
        ? ids.filter((id) => id === activeProfileID)
        : ids.filter((id) => !known.includes(id));
    const next = [
      ...included.filter((id) => ids.includes(id)),
      ...added.filter((id) => !included.includes(id)),
    ];
    if (next.length !== included.length || next.some((id, index) => id !== included[index]))
      set(includedProfileIDsAtom, next);
    if (known === null || known.length !== ids.length || ids.some((id) => !known.includes(id)))
      set(discoveredProfileIDsAtom, ids);
  },
);

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
