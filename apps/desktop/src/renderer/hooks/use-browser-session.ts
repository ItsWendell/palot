import type { Browser } from "@opencode/plugin-browser/rpc";
import type { PalotBrowserEvent, PalotBrowserHost } from "../../shared/browser-contract";
import { atom, useAtomValue, useSetAtom, useStore } from "jotai";
import { createElement, useEffect, useLayoutEffect, useRef } from "react";
import { experimentalBrowserAtom } from "../atoms/ui";
import { BrowserWebviewHosts, browserViewportsAtom } from "../components/browser-webview-hosts";
import { useWorkbenchCommands, workbenchStateAtom } from "../atoms/workbench";
import type { WorkbenchContextState, WorkbenchPaneID, WorkbenchScope } from "../lib/workbench-tabs";
import { reconcileBrowserPages, workbenchScopeKey } from "../lib/workbench-tabs";
import { palot } from "../services/palot";

export interface BrowserSession {
  bindingID: string | null;
  state: Browser.State;
  error: string | null;
  popupTabIDs: Browser.TabID[];
  /** An empty list means embedded webview hosts are pending. */
  hosts?: PalotBrowserHost[];
}

const emptyState: Browser.State = { tabs: [], focusedTabID: null };
const sessionsAtom = atom<Record<string, BrowserSession>>({});
const retriesAtom = atom<Record<string, number>>({});

export function useBrowserSession(scope: WorkbenchScope): BrowserSession | undefined {
  const sessions = useAtomValue(sessionsAtom);
  return sessions[workbenchScopeKey(scope)];
}

export function useBrowserReconnect(scope: WorkbenchScope): () => void {
  const setRetries = useSetAtom(retriesAtom);
  const key = workbenchScopeKey(scope);
  return () => setRetries((current) => ({ ...current, [key]: (current[key] ?? 0) + 1 }));
}

export function BrowserSessionAttachment({
  scope,
  connectionID,
  location,
  context,
  active = true,
}: {
  scope: WorkbenchScope;
  connectionID: string;
  location: { directory: string; workspaceID?: string };
  context: WorkbenchContextState;
  active?: boolean;
}) {
  const enabled = useAtomValue(experimentalBrowserAtom);
  const setSessions = useSetAtom(sessionsAtom);
  const setViewports = useSetAtom(browserViewportsAtom);
  const browser = useBrowserSession(scope);
  const store = useStore();
  const commands = useWorkbenchCommands(scope);
  const { profileID, sessionID } = scope;
  const { directory, workspaceID } = location;
  const retry = useAtomValue(retriesAtom)[workbenchScopeKey(scope)] ?? 0;
  const activeRef = useRef(active);
  const pendingRestoredFocus = useRef<Browser.TabID | null>(null);
  useLayoutEffect(() => {
    activeRef.current = active;
    if (active) return;
    const key = workbenchScopeKey(scope);
    setViewports((current) => {
      const viewport = current[key];
      return viewport?.visible ? { ...current, [key]: { ...viewport, visible: false } } : current;
    });
  }, [active, profileID, sessionID, setViewports]);
  useEffect(() => {
    const focused = pendingRestoredFocus.current;
    if (!enabled || !active || !focused || !browser?.bindingID) return;
    if (!browser.state.tabs.some((tab) => tab.id === focused)) return;
    pendingRestoredFocus.current = null;
    const current = store.get(workbenchStateAtom);
    const next = reconcileBrowserPages(
      current,
      { profileID, sessionID },
      { directory, ...(workspaceID ? { workspaceID } : {}) },
      browser.state.tabs.map((tab) => tab.id),
      focused,
    );
    if (next !== current) store.set(workbenchStateAtom, next);
  }, [
    active,
    browser?.bindingID,
    browser?.state,
    directory,
    enabled,
    profileID,
    sessionID,
    store,
    workspaceID,
  ]);
  useEffect(() => {
    if (enabled) return;
    for (const pane of ["right", "bottom"] as const) {
      for (const tab of context[pane].tabs) {
        if (tab.kind === "browser") commands.closeTab(pane, tab.id);
      }
    }
  }, [enabled, commands, context]);

  useEffect(() => {
    if (!enabled) return;
    const key = workbenchScopeKey({ profileID, sessionID });
    let cancelled = false;
    let detached = false;
    let bindingID: string | null = null;
    let firstInventory = true;
    const placements = new Map<string, WorkbenchPaneID>();
    pendingRestoredFocus.current = null;
    const earlyEvents = new Map<
      string,
      { state?: Extract<PalotBrowserEvent, { type: "state" }>; hosts?: PalotBrowserHost[] }
    >();
    const syncPages = (state: Browser.State, focusedPageID?: Browser.TabID) => {
      const current = store.get(workbenchStateAtom);
      const next = reconcileBrowserPages(
        current,
        { profileID, sessionID },
        { directory, ...(workspaceID ? { workspaceID } : {}) },
        state.tabs.map((tab) => tab.id),
        focusedPageID,
        placements,
      );
      if (next !== current) store.set(workbenchStateAtom, next);
      for (const tab of state.tabs) placements.delete(tab.id);
    };
    const acceptInventory = (state: Browser.State) => {
      if (!firstInventory) return syncPages(state);
      firstInventory = false;
      if (activeRef.current) syncPages(state, state.focusedTabID ?? undefined);
      else {
        pendingRestoredFocus.current = state.focusedTabID;
        syncPages(state);
      }
    };
    setSessions((current) => ({
      ...current,
      [key]: { bindingID: null, state: emptyState, error: null, popupTabIDs: [] },
    }));
    const removeListener = palot.onBrowserEvent((event) => {
      if (cancelled || detached) return;
      if (!bindingID) {
        if (event.type === "state" || event.type === "hosts") {
          const early = earlyEvents.get(event.bindingID) ?? {};
          if (event.type === "state") early.state = event;
          else early.hosts = event.hosts;
          earlyEvents.set(event.bindingID, early);
        }
        return;
      }
      if (event.bindingID !== bindingID) return;
      if (event.type === "placement") {
        placements.set(event.tabID, event.pane);
        return;
      }
      if (event.type === "state" && event.state === null) detached = true;
      if (event.type === "state" && event.state) acceptInventory(event.state);
      if (event.type === "focus" && activeRef.current) {
        const current = store.get(sessionsAtom)[key]?.state;
        if (current) syncPages(current, event.tabID);
      }
      if (event.type === "preview") {
        commands.openTab(
          {
            kind: "file",
            location: { directory, ...(workspaceID ? { workspaceID } : {}) },
            path: event.path,
          },
          { pane: "right", activate: activeRef.current },
        );
      }
      setSessions((current) => {
        const previous = current[key];
        if (!previous) return current;
        if (event.type === "hosts")
          return { ...current, [key]: { ...previous, hosts: event.hosts } };
        if (event.type === "state")
          return {
            ...current,
            [key]: {
              ...previous,
              bindingID: event.state === null ? null : previous.bindingID,
              state: event.state ?? emptyState,
              error: event.error ?? null,
              popupTabIDs: event.state === null ? [] : (event.popupTabIDs ?? []),
              hosts: event.state === null ? undefined : previous.hosts,
            },
          };
        if (event.type === "focus")
          return {
            ...current,
            [key]: {
              ...previous,
              state: { ...previous.state, focusedTabID: event.tabID },
            },
          };
        return current;
      });
    });
    void palot
      .browserRegister({ profileID, sessionID, connectionID })
      .then((id) => {
        if (cancelled) {
          void palot.browserClose(id).catch(() => undefined);
          return;
        }
        bindingID = id;
        const early = earlyEvents.get(id);
        if (early?.state?.state === null) detached = true;
        setSessions((current) => ({
          ...current,
          [key]: {
            ...(current[key] ?? { state: emptyState, error: null, popupTabIDs: [] }),
            state: early?.state?.state ?? emptyState,
            error: early?.state?.error ?? null,
            popupTabIDs: early?.state?.state ? (early.state.popupTabIDs ?? []) : [],
            hosts: early?.state?.state === null ? undefined : early?.hosts,
            bindingID: detached ? null : id,
          },
        }));
        if (early?.state?.state) acceptInventory(early.state.state);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setSessions((current) => ({
          ...current,
          [key]: {
            bindingID: null,
            state: emptyState,
            popupTabIDs: [],
            error:
              error instanceof Error
                ? error.message
                : "Browser plugin is unavailable on this connection",
          },
        }));
      });
    return () => {
      cancelled = true;
      pendingRestoredFocus.current = null;
      removeListener();
      if (bindingID) void palot.browserClose(bindingID).catch(() => undefined);
      setSessions((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
      setViewports((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
    };
  }, [
    enabled,
    profileID,
    sessionID,
    connectionID,
    directory,
    workspaceID,
    retry,
    commands,
    setSessions,
    setViewports,
    store,
  ]);
  return browser?.bindingID && browser.hosts !== undefined
    ? createElement(BrowserWebviewHosts, {
        scopeKey: workbenchScopeKey(scope),
        bindingID: browser.bindingID,
        hosts: browser.hosts,
      })
    : null;
}
