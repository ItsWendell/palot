// Adapted from OpenCode v2.0.14 (MIT), Copyright (c) 2025 opencode.
// https://github.com/anomalyco/opencode/blob/v2.0.14/packages/desktop/src/main/browser/restore.ts
import { Browser } from "@opencode/plugin-browser/rpc";
import Store from "electron-store";
import { Option, Schema } from "effect";

const MAX_TABS = 32;
const MAX_SESSIONS = 64;
const MAX_SNAPSHOT_BYTES = 128 * 1024;
const Stored = Schema.Struct({
  tabs: Schema.Array(Schema.Struct({ id: Browser.TabID, url: Browser.Tab.fields.url })),
  focusedTabID: Schema.NullOr(Browser.TabID),
});
export type SavedBrowserState = typeof Stored.Type;

type RestoreBackend = {
  get(key: "sessions"): unknown;
  set(key: "sessions", value: Record<string, unknown>): void;
};

function valid(value: unknown): SavedBrowserState | null {
  const decoded = Schema.decodeUnknownOption(Stored)(value);
  if (Option.isNone(decoded)) return null;
  const state = decoded.value;
  if (state.tabs.length > MAX_TABS || Buffer.byteLength(JSON.stringify(state)) > MAX_SNAPSHOT_BYTES)
    return null;
  if (new Set(state.tabs.map((tab) => tab.id)).size !== state.tabs.length) return null;
  return {
    tabs: state.tabs,
    focusedTabID: state.tabs.some((tab) => tab.id === state.focusedTabID)
      ? state.focusedTabID
      : null,
  };
}

/** The key uses stable profile and session IDs, never a connection ID or endpoint credentials. */
export function browserRestoreKey(profileID: string, sessionID: string): string {
  return JSON.stringify([profileID, sessionID]);
}

export function createBrowserRestoreStore(
  backend: RestoreBackend = new Store<{ sessions: Record<string, unknown> }>({
    name: "browser-restore",
  }),
) {
  const sessions = () => {
    const value = backend.get("sessions");
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  };
  return {
    load(key: string): SavedBrowserState {
      return valid(sessions()[key]) ?? { tabs: [], focusedTabID: null };
    },
    save(key: string, state: Browser.State) {
      // Retain a bounded number of URLs and sessions, even when the browser opens many tabs.
      const tabs = state.tabs.slice(0, MAX_TABS).map(({ id, url }) => ({ id, url }));
      let snapshot = valid({ tabs, focusedTabID: state.focusedTabID });
      while (!snapshot && tabs.length) {
        tabs.pop();
        snapshot = valid({ tabs, focusedTabID: state.focusedTabID });
      }
      if (!snapshot) return;
      const current = sessions();
      if (JSON.stringify(current[key]) === JSON.stringify(snapshot)) return;
      const entries = Object.entries(current)
        .filter(([id, value]) => id !== key && valid(value))
        .slice(-(MAX_SESSIONS - 1));
      backend.set("sessions", Object.fromEntries([...entries, [key, snapshot]]));
    },
    remove(key: string) {
      const current = sessions();
      if (!(key in current)) return;
      backend.set(
        "sessions",
        Object.fromEntries(Object.entries(current).filter(([id]) => id !== key)),
      );
    },
  };
}
