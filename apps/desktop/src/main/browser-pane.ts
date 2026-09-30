// Adapted from OpenCode v2.0.14 (MIT), Copyright (c) 2025 opencode.
// https://github.com/anomalyco/opencode/blob/v2.0.14/packages/desktop/src/main/browser-pane.ts
import { randomUUID } from "node:crypto";
import { NodeHttpClient } from "@effect/platform-node";
import { Browser } from "@opencode/plugin-browser/rpc";
import { OpenCode } from "@opencode/client/effect";
import { SessionID } from "@opencode/schema/session-id";
import { BrowserWindow, session } from "electron";
import { Deferred, Effect, ManagedRuntime, Queue, Schedule, Schema, Stream } from "effect";
import { HttpClient, HttpClientRequest } from "effect/unstable/http";
import type {
  PalotBrowserEvent,
  PalotBrowserLayout,
  PalotBrowserRegistration,
  PalotBrowserUserCommand,
  PalotBrowserPageControl,
  PalotBrowserHost,
} from "../shared/browser-contract";
import { IPC_CHANNELS } from "../shared/opencode-contract";
import { createBrowserPage, type BrowserPage } from "./browser-chromium";
import { browserFailure } from "./browser/errors";
import { createBrowserNetwork, type BrowserNetwork } from "./browser/network";
import { destinationOrigin, fileURLWithin, normalizeURL } from "./browser/policy";
import { browserRestoreKey, createBrowserRestoreStore } from "./browser/restore";
import { openCodeRuntime } from "./opencode-runtime";
import { requestBrowserWebviewHost } from "./browser/webview-host";
import type { BrowserPageSurface } from "./browser/surface";
import { createBrowserPopupSurface, popupWebPreferences } from "./browser/popup-surface";

type Entry = {
  id: string;
  win: BrowserWindow;
  registration: PalotBrowserRegistration;
  ownsConnection: () => boolean;
  abort: AbortController;
  ready: PromiseWithResolvers<void>;
  requests: Map<string, { abort: AbortController; tabID?: Browser.TabID }>;
  report?: (event: BrowserEvent) => void;
  cleanup: () => void;
  pages: Map<Browser.TabID, BrowserPage>;
  pending: Map<Browser.TabID, { promise: Promise<BrowserPage>; abort: AbortController }>;
  operations: Map<Browser.TabID, Set<AbortController>>;
  recovering: Set<Browser.TabID>;
  replacements: Map<Browser.TabID, number>;
  hosts: Map<Browser.TabID, PalotBrowserHost>;
  layouts: Map<Browser.TabID, PalotBrowserLayout>;
  popups: Map<Browser.TabID, { openerID: Browser.TabID; surface: BrowserPageSurface }>;
  tabs: Map<Browser.TabID, Browser.Tab>;
  focusedTabID: Browser.TabID | null;
  pendingPopupFocus?: Browser.TabID;
  partition: string;
  network?: BrowserNetwork;
  fileRoots: string[];
  lastState?: string;
  storageKey: string;
  clearing: boolean;
};
type BrowserEvent = PalotBrowserEvent extends infer E
  ? E extends { bindingID: string }
    ? Omit<E, "bindingID">
    : never
  : never;

const userActions = new Set<Browser.Action["type"]>([
  "tabs.open",
  "tabs.focus",
  "tabs.close",
  "navigate",
  "back",
  "forward",
  "reload",
  "stop",
]);

export function parseBrowserUserCommand(value: unknown): PalotBrowserUserCommand {
  // The published v2.0.14 decoder requires these two optional tabs.open keys
  // to be present. Supply its documented defaults before decoding IPC input.
  const input =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  if (typeof input.type !== "string" || !userActions.has(input.type as Browser.Action["type"]))
    throw new Error("Browser UI operation is not allowed");
  const normalized =
    input.type === "tabs.open"
      ? {
          ...input,
          ...(!("url" in input) ? { url: "about:blank" } : {}),
          ...(!("focus" in input) ? { focus: true } : {}),
        }
      : value;
  const action = Schema.decodeUnknownSync(Browser.Action)(normalized);
  if (!userActions.has(action.type)) throw new Error("Browser UI operation is not allowed");
  return action as PalotBrowserUserCommand;
}

/** One attachment per window/session; connection and tab resources never cross bindings. */
export function createBrowserPane() {
  const entries = new Map<string, Entry>();
  const retired = new Map<string, Map<string, Promise<PromiseSettledResult<void>[]>>>();
  const clearingKeys = new Set<string>();
  const runtime = ManagedRuntime.make(NodeHttpClient.layerNodeHttp);
  // Main imports IPC handlers before it chooses Electron's channel/E2E userData path.
  // Do not construct electron-store until the first registration.
  let restoreStore: ReturnType<typeof createBrowserRestoreStore> | undefined;
  const restore = () => (restoreStore ??= createBrowserRestoreStore());
  let disposed = false;

  function owned(win: BrowserWindow, id: string): Entry {
    const entry = entries.get(id);
    if (!entry || entry.win !== win) throw new Error("Browser binding is unavailable");
    if (!entry.ownsConnection()) {
      close(entry);
      throw new Error("Browser window connection changed");
    }
    const status = openCodeRuntime
      .scopedConnection(entry.registration.connectionID)
      .runtimeStatus();
    if (!status.connected || status.profileID !== entry.registration.profileID) {
      close(entry);
      throw new Error("Browser connection is stale");
    }
    return entry;
  }

  function send(entry: Entry, event: BrowserEvent) {
    if (entry.win.isDestroyed() || entry.win.webContents.isDestroyed()) return;
    entry.win.webContents.send(IPC_CHANNELS.browserEvent, { bindingID: entry.id, ...event });
  }

  function inventory(entry: Entry): Browser.State {
    return {
      tabs: [...entry.tabs].map(([id, tab]) =>
        entry.recovering.has(id) ? tab : (entry.pages.get(id)?.state() ?? tab),
      ),
      focusedTabID: entry.focusedTabID,
    };
  }

  function report(entry: Entry, event: BrowserEvent) {
    if (entry.report) entry.report(event);
    else send(entry, event);
  }

  function publishState(entry: Entry, error?: string) {
    const event = {
      type: "state" as const,
      state: inventory(entry),
      popupTabIDs: [...entry.popups.keys()],
      ...(error ? { error } : {}),
    };
    // Teardown sends an empty inventory, but does not overwrite the saved tabs.
    if (entry.report)
      restore().save(entry.storageKey, {
        tabs: event.state.tabs.map((tab) => ({
          ...tab,
          // Chromium may not yet have assigned a URL to the newly restored page.
          url: tab.url || entry.tabs.get(tab.id)?.url || "about:blank",
        })),
        focusedTabID: entry.focusedTabID,
      });
    const serialized = JSON.stringify(event);
    if (entry.lastState === serialized) return;
    entry.lastState = serialized;
    report(entry, event);
  }

  async function wipePartition(name: string): Promise<unknown[]> {
    const partition = session.fromPartition(name);
    const results = await Promise.allSettled([
      partition.clearStorageData(),
      partition.clearCache(),
    ]);
    return results.filter((result) => result.status === "rejected").map((result) => result.reason);
  }

  function close(entry: Entry, reason = "browser.pane.registration.closed") {
    if (entries.get(entry.id) !== entry) return;
    entry.report = undefined;
    for (const request of entry.requests.values()) request.abort.abort();
    entry.requests.clear();
    for (const pending of entry.pending.values()) pending.abort.abort();
    entry.pending.clear();
    for (const operations of entry.operations.values())
      for (const operation of operations) operation.abort();
    entry.operations.clear();
    entry.replacements.clear();
    entry.popups.clear();
    entry.pendingPopupFocus = undefined;
    const pages = [...entry.pages.values()];
    const previous = retired.get(entry.storageKey) ?? new Map();
    previous.set(entry.partition, Promise.allSettled(pages.map((page) => page.dispose())));
    retired.set(entry.storageKey, previous);
    entry.pages.clear();
    entry.tabs.clear();
    entry.focusedTabID = null;
    send(entry, { type: "state", state: null, error: reason });
    entries.delete(entry.id);
    entry.ready.reject(new Error(reason));
    entry.cleanup();
    entry.abort.abort();
  }

  async function closePage(entry: Entry, id: Browser.TabID, error?: string) {
    if (!entry.tabs.has(id)) throw new Error("Browser tab is unavailable");
    closeChildPopups(entry, id);
    entry.popups.delete(id);
    if (entry.pendingPopupFocus === id) entry.pendingPopupFocus = undefined;
    entry.pending.get(id)?.abort.abort();
    for (const operation of entry.operations.get(id) ?? []) operation.abort();
    entry.operations.delete(id);
    entry.recovering.delete(id);
    entry.replacements.delete(id);
    for (const request of entry.requests.values()) if (request.tabID === id) request.abort.abort();
    const page = entry.pages.get(id);
    entry.pages.delete(id);
    entry.layouts.delete(id);
    entry.tabs.delete(id);
    const lostFocus = entry.focusedTabID === id;
    if (lostFocus) entry.focusedTabID = entry.tabs.keys().next().value ?? null;
    try {
      await page?.dispose();
    } finally {
      publishState(entry, error);
      if (lostFocus && entry.focusedTabID && !entry.clearing)
        report(entry, { type: "focus", tabID: entry.focusedTabID });
    }
  }

  async function load(entry: Entry, id: Browser.TabID) {
    const page = entry.pages.get(id);
    if (page) return page;
    const tab = entry.tabs.get(id);
    return tab && !tab.loadError ? createHosted(entry, tab) : undefined;
  }

  function failTab(
    entry: Entry,
    id: Browser.TabID,
    page: BrowserPage | undefined,
    message: string,
  ) {
    if (entries.get(entry.id) !== entry || !entry.tabs.has(id)) return;
    if (page && entry.pages.get(id) !== page) return;
    if (!page && entry.pages.has(id)) return;
    closeChildPopups(entry, id);
    entry.popups.delete(id);
    if (entry.pendingPopupFocus === id) entry.pendingPopupFocus = undefined;
    const previous = entry.tabs.get(id)!;
    let state = previous;
    try {
      if (page) state = page.state();
    } catch {
      // Destroyed WebContents may no longer expose URL, title or history.
    }
    entry.tabs.set(id, {
      ...state,
      url:
        state.url && (state.url !== "about:blank" || previous.url === "about:blank")
          ? state.url
          : previous.url,
      title: state.title || previous.title,
      loading: false,
      loadError: message.slice(0, 2_048),
      generation: Math.max(state.generation, previous.generation) + 1,
    });
    entry.recovering.delete(id);
    entry.replacements.set(id, entry.tabs.get(id)!.generation);
    for (const operation of entry.operations.get(id) ?? []) operation.abort();
    entry.pending.get(id)?.abort.abort();
    if (page) {
      entry.pages.delete(id);
      void page.dispose().catch(() => undefined);
    }
    publishState(entry);
  }

  function createHosted(
    entry: Entry,
    restored?: Browser.Tab,
    recoveryURL?: string,
    signal?: AbortSignal,
    pane?: "right" | "bottom",
  ): Promise<BrowserPage> {
    if (entry.clearing) return Promise.reject(new Error("Browser data is being cleared"));
    if (signal?.aborted) return Promise.reject(new Error("Browser operation was cancelled"));
    const id = restored?.id ?? Browser.TabID.make(`tab_${randomUUID()}`);
    const active = entry.pages.get(id);
    if (active) return Promise.resolve(active);
    const pending = entry.pending.get(id);
    if (pending) return pending.promise;
    const tab = restored ?? {
      id,
      url: "about:blank",
      title: "",
      loading: true,
      canGoBack: false,
      canGoForward: false,
      generation: 1,
    };
    if (pane) report(entry, { type: "placement", tabID: id, pane });
    entry.tabs.set(id, tab);
    const abort = new AbortController();
    const cancel = () => abort.abort();
    signal?.addEventListener("abort", cancel, { once: true });
    if (restored?.loadError) entry.recovering.add(id);
    const promise = requestBrowserWebviewHost(entry.win, {
      tabID: id,
      partition: entry.partition,
      signal: abort.signal,
      current: () =>
        !abort.signal.aborted &&
        entries.get(entry.id) === entry &&
        entry.tabs.has(id) &&
        entry.ownsConnection(),
      publish: (host) => {
        if (host) entry.hosts.set(id, host);
        else entry.hosts.delete(id);
        send(entry, { type: "hosts", hosts: [...entry.hosts.values()] });
      },
    })
      .then((surface) => {
        if (abort.signal.aborted || entries.get(entry.id) !== entry || !entry.tabs.has(id)) {
          surface.dispose();
          if (!surface.contents.isDestroyed()) surface.contents.close();
          throw new Error("Browser tab closed during attachment");
        }
        if (restored?.loadError) entry.replacements.set(id, tab.generation + 1);
        return create(
          entry,
          restored?.loadError
            ? { ...tab, url: recoveryURL ?? tab.url, generation: tab.generation + 1 }
            : tab,
          surface,
        );
      })
      .catch((error: unknown) => {
        if (!abort.signal.aborted)
          failTab(entry, id, undefined, "Browser webview could not attach");
        else if (entries.get(entry.id) === entry && !entry.pages.has(id)) {
          entry.recovering.delete(id);
          if (!restored) entry.tabs.delete(id);
          publishState(entry);
        }
        throw error;
      })
      .finally(() => {
        signal?.removeEventListener("abort", cancel);
        if (entry.pending.get(id)?.abort === abort) entry.pending.delete(id);
      });
    entry.pending.set(id, { promise, abort });
    publishState(entry);
    return promise;
  }

  function closeChildPopups(entry: Entry, openerID: Browser.TabID) {
    for (const [id, popup] of entry.popups)
      if (popup.openerID === openerID) void closePage(entry, id).catch(() => undefined);
  }

  function popup(
    entry: Entry,
    openerID: Browser.TabID,
    details: Electron.HandlerDetails,
  ): Electron.WindowOpenHandlerResponse {
    if (details.url !== "about:blank" && !destinationOrigin(details.url)) return { action: "deny" };
    try {
      owned(entry.win, entry.id);
    } catch {
      return { action: "deny" };
    }
    const opener = entry.pages.get(openerID);
    if (!opener || !entry.network) return { action: "deny" };
    if (entry.popups.has(openerID) || entry.popups.size >= 4) {
      publishState(
        entry,
        "Nested popups and more than four popup windows per session are not supported.",
      );
      return { action: "deny" };
    }
    const partition = session.fromPartition(entry.partition);
    return {
      action: "allow",
      outlivesOpener: false,
      overrideBrowserWindowOptions: { show: false, webPreferences: popupWebPreferences(partition) },
      createWindow(options) {
        const child = (
          options as Electron.BrowserWindowConstructorOptions & {
            webContents?: Electron.WebContents;
          }
        ).webContents;
        let surface: BrowserPageSurface | undefined;
        let id: Browser.TabID | undefined;
        try {
          owned(entry.win, entry.id);
          if (!child || entry.pages.get(openerID) !== opener || entry.popups.size >= 4)
            throw new Error(
              "This popup cannot preserve its original navigation in this Electron build.",
            );
          surface = createBrowserPopupSurface(entry.win, options, partition);
          id = Browser.TabID.make(`tab_${randomUUID()}`);
          const tab: Browser.Tab = {
            id,
            url: details.url,
            title: "",
            loading: true,
            canGoBack: false,
            canGoForward: false,
            generation: 1,
          };
          entry.tabs.set(id, tab);
          entry.popups.set(id, { openerID, surface });
          // Installs network, permissions, navigation guards and download hooks
          // synchronously, before Chromium resumes the child's original request.
          const page = create(entry, tab, surface, true);
          const popupID = id;
          surface.window!.on("close", (event) => {
            if (entry.popups.has(popupID) && entry.pages.get(popupID) === page) {
              // Register deliberate closure before debugger/destroyed events.
              // Like tabs.close, this disposes the owned page without reload.
              event.preventDefault();
              void closePage(entry, popupID).catch(() => undefined);
            }
          });
          surface.window!.once("closed", () => {
            if (entry.popups.has(popupID) && entry.pages.get(popupID) === page)
              void closePage(entry, popupID).catch(() => undefined);
          });
          if (details.disposition !== "background-tab") focus(entry, id, false);
          else publishState(entry);
          return child;
        } catch (error) {
          // Start closure before returning control to Chromium, not on a later
          // event-loop turn. Electron may emit destroyed asynchronously. Its
          // no-child path gets an inert window; never replay the original POST.
          const rejected =
            child ??
            new BrowserWindow({ show: false, webPreferences: popupWebPreferences(partition) })
              .webContents;
          if (!rejected.isDestroyed()) {
            rejected.setWindowOpenHandler(() => ({ action: "deny" }));
            rejected.close({ waitForBeforeUnload: false });
          }
          if (id) {
            const page = entry.pages.get(id);
            entry.popups.delete(id);
            entry.tabs.delete(id);
            entry.pages.delete(id);
            void page?.dispose().catch(() => undefined);
          }
          surface?.dispose();
          if (entries.get(entry.id) === entry)
            publishState(
              entry,
              error instanceof Error ? error.message : "Browser popup could not open",
            );
          return rejected;
        }
      },
    };
  }

  function create(
    entry: Entry,
    restored: Browser.Tab,
    surface: BrowserPageSurface,
    preserveNavigation = false,
  ) {
    if (!entry.network) throw new Error("Browser network is unavailable");
    const id = restored.id;
    let page: BrowserPage;
    let failedDuringCreate = false;
    const fail = (
      message = "Browser tab crashed or became unresponsive. Reload the page to recover it.",
    ) => {
      if (!page) failedDuringCreate = true;
      else failTab(entry, id, page, message);
    };
    page = createBrowserPage(entry.win, {
      id,
      network: entry.network,
      restore: restored,
      surface,
      preserveNavigation,
      openPopup: (details) => popup(entry, id, details),
      ...(preserveNavigation
        ? {
            closed: () => {
              if (entry.popups.has(id) && entry.pages.get(id) === page)
                void closePage(entry, id).catch(() => undefined);
            },
          }
        : {}),
      fileRoots: () => entry.fileRoots,
      fail,
      publish: (error) => {
        if (entry.pages.get(id) === page) publishState(entry, error);
      },
    });
    entry.pages.set(id, page);
    if (failedDuringCreate) {
      fail();
      throw new Error("Browser tab failed during initialization");
    }
    void page.ready
      .then(() => {
        if (entry.pages.get(id) === page) {
          entry.recovering.delete(id);
          entry.tabs.set(id, page.state());
          publishState(entry);
        }
      })
      .catch(() => fail());
    return page;
  }

  function focus(entry: Entry, id: Browser.TabID, activateWindow = true) {
    entry.pendingPopupFocus = activateWindow && entry.popups.has(id) ? id : undefined;
    entry.focusedTabID = id;
    publishState(entry);
    report(entry, { type: "focus", tabID: id });
    if (activateWindow && entry.layouts.get(id)?.visible) {
      entry.pendingPopupFocus = undefined;
      entry.pages.get(id)?.focus();
    }
  }

  async function withTab<T>(
    entry: Entry,
    id: Browser.TabID,
    signal: AbortSignal,
    run: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const operation = new AbortController();
    const cancel = () => operation.abort();
    signal.addEventListener("abort", cancel, { once: true });
    if (signal.aborted) cancel();
    const operations = entry.operations.get(id) ?? new Set<AbortController>();
    operations.add(operation);
    entry.operations.set(id, operations);
    try {
      operation.signal.throwIfAborted();
      return await run(operation.signal);
    } finally {
      signal.removeEventListener("abort", cancel);
      operations.delete(operation);
      if (!operations.size) entry.operations.delete(id);
    }
  }

  async function ready(page: BrowserPage, signal: AbortSignal) {
    if (signal.aborted) signal.throwIfAborted();
    let cancel: (() => void) | undefined;
    try {
      await Promise.race([
        page.ready,
        new Promise<never>((_, reject) => {
          cancel = () => reject(new Error("Browser operation was cancelled"));
          signal.addEventListener("abort", cancel, { once: true });
          if (signal.aborted) cancel();
        }),
      ]);
      signal.throwIfAborted();
    } finally {
      if (cancel) signal.removeEventListener("abort", cancel);
    }
  }

  async function execute(
    entry: Entry,
    command: Browser.Command,
    signal: AbortSignal,
    pane?: "right" | "bottom",
  ): Promise<Browser.Result> {
    if (entry.clearing) throw new Error("Browser data is being cleared");
    if (signal.aborted) throw new Error("Browser request was cancelled; inspect before retrying");
    const action = command.action;
    if (action.type === "tabs.list") return { value: inventory(entry), files: [] };
    if (action.type === "preview") {
      report(entry, { type: "preview", path: action.path });
      return { value: { path: action.path }, files: [] };
    }
    if (action.type === "tabs.open") {
      const page = await createHosted(entry, undefined, undefined, signal, pane);
      return withTab(entry, page.state().id, signal, async (active) => {
        if (action.focus !== false) focus(entry, page.state().id);
        await ready(page, active);
        if (entry.pages.get(page.state().id) !== page) throw new Error("Browser tab was replaced");
        await page.execute(
          {
            action: { type: "navigate", tabID: page.state().id, url: action.url ?? "about:blank" },
            files: [],
          },
          active,
        );
        active.throwIfAborted();
        publishState(entry);
        return { value: page.state(), files: [] };
      });
    }
    const tab = inventory(entry).tabs.find((item) => item.id === action.tabID);
    if (!tab) throw new Error("Browser tab is unavailable; list tabs before retrying");
    if (action.type === "tabs.focus") {
      focus(entry, action.tabID);
      return { value: tab, files: [] };
    }
    if (action.type === "tabs.close") {
      await closePage(entry, action.tabID);
      return { value: inventory(entry), files: [] };
    }
    return withTab(entry, action.tabID, signal, async (active) => {
      if (
        command.generation !== undefined &&
        command.generation < (entry.replacements.get(action.tabID) ?? 0)
      )
        throw new Error("Browser tab was replaced. Inspect it again before acting.");
      if (entry.recovering.has(action.tabID))
        throw new Error("Browser tab is recovering. Inspect it again when loading finishes.");
      const failed = !entry.pages.has(action.tabID) && entry.tabs.get(action.tabID)?.loadError;
      if (failed && action.type !== "reload" && action.type !== "navigate")
        throw new Error("Browser tab failed. Reload or navigate to recover it.");
      if (failed) {
        // Permission inspection must never create a guest or load a URL. Bind
        // approval to this failed inventory generation, then verify it before
        // creating the replacement. Its new document has a different CDP key.
        const target: Browser.Target = {
          resources: [
            normalizeURL(action.type === "navigate" ? action.url : tab.url, {
              fileRoots: entry.fileRoots,
            }),
          ],
          key: JSON.stringify(["recovery", tab.id, tab.generation]),
        };
        if (command.inspect) return { value: target, files: [] };
        if (command.target && JSON.stringify(command.target) !== JSON.stringify(target))
          throw new Error(
            "Browser recovery target changed while permission was pending. Inspect it again.",
          );
      }
      const page = failed
        ? await createHosted(
            entry,
            entry.tabs.get(action.tabID),
            action.type === "navigate" ? "about:blank" : undefined,
            active,
          )
        : await load(entry, action.tabID);
      if (!page) throw new Error("Browser tab is unavailable");
      await ready(page, active);
      if (entry.pages.get(action.tabID) !== page) throw new Error("Browser tab was replaced");
      // A recovered guest has already loaded the failed URL (or a blank document before navigate).
      const result =
        failed && action.type === "reload"
          ? { value: page.state(), files: [] }
          : await page.execute(
              failed ? { ...command, target: undefined, generation: undefined } : command,
              active,
            );
      active.throwIfAborted();
      publishState(entry);
      return result;
    });
  }

  return {
    async register(
      win: BrowserWindow,
      input: PalotBrowserRegistration,
      ownsConnection: () => boolean,
    ): Promise<string> {
      if (disposed || win.isDestroyed() || win.webContents.isDestroyed())
        throw new Error("Browser owner is unavailable");
      if (
        !input ||
        typeof input !== "object" ||
        !input.profileID ||
        !input.connectionID ||
        !input.sessionID
      )
        throw new Error("Browser registration is invalid");
      const status = openCodeRuntime.scopedConnection(input.connectionID).runtimeStatus();
      if (!status.connected || status.profileID !== input.profileID)
        throw new Error("Browser connection is unavailable");
      const connection = await openCodeRuntime.requestConnection({
        profileID: input.profileID,
        connectionID: input.connectionID,
      });
      connection.validate();
      if (!destinationOrigin(connection.endpoint.url))
        throw new Error("Browser endpoint is invalid");
      const scoped = openCodeRuntime.scopedConnection(input.connectionID);
      const sessionID = SessionID.make(input.sessionID);
      const details = await scoped.withClient((client) => client.session.get({ sessionID }));
      connection.validate();
      if (!ownsConnection() || win.isDestroyed() || win.webContents.isDestroyed())
        throw new Error("Browser window connection changed");
      if (
        entries.size &&
        [...entries.values()].some(
          (entry) => entry.win === win && entry.registration.sessionID === input.sessionID,
        )
      )
        throw new Error("Browser session is already attached to this window");
      const id = randomUUID();
      const storageKey = browserRestoreKey(input.profileID, input.sessionID);
      if (clearingKeys.has(storageKey)) throw new Error("Browser data is being cleared");
      const saved = restore().load(storageKey);
      const partition = `palot-browser-${id}`;
      const entry: Entry = {
        id,
        win,
        registration: input,
        ownsConnection,
        abort: new AbortController(),
        ready: Promise.withResolvers<void>(),
        requests: new Map(),
        pages: new Map(),
        pending: new Map(),
        operations: new Map(),
        recovering: new Set(),
        replacements: new Map(),
        hosts: new Map(),
        layouts: new Map(),
        popups: new Map(),
        tabs: new Map(
          saved.tabs.map((tab) => [
            tab.id,
            {
              ...tab,
              title: "",
              loading: false,
              canGoBack: false,
              canGoForward: false,
              generation: 1,
            },
          ]),
        ),
        focusedTabID: saved.focusedTabID,
        partition,
        storageKey,
        clearing: false,
        fileRoots: [],
        cleanup: () => {},
      };
      // A private partition's file subresources must not escape the session workspace.
      session
        .fromPartition(partition)
        .webRequest.onBeforeRequest({ urls: ["file://*/*"] }, (request, callback) =>
          callback({ cancel: !fileURLWithin(request.url, entry.fileRoots) }),
        );
      const stop = () => close(entry);
      const navigate = (
        _event: Electron.Event,
        _url: string,
        isInPlace: boolean,
        isMainFrame: boolean,
      ) => {
        if (isMainFrame && !isInPlace) close(entry, "browser.pane.window_navigation");
      };
      win.webContents.once("destroyed", stop);
      win.webContents.on("did-start-navigation", navigate);
      win.once("closed", stop);
      const offDispose = scoped.onDispose(stop);
      const offStatus = openCodeRuntime.onRuntimeStatus(() => {
        if (!ownsConnection()) stop();
      });
      entry.cleanup = () => {
        offDispose();
        offStatus();
        win.off("closed", stop);
        if (!win.webContents.isDestroyed()) {
          win.webContents.off("destroyed", stop);
          win.webContents.off("did-start-navigation", navigate);
        }
      };
      entries.set(id, entry);
      send(entry, { type: "hosts", hosts: [] });
      let reason = "browser.pane.registration.closed";
      let attached = false;
      void runtime
        .runPromise(
          Effect.gen(function* () {
            const http = yield* HttpClient.HttpClient;
            const headers = new Headers(connection.headers);
            const client = yield* OpenCode.make({ baseUrl: connection.endpoint.url }).pipe(
              Effect.provideService(
                HttpClient.HttpClient,
                [...headers].reduce(
                  (current, [key, value]) =>
                    HttpClient.mapRequest(current, HttpClientRequest.setHeader(key, value)),
                  http,
                ),
              ),
            );
            const currentSession = yield* client.session.get({ sessionID });
            if (currentSession.location.directory !== details.location.directory)
              throw new Error("Browser session changed during registration");
            const location = {
              directory: currentSession.location.directory,
              workspace: currentSession.location.workspaceID,
            };
            if (status.source === "shared-service" && status.topology === "same-machine")
              entry.fileRoots = [location.directory];
            const options = { location };
            const attachment = { sessionID, connectionID: randomUUID() };
            const rpc = client.rpc(Browser.Definition);
            entry.network = yield* createBrowserNetwork({ rpc, attachment, location, partition });
            const connected = yield* Deferred.make<void>();
            const outbound = yield* Queue.unbounded<Effect.Effect<void>>();
            const sendRpc = (effect: Effect.Effect<unknown, unknown>) =>
              Queue.offerUnsafe(
                outbound,
                effect.pipe(
                  Effect.catchCause((cause) => Effect.logWarning("Browser send failed", cause)),
                ),
              );
            const reply = (requestID: string, outcome: Browser.Outcome) =>
              sendRpc(
                rpc.result(
                  {
                    ...attachment,
                    requestID,
                    outcome: Schema.encodeSync(Browser.Outcome)(outcome),
                  },
                  options,
                ),
              );
            entry.report = (event) => {
              const local = Effect.sync(() => send(entry, event));
              if (event.type !== "state") return sendRpc(local);
              sendRpc(
                rpc
                  .state(
                    { ...attachment, state: event.state ?? { tabs: [], focusedTabID: null } },
                    options,
                  )
                  .pipe(
                    Effect.retry({
                      while: (error) => !("type" in error && error.type === "unavailable"),
                      schedule: Schedule.min([
                        Schedule.exponential("250 millis"),
                        Schedule.spaced("10 seconds"),
                      ]),
                    }),
                    Effect.ensuring(local),
                  ),
              );
            };
            const receive = client.event.subscribe().pipe(
              Stream.runForEach((event) =>
                Effect.gen(function* () {
                  if (event.type === "server.connected") {
                    yield* Deferred.succeed(connected, undefined);
                    return;
                  }
                  if (
                    event.type !== "rpc.experimental.browser.control" ||
                    event.data.connectionID !== attachment.connectionID
                  )
                    return;
                  const message = yield* Schema.decodeUnknownEffect(Browser.Control)(event.data);
                  if (message.type === "attached") {
                    attached = true;
                    entry.ready.resolve();
                    return;
                  }
                  if (message.type === "cancel")
                    return entry.requests.get(message.requestID)?.abort.abort();
                  const abort = new AbortController();
                  entry.requests.set(message.requestID, { abort });
                  yield* rpc.command({ ...attachment, requestID: message.requestID }, options).pipe(
                    Effect.flatMap((command) =>
                      Effect.promise(async () => {
                        entry.requests.set(message.requestID, {
                          abort,
                          ...("tabID" in command.action ? { tabID: command.action.tabID } : {}),
                        });
                        reply(
                          message.requestID,
                          await execute(entry, command, abort.signal).then(
                            (result) => ({ type: "success" as const, result }),
                            (error: unknown) => browserFailure(command.action, error),
                          ),
                        );
                      }),
                    ),
                    Effect.ensuring(Effect.sync(() => entry.requests.delete(message.requestID))),
                    Effect.tapError((error) =>
                      Effect.sync(() => {
                        if (Schema.isSchemaError(error))
                          reply(message.requestID, {
                            type: "failure",
                            code: "unsupported",
                            message:
                              "This desktop does not support this browser operation; update the desktop app.",
                          });
                      }),
                    ),
                    Effect.catchCause((cause) =>
                      abort.signal.aborted
                        ? Effect.void
                        : Effect.logWarning("Browser command failed", cause),
                    ),
                    Effect.forkScoped,
                  );
                }),
              ),
            );
            yield* Effect.raceAllFirst([
              receive,
              Stream.fromQueue(outbound).pipe(Stream.runForEach((effect) => effect)),
              Deferred.await(connected).pipe(
                Effect.andThen(rpc.attach({ ...attachment, version: 4 }, options)),
                Effect.tap((result) =>
                  Effect.sync(() => {
                    if (result === "replaced") reason = "browser.pane.replaced";
                  }),
                ),
              ),
            ]);
          }).pipe(
            Effect.scoped,
            Effect.tapError((error) =>
              Effect.sync(() => {
                const type = error instanceof Object && "type" in error ? error.type : undefined;
                console.warn("Browser attachment failed", type ?? "unknown error");
                if (type === "rpc.unavailable" && attached) reason = "browser.pane.suspended";
                else if (
                  type === "rpc.unavailable" ||
                  type === "rpc.method_not_found" ||
                  type === "rpc.invalid_input"
                )
                  reason = "browser.pane.unsupported";
              }),
            ),
            Effect.ensuring(Effect.sync(() => close(entry, reason))),
          ),
          { signal: entry.abort.signal },
        )
        .catch(stop);
      const timeout = setTimeout(
        () => close(entry, "Browser plugin did not attach in time"),
        15_000,
      );
      try {
        await entry.ready.promise;
      } finally {
        clearTimeout(timeout);
      }
      if (entries.get(id) !== entry) throw new Error("Browser attachment closed");
      if (!ownsConnection()) {
        close(entry);
        throw new Error("Browser window connection changed");
      }
      publishState(entry);
      return id;
    },
    async layout(win: BrowserWindow, value: PalotBrowserLayout) {
      // A queued layout from the renderer can arrive after server disconnect.
      if (!entries.has(value.bindingID)) return;
      const entry = owned(win, value.bindingID);
      entry.layouts.set(value.tabID, value);
      if (!value.visible || !value.bounds || value.bounds.width <= 0 || value.bounds.height <= 0) {
        entry.pages.get(value.tabID)?.setVisible(false);
        return;
      }
      if (!entry.pages.has(value.tabID) && entry.tabs.get(value.tabID)?.loadError) return;
      const page = await load(entry, value.tabID);
      if (!page) return;
      if (entries.get(entry.id) !== entry || entry.pages.get(value.tabID) !== page) return;
      if (entry.layouts.get(value.tabID) !== value) return;
      entry.pages.forEach((other) => {
        if (other !== page) other.setVisible(false);
      });
      page.layout(value.bounds, undefined, value.radius);
      page.setVisible(true);
      if (entry.pendingPopupFocus === value.tabID && entry.focusedTabID === value.tabID) {
        entry.pendingPopupFocus = undefined;
        page.focus();
      }
    },
    async command(
      win: BrowserWindow,
      id: string,
      command: PalotBrowserUserCommand,
      pane?: "right" | "bottom",
    ) {
      const entry = owned(win, id);
      const result = await execute(
        entry,
        { action: command, files: [] },
        new AbortController().signal,
        pane,
      );
      if (command.type === "tabs.open") return (result.value as Browser.Tab).id;
    },
    pageControl(
      win: BrowserWindow,
      id: string,
      tabID: Browser.TabID,
      control: PalotBrowserPageControl,
    ) {
      const entry = owned(win, id);
      if (!entry.tabs.has(tabID)) throw new Error("Browser page is unavailable");
      const page = entry.pages.get(tabID);
      if (!page || page.contents.isDestroyed()) throw new Error("Browser page is not ready");
      if (control.type === "find") {
        if (control.query)
          page.contents.findInPage(control.query, {
            forward: control.forward !== false,
            findNext: control.next === true,
          });
        else page.contents.stopFindInPage("clearSelection");
        return;
      }
      if (control.type === "find.stop") {
        page.contents.stopFindInPage("clearSelection");
        return;
      }
      const current = page.contents.getZoomLevel();
      page.contents.setZoomLevel(
        control.direction === 0 ? 0 : Math.max(-4, Math.min(5, current + control.direction * 0.5)),
      );
      return Math.round(page.contents.getZoomFactor() * 100);
    },
    async clearData(win: BrowserWindow, input: PalotBrowserRegistration) {
      if (disposed || win.isDestroyed() || win.webContents.isDestroyed())
        throw new Error("Browser owner is unavailable");
      const key = browserRestoreKey(input.profileID, input.sessionID);
      const attached = [...entries.values()].filter((entry) => entry.storageKey === key);
      if (attached.some((entry) => entry.win !== win))
        throw new Error(
          "Close this task's browser in other Palot windows before clearing its data",
        );
      const entry = attached[0];
      if (entry && (entry.registration.connectionID !== input.connectionID || entry.clearing))
        throw new Error("Browser data is already being cleared or its connection changed");
      if (clearingKeys.has(key)) throw new Error("Browser data is already being cleared");
      if (entry) owned(win, entry.id);
      clearingKeys.add(key);
      if (entry) entry.clearing = true;
      try {
        const failures: unknown[] = [];
        if (entry) {
          // Disposal removes each guest's agent captures and temporary downloads.
          // Clear storage only after closing guests so they cannot rewrite cookies on unload.
          for (const id of entry.tabs.keys()) {
            if (!entry.tabs.has(id)) continue;
            try {
              await closePage(entry, id);
            } catch (error) {
              // An opener can already have closed its child popup concurrently.
              if (!(error instanceof Error && error.message === "Browser tab is unavailable"))
                failures.push(error);
            }
          }
          failures.push(...(await wipePartition(entry.partition)));
        }
        for (const [name, disposed] of retired.get(key) ?? []) {
          const results = await disposed;
          for (const result of results)
            if (result.status === "rejected") failures.push(result.reason);
          const partitionFailures = await wipePartition(name);
          failures.push(...partitionFailures);
          if (partitionFailures.length === 0) retired.get(key)?.delete(name);
        }
        if (retired.get(key)?.size === 0) retired.delete(key);
        restore().remove(key);
        if (failures.length)
          throw new Error("Some browser data could not be removed", { cause: failures[0] });
      } finally {
        if (entry) entry.clearing = false;
        clearingKeys.delete(key);
      }
    },
    close(win: BrowserWindow, id: string) {
      // Renderer cleanup (including route unmount and disabling the setting) uses this same
      // IPC. Preserve the inventory; tabs.close is the explicit per-tab removal operation.
      // Renderer cleanup can race an attachment that the server already closed.
      if (!entries.has(id)) return;
      close(owned(win, id));
    },
    async dispose() {
      disposed = true;
      for (const entry of entries.values()) close(entry);
      await Promise.allSettled(
        [...retired.values()].flatMap((partitions) => [...partitions.values()]),
      );
      await runtime.dispose();
    },
  };
}
