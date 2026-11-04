import {
  flushScheduledPersistedValues,
  loadScopedPersistedValue,
  scheduleScopedPersistedValue,
} from "../atoms/persisted";

/**
 * The last branch Palot saw for each directory, per server profile. Inbox rows show it for
 * directories the server has not loaded, so listing tasks never boots their locations.
 */
export interface RememberedBranch {
  /** `null` is a checkout without a current branch (detached HEAD). */
  branch: string | null;
  seenAt: number;
}

type Entries = Readonly<Record<string, RememberedBranch>>;

const FAMILY = "vcs.last-branch";
const MAX_PROFILES = 20;
export const MAX_REMEMBERED_BRANCHES = 500;
/** An unchanged branch only refreshes its recency this often, to bound storage writes. */
const RECENCY_REFRESH_MS = 60 * 60_000;

const loaded = new Map<string, Entries>();
const listeners = new Set<() => void>();
let version = 0;

function entry(value: unknown): value is RememberedBranch {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    (candidate.branch === null || typeof candidate.branch === "string") &&
    typeof candidate.seenAt === "number" &&
    Number.isFinite(candidate.seenAt)
  );
}

function validEntries(value: unknown): value is Entries {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.values(value as Record<string, unknown>).every(entry)
  );
}

function entries(profileID: string): Entries {
  let current = loaded.get(profileID);
  if (!current) {
    current = loadScopedPersistedValue<Entries>({
      family: FAMILY,
      scope: profileID,
      initialValue: {},
      validate: validEntries,
      maxEntries: MAX_PROFILES,
    });
    loaded.set(profileID, current);
  }
  return current;
}

export function rememberedBranch(
  profileID: string,
  directory: string,
): RememberedBranch | undefined {
  return entries(profileID)[directory];
}

export function rememberBranch(
  profileID: string,
  directory: string,
  branch: string | null,
  now = Date.now(),
): void {
  if (!profileID || !directory) return;
  const current = entries(profileID);
  const previous = current[directory];
  const changed = previous === undefined || previous.branch !== branch;
  if (previous && !changed && now - previous.seenAt < RECENCY_REFRESH_MS) return;
  let next: Record<string, RememberedBranch> = {
    ...current,
    [directory]: { branch, seenAt: now },
  };
  const keys = Object.keys(next);
  if (keys.length > MAX_REMEMBERED_BRANCHES) {
    const kept = keys
      .sort((a, b) => next[b]!.seenAt - next[a]!.seenAt)
      .slice(0, MAX_REMEMBERED_BRANCHES);
    next = Object.fromEntries(kept.map((key) => [key, next[key]!]));
  }
  loaded.set(profileID, next);
  scheduleScopedPersistedValue(FAMILY, profileID, next, MAX_PROFILES);
  if (changed) {
    version += 1;
    for (const listener of listeners) listener();
  }
}

export function subscribeBranchMemory(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function branchMemoryVersion(): number {
  return version;
}

export function resetBranchMemoryForTest(): void {
  flushScheduledPersistedValues();
  loaded.clear();
  version = 0;
}
