import { atom } from "jotai";
import type { OpenCodeConnectInput, OpenCodeRuntimeStatus, PalotMessage } from "../../shared";
import { persistedAtom, retainRecent } from "./persisted";

const MAX_PERSISTED_INSPECTOR_SESSIONS = 100;

const nullableIdentifier = (value: unknown): value is string | null =>
  value === null || (typeof value === "string" && value.length > 0 && value.length <= 512);

const inspectorSessionIDs = (value: unknown): value is string[] =>
  Array.isArray(value) &&
  value.length <= MAX_PERSISTED_INSPECTOR_SESSIONS &&
  new Set(value).size === value.length &&
  value.every((sessionID) => nullableIdentifier(sessionID) && sessionID !== null);

export const runtimeAtom = atom<OpenCodeRuntimeStatus | null>(null);
export const phaseAtom = atom<"loading" | "ready" | "error">("loading");
export const errorAtom = atom<string | null>(null);
export const workspaceRecoveryAtom = atom<{
  run(input?: OpenCodeConnectInput): Promise<void>;
} | null>(null);
export const selectedSessionIDAtom = persistedAtom({
  key: "workspace.selected-session",
  initialValue: null as string | null,
  validate: nullableIdentifier,
  legacyKeys: ["palot.workspace.selected-session.v1"],
});
export const newTaskProjectIDAtom = persistedAtom({
  key: "workspace.new-task-project",
  initialValue: null as string | null,
  validate: nullableIdentifier,
  legacyKeys: ["palot.workspace.new-task-project.v1"],
});
export const inspectorOpenSessionIDsAtom = persistedAtom({
  key: "ui.inspector-open-sessions",
  initialValue: [] as string[],
  validate: inspectorSessionIDs,
  legacyKeys: ["palot.ui.inspector-open-sessions.v1"],
});

export interface PaneGeometry {
  navigation: number;
  right: number;
  bottom: number;
}

const DEFAULT_PANE_GEOMETRY: PaneGeometry = { navigation: 272, right: 400, bottom: 280 };

function paneGeometry(value: unknown): value is PaneGeometry {
  if (!value || typeof value !== "object") return false;
  const geometry = value as Partial<PaneGeometry>;
  return (
    typeof geometry.navigation === "number" &&
    Number.isFinite(geometry.navigation) &&
    geometry.navigation >= 220 &&
    geometry.navigation <= 420 &&
    typeof geometry.right === "number" &&
    Number.isFinite(geometry.right) &&
    geometry.right >= 300 &&
    geometry.right <= 720 &&
    typeof geometry.bottom === "number" &&
    Number.isFinite(geometry.bottom) &&
    geometry.bottom >= 180 &&
    geometry.bottom <= 640
  );
}

export const paneGeometryAtom = persistedAtom({
  key: "workspace.pane-geometry",
  initialValue: legacyPaneGeometry(),
  validate: paneGeometry,
  migrate: (value) => migratePaneGeometry(value),
});

function migratePaneGeometry(value: unknown): PaneGeometry | undefined {
  if (paneGeometry(value)) return value;
  if (!value || typeof value !== "object") return undefined;
  const legacy = value as { navigation?: unknown; inspector?: unknown };
  const candidate = {
    navigation: legacy.navigation,
    right: legacy.inspector,
    bottom: DEFAULT_PANE_GEOMETRY.bottom,
  };
  return paneGeometry(candidate) ? candidate : undefined;
}

function legacyPaneGeometry(): PaneGeometry {
  if (typeof window === "undefined") return DEFAULT_PANE_GEOMETRY;
  const navigation = Number(window.localStorage.getItem("palot.navigation-width"));
  const inspector = Number(window.localStorage.getItem("palot.inspector-width"));
  const value: PaneGeometry = {
    navigation:
      Number.isFinite(navigation) && navigation > 0 ? navigation : DEFAULT_PANE_GEOMETRY.navigation,
    right: Number.isFinite(inspector) && inspector > 0 ? inspector : DEFAULT_PANE_GEOMETRY.right,
    bottom: DEFAULT_PANE_GEOMETRY.bottom,
  };
  return paneGeometry(value) ? value : DEFAULT_PANE_GEOMETRY;
}
export const inspectorOpenAtom = atom(
  (get) => {
    const sessionID = get(selectedSessionIDAtom);
    return sessionID ? get(inspectorOpenSessionIDsAtom).includes(sessionID) : false;
  },
  (get, set, update: boolean | ((open: boolean) => boolean)) => {
    const sessionID = get(selectedSessionIDAtom);
    if (!sessionID) return;
    const openSessionIDs = get(inspectorOpenSessionIDsAtom);
    const open = openSessionIDs.includes(sessionID);
    const nextOpen = typeof update === "function" ? update(open) : update;
    const withoutSession = openSessionIDs.filter((id) => id !== sessionID);
    set(
      inspectorOpenSessionIDsAtom,
      nextOpen
        ? retainRecent([...withoutSession, sessionID], MAX_PERSISTED_INSPECTOR_SESSIONS)
        : withoutSession,
    );
  },
);
/** Volatile optimistic messages layered over DB-owned transcript rows. */
const profileMessages = new Map<string, ReturnType<typeof createMessagesAtom>>();
const profileShells = new Map<string, ReturnType<typeof createShellsAtom>>();
const createMessagesAtom = () => atom(new Map<string, PalotMessage[]>());
const createShellsAtom = () => atom(new Map<string, Set<string>>());
export function messagesForProfileAtom(profileID: string) {
  let value = profileMessages.get(profileID);
  if (!value) {
    value = createMessagesAtom();
    profileMessages.set(profileID, value);
  }
  return value;
}
export function shellsForProfileAtom(profileID: string) {
  let value = profileShells.get(profileID);
  if (!value) {
    value = createShellsAtom();
    profileShells.set(profileID, value);
  }
  return value;
}
export const messagesAtom = atom(
  (get) => get(messagesForProfileAtom(get(runtimeAtom)?.profileID ?? "unscoped")),
  (
    get,
    set,
    update:
      | Map<string, PalotMessage[]>
      | ((value: Map<string, PalotMessage[]>) => Map<string, PalotMessage[]>),
  ) => set(messagesForProfileAtom(get(runtimeAtom)?.profileID ?? "unscoped"), update),
);
export const activeShellsAtom = atom(
  (get) => get(shellsForProfileAtom(get(runtimeAtom)?.profileID ?? "unscoped")),
  (
    get,
    set,
    update:
      | Map<string, Set<string>>
      | ((value: Map<string, Set<string>>) => Map<string, Set<string>>),
  ) => set(shellsForProfileAtom(get(runtimeAtom)?.profileID ?? "unscoped"), update),
);

export type SessionRuntimeStatus =
  | { type: "idle" }
  | { type: "busy" }
  | { type: "retry"; attempt: number; message: string; next: number };

export interface SessionExecutionState {
  status: "inactive" | "running" | "succeeded" | "failed" | "interrupted";
  startedAt: number | null;
  completedAt: number | null;
  parentID?: string;
  error?: { type: string | null; message: string };
}

export interface SubagentProgress {
  active: number;
  total: number;
}

export function subagentProgress(
  states: Map<string, SessionExecutionState>,
  sessionID: string,
  turnStartedAt: number | null,
): SubagentProgress {
  let active = 0;
  let total = 0;
  for (const [candidateID, state] of states) {
    const visited = new Set([candidateID]);
    let parentID = state.parentID;
    while (parentID && !visited.has(parentID)) {
      if (parentID === sessionID) {
        const belongsToTurn =
          turnStartedAt === null ||
          state.status === "running" ||
          (state.startedAt !== null && state.startedAt >= turnStartedAt) ||
          (state.completedAt !== null && state.completedAt >= turnStartedAt);
        if (belongsToTurn) {
          total += 1;
          if (state.status === "running") active += 1;
        }
        break;
      }
      visited.add(parentID);
      parentID = states.get(parentID)?.parentID;
    }
  }
  return { active, total };
}

export function belongsToSession(
  states: Map<string, SessionExecutionState>,
  candidateID: string,
  sessionID: string,
): boolean {
  if (candidateID === sessionID) return true;
  const visited = new Set([candidateID]);
  let parentID = states.get(candidateID)?.parentID;
  while (parentID && !visited.has(parentID)) {
    if (parentID === sessionID) return true;
    visited.add(parentID);
    parentID = states.get(parentID)?.parentID;
  }
  return false;
}

export function activeShellCount(
  shells: Map<string, Set<string>>,
  states: Map<string, SessionExecutionState>,
  sessionID: string,
): number {
  let count = 0;
  for (const [candidateID, active] of shells) {
    if (belongsToSession(states, candidateID, sessionID)) count += active.size;
  }
  return count;
}
