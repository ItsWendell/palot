/** Versioned, validated renderer persistence for desktop-owned state. */

import { atom } from "jotai";

const PERSISTENCE_NAMESPACE = "palot.desktop.state";
const PERSISTENCE_VERSION = 1;

interface ScheduledScopedValue {
  family: string;
  scope: string;
  value: unknown;
  maxEntries: number;
  baseValue: string | null | undefined;
}

// Keep the latest value in memory; serialize only once per bounded write window.
const scheduledValues = new Map<string, ScheduledScopedValue>();
let writeTimer: ReturnType<typeof setTimeout> | undefined;
let listening = false;
const scopedSubscribers = new Map<string, Set<() => void>>();
let storageListening = false;

function readRawValue(key: string): string | null | undefined {
  try {
    return window.localStorage.getItem(persistedStorageKey(key));
  } catch {
    return undefined;
  }
}

function discardStaleScheduledValue(key: string): void {
  const pending = scheduledValues.get(key);
  const current = readRawValue(key);
  if (
    pending &&
    pending.baseValue !== undefined &&
    current !== undefined &&
    current !== pending.baseValue
  ) {
    cancelScheduledValue(key);
  }
}

function onStorage(event: StorageEvent): void {
  if (event.storageArea !== window.localStorage) return;
  const prefix = `${PERSISTENCE_NAMESPACE}.`;
  if (event.key !== null && !event.key.startsWith(prefix)) return;
  const keys =
    event.key === null
      ? new Set([...scheduledValues.keys(), ...scopedSubscribers.keys()])
      : [event.key.slice(prefix.length)];
  for (const key of keys) {
    // Read current storage, not newValue: queued events may already be obsolete.
    if (event.newValue === null && readRawValue(key) === null) cancelScheduledValue(key);
    discardStaleScheduledValue(key);
    scopedSubscribers.get(key)?.forEach((notify) => notify());
  }
}

function updateStorageListener(): void {
  if (typeof window === "undefined") return;
  const needed = scheduledValues.size > 0 || scopedSubscribers.size > 0;
  if (needed === storageListening) return;
  storageListening = needed;
  if (needed) window.addEventListener("storage", onStorage);
  else window.removeEventListener("storage", onStorage);
}

/** Observe one scope without echoing remote changes back into storage. */
export function subscribeScopedPersistedValue(
  family: string,
  scope: string,
  notify: () => void,
): () => void {
  const key = scopedKey(family, scope);
  const subscribers = scopedSubscribers.get(key) ?? new Set<() => void>();
  subscribers.add(notify);
  scopedSubscribers.set(key, subscribers);
  updateStorageListener();
  return () => {
    subscribers.delete(notify);
    if (subscribers.size === 0) scopedSubscribers.delete(key);
    updateStorageListener();
  };
}

function flushWhenHidden(): void {
  if (document.visibilityState === "hidden") flushScheduledPersistedValues();
}

function stopScheduledWritesIfEmpty(): void {
  updateStorageListener();
  if (scheduledValues.size > 0) return;
  clearTimeout(writeTimer);
  writeTimer = undefined;
  if (!listening) return;
  window.removeEventListener("pagehide", flushScheduledPersistedValues);
  window.removeEventListener("beforeunload", flushScheduledPersistedValues);
  document.removeEventListener("visibilitychange", flushWhenHidden);
  listening = false;
}

export function flushScheduledPersistedValues(): void {
  clearTimeout(writeTimer);
  writeTimer = undefined;
  for (const [key, entry] of scheduledValues) {
    // Storage can change before its event is delivered (including during unload).
    discardStaleScheduledValue(key);
    if (!scheduledValues.has(key)) {
      scopedSubscribers.get(key)?.forEach((notify) => notify());
      continue;
    }
    // Failed storage writes remain available in memory and retry on the next write or flush.
    if (!savePersistedValue(key, entry.value)) continue;
    scheduledValues.delete(key);
    updateScopedRetention(entry.family, entry.scope, entry.maxEntries);
  }
  stopScheduledWritesIfEmpty();
}

export function scheduleScopedPersistedValue<T>(
  family: string,
  scope: string,
  value: T,
  maxEntries: number,
): void {
  if (typeof window === "undefined") return;
  // Map iteration follows edit recency, not the scope's first queued update.
  scheduledValues.delete(scopedKey(family, scope));
  scheduledValues.set(scopedKey(family, scope), {
    family,
    scope,
    value,
    maxEntries,
    baseValue: readRawValue(scopedKey(family, scope)),
  });
  updateStorageListener();
  if (!listening) {
    window.addEventListener("pagehide", flushScheduledPersistedValues);
    window.addEventListener("beforeunload", flushScheduledPersistedValues);
    document.addEventListener("visibilitychange", flushWhenHidden);
    listening = true;
  }
  if (document.visibilityState === "hidden") {
    flushScheduledPersistedValues();
    return;
  }
  // Do not reset on every edit: continuous typing must still reach storage.
  writeTimer ??= setTimeout(flushScheduledPersistedValues, 250);
}

function cancelScheduledValue(key: string): void {
  scheduledValues.delete(key);
  stopScheduledWritesIfEmpty();
}

type AtomUpdate<T> = T | ((previous: T) => T);

interface PersistedValue<T> {
  version: typeof PERSISTENCE_VERSION;
  value: T;
}

interface PersistedValueOptions<T> {
  key: string;
  initialValue: T;
  validate: (value: unknown) => value is T;
  legacyKeys?: string[];
  migrate?: (value: unknown, version: unknown) => T | undefined;
}

interface ScopedPersistenceOptions<T> extends Omit<PersistedValueOptions<T>, "key" | "legacyKeys"> {
  family: string;
  scope: string;
  maxEntries: number;
  legacyKeys?: string[];
}

export function persistedStorageKey(key: string): string {
  return `${PERSISTENCE_NAMESPACE}.${key}`;
}

export function persistedAtom<T>(options: PersistedValueOptions<T>) {
  const valueAtom = atom(loadPersistedValue(options));
  return atom(
    (get) => get(valueAtom),
    (get, set, update: AtomUpdate<T>) => {
      const next =
        typeof update === "function" ? (update as (previous: T) => T)(get(valueAtom)) : update;
      set(valueAtom, next);
      savePersistedValue(options.key, next);
    },
  );
}

export function loadPersistedValue<T>({
  key,
  initialValue,
  validate,
  legacyKeys = [],
  migrate,
}: PersistedValueOptions<T>): T {
  if (typeof window === "undefined") return initialValue;
  const currentKey = persistedStorageKey(key);
  for (const candidateKey of [currentKey, ...legacyKeys]) {
    const stored = readStoredValue(candidateKey);
    if (!stored) continue;
    const currentValue = stored.version === PERSISTENCE_VERSION && validate(stored.value);
    const value = currentValue ? stored.value : migrate?.(stored.value, stored.version);
    if (value === undefined || !validate(value)) continue;
    if (!currentValue || candidateKey !== currentKey) {
      savePersistedValue(key, value);
    }
    if (candidateKey !== currentKey) {
      removeStorageKey(candidateKey);
    }
    return value;
  }
  return initialValue;
}

export function savePersistedValue<T>(key: string, value: T): boolean {
  if (typeof window === "undefined") return false;
  try {
    const persisted: PersistedValue<T> = { version: PERSISTENCE_VERSION, value };
    window.localStorage.setItem(persistedStorageKey(key), JSON.stringify(persisted));
    return true;
  } catch {
    // In-memory state remains available when storage is unavailable.
    return false;
  }
}

export function removePersistedValue(key: string): void {
  cancelScheduledValue(key);
  removeStorageKey(persistedStorageKey(key));
}

export function loadScopedPersistedValue<T>(options: ScopedPersistenceOptions<T>): T {
  discardStaleScheduledValue(scopedKey(options.family, options.scope));
  const scheduled = scheduledValues.get(scopedKey(options.family, options.scope));
  if (scheduled && options.validate(scheduled.value)) return scheduled.value;
  return loadPersistedValue({
    ...options,
    key: scopedKey(options.family, options.scope),
  });
}

export function saveScopedPersistedValue<T>(
  family: string,
  scope: string,
  value: T,
  maxEntries: number,
): void {
  cancelScheduledValue(scopedKey(family, scope));
  savePersistedValue(scopedKey(family, scope), value);
  updateScopedRetention(family, scope, maxEntries);
}

export function removeScopedPersistedValue(family: string, scope: string): void {
  removePersistedValue(scopedKey(family, scope));
  const retentionKey = scopedRetentionKey(family);
  const retained = loadPersistedValue({
    key: retentionKey,
    initialValue: [] as string[],
    validate: stringArray,
  }).filter((candidate) => candidate !== scope);
  if (retained.length === 0) removePersistedValue(retentionKey);
  else savePersistedValue(retentionKey, retained);
}

/** Keep edits in memory and serialize the latest value once per bounded save window. */
export function scheduledScopedPersistence<T>(family: string, maxEntries: number) {
  return {
    save(scope: string, value: T) {
      scheduleScopedPersistedValue(family, scope, value, maxEntries);
    },
    remove(scope: string) {
      removeScopedPersistedValue(family, scope);
    },
    flush: flushScheduledPersistedValues,
  };
}

export function retainRecent<T>(values: readonly T[], maxEntries: number): T[] {
  return values.slice(-Math.max(0, maxEntries));
}

function updateScopedRetention(family: string, scope: string, maxEntries: number): void {
  const retentionKey = scopedRetentionKey(family);
  const retained = loadPersistedValue({
    key: retentionKey,
    initialValue: [] as string[],
    validate: stringArray,
  }).filter((candidate) => candidate !== scope);
  const next = retainRecent([...retained, scope], maxEntries);
  for (const evicted of retained) {
    // Retention only evicts stored data; a newer pending edit still needs its turn to flush.
    if (!next.includes(evicted)) {
      const key = scopedKey(family, evicted);
      removeStorageKey(persistedStorageKey(key));
      const pending = scheduledValues.get(key);
      if (pending) pending.baseValue = readRawValue(key);
    }
  }
  savePersistedValue(retentionKey, next);
}

function scopedKey(family: string, scope: string): string {
  return `${family}:${encodeURIComponent(scope)}`;
}

function scopedRetentionKey(family: string): string {
  return `${family}.__recent`;
}

function readStoredValue(key: string): { version: unknown; value: unknown } | null {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) ?? "null") as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const record = parsed as { version?: unknown; value?: unknown };
    return {
      version: record.version,
      value: Object.hasOwn(record, "value") ? record.value : parsed,
    };
  } catch {
    return null;
  }
}

function removeStorageKey(key: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Storage cleanup is best effort.
  }
}

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}
