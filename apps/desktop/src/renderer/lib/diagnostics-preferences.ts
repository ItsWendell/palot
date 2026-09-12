export interface DiagnosticsPreferences {
  overlayVisible: boolean;
  reactScanEnabled: boolean | null;
}

interface StoredDiagnosticsPreferences {
  version: 1;
  value: DiagnosticsPreferences;
}

const STORAGE_KEY = "palot.desktop.state.diagnostics";
const DEFAULT_PREFERENCES: DiagnosticsPreferences = {
  overlayVisible: false,
  reactScanEnabled: null,
};
const listeners = new Set<() => void>();
let cachedRaw: string | null | undefined;
let cachedPreferences: DiagnosticsPreferences | null = null;

export function readDiagnosticsPreferences(): DiagnosticsPreferences {
  if (typeof window === "undefined") return { ...DEFAULT_PREFERENCES };
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (raw === cachedRaw && cachedPreferences) return cachedPreferences;
  try {
    const parsed = JSON.parse(raw ?? "null") as unknown;
    cachedRaw = raw;
    cachedPreferences = storedDiagnosticsPreferences(parsed)
      ? { ...parsed.value }
      : { ...DEFAULT_PREFERENCES };
  } catch {
    cachedRaw = raw;
    cachedPreferences = { ...DEFAULT_PREFERENCES };
  }
  return cachedPreferences;
}

export function updateDiagnosticsPreferences(
  update:
    | Partial<DiagnosticsPreferences>
    | ((current: DiagnosticsPreferences) => DiagnosticsPreferences),
): DiagnosticsPreferences {
  const current = readDiagnosticsPreferences();
  const next = typeof update === "function" ? update(current) : { ...current, ...update };
  const normalized: DiagnosticsPreferences = {
    overlayVisible: next.overlayVisible,
    reactScanEnabled: next.reactScanEnabled,
  };
  if (typeof window !== "undefined") {
    try {
      const stored: StoredDiagnosticsPreferences = { version: 1, value: normalized };
      const raw = JSON.stringify(stored);
      window.localStorage.setItem(STORAGE_KEY, raw);
      cachedRaw = raw;
      cachedPreferences = normalized;
    } catch {
      // The in-memory UI can continue when localStorage is unavailable.
      cachedRaw = undefined;
      cachedPreferences = normalized;
    }
  }
  for (const listener of listeners) listener();
  return normalized;
}

export function subscribeDiagnosticsPreferences(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function reactScanRequested(
  preferences = readDiagnosticsPreferences(),
  defaultEnabled = __PALOT_REACT_SCAN_DEFAULT__,
): boolean {
  return preferences.reactScanEnabled ?? defaultEnabled;
}

function storedDiagnosticsPreferences(value: unknown): value is StoredDiagnosticsPreferences {
  if (!value || typeof value !== "object") return false;
  const stored = value as Partial<StoredDiagnosticsPreferences>;
  if (stored.version !== 1 || !stored.value || typeof stored.value !== "object") return false;
  const preferences = stored.value as Partial<DiagnosticsPreferences>;
  return (
    typeof preferences.overlayVisible === "boolean" &&
    (preferences.reactScanEnabled === null || typeof preferences.reactScanEnabled === "boolean")
  );
}
