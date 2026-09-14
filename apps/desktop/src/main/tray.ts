import path from "node:path";
import type { OpenCodeEvent, Project, SessionInfo } from "@opencode/client";
import { app, Menu, nativeImage, Tray, type MenuItemConstructorOptions } from "electron";
import type {
  AttentionNotificationInput,
  AttentionSnapshotInput,
  PalotSession,
  OpenCodeRuntimeStatus,
} from "../shared/opencode-contract";
import { openCodeAttentionIndex } from "./attention-index";
import { desktopNavigation } from "./desktop-navigation";
import { openCodeRuntime } from "./opencode-runtime";
import { sessionTriageStore } from "./session-triage-store";
import { DesktopStatus } from "./desktop-status";
import { desktopProbe } from "./linux-desktop";
import { followLinuxTrayAppearance } from "./tray-appearance";
import {
  formatTrayRelativeTime,
  prioritizeTrayTasks,
  type TrayTaskItem,
  type TrayTaskSection,
  type TrayTaskSections,
} from "./tray-menu";

const REQUEST_TIMEOUT_MS = 30_000;
const RECENT_SESSION_LIMIT = 50;
const REFRESH_DELAY_MS = 150;
const REFRESH_EVENT_TYPES = new Set<OpenCodeEvent["type"]>([
  "session.created",
  "session.deleted",
  "session.renamed",
  "session.moved",
  "session.execution.started",
  "session.execution.succeeded",
  "session.execution.failed",
  "session.execution.interrupted",
  "session.status",
]);
const SECTION_LABELS: Record<TrayTaskSection, string> = {
  attention: "Needs Attention",
  pinned: "Pinned",
  running: "Running",
  recent: "Recent",
};

let controller: TrayController | null = null;

class TrayController {
  private readonly tray: Tray | null;
  private stopFollowingAppearance?: () => void;
  private disposed = false;
  private sections: TrayTaskSections = { attention: [], pinned: [], running: [], recent: [] };
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private refreshPromise: Promise<void> | null = null;
  private attentionRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly connections = new Map<
    string,
    {
      runtime: OpenCodeRuntimeStatus;
      sections: TrayTaskSections;
      input: AttentionSnapshotInput | null;
      attentionState: "syncing" | "ready" | "error";
      unsubscribe: () => void;
    }
  >();
  private readonly dirty = new Set<string>();
  private readonly attentionDirty = new Set<string>();
  private attentionState: "syncing" | "ready" | "error" = "syncing";
  private activated = false;
  private readonly unsubscribeEvent: () => void;
  private readonly unsubscribeStatus: () => void;
  private readonly unsubscribeDisposed: () => void;

  constructor(
    iconPath: string | null,
    private readonly displayName: string,
    private readonly status: DesktopStatus,
  ) {
    if (iconPath) {
      const icon = nativeImage.createFromPath(iconPath);
      icon.setTemplateImage(process.platform === "darwin");
      this.tray = new Tray(icon);
      if (process.platform === "linux")
        this.stopFollowingAppearance = followLinuxTrayAppearance(this.tray, iconPath);
      this.tray.setToolTip(displayName);
      if (process.platform === "darwin") {
        this.tray.on("click", () => void this.openMenu());
        this.tray.on("right-click", () => void this.openMenu());
      } else {
        this.tray.setContextMenu(this.buildMenu());
      }
    } else this.tray = null;
    this.unsubscribeEvent = openCodeRuntime.onScopedEvent((event, runtime) =>
      this.handleEvent(event, runtime),
    );
    this.unsubscribeStatus = openCodeRuntime.onRuntimeStatus((runtime) => {
      const entry = this.connections.get(runtime.connectionID);
      if (entry) {
        const previous = entry.runtime;
        entry.runtime = runtime;
        if (
          previous.connected === runtime.connected &&
          previous.phase === runtime.phase &&
          previous.lastConnectedAt === runtime.lastConnectedAt
        )
          return;
      }
      this.dirty.add(runtime.connectionID);
      this.invalidate(false);
    });
    this.unsubscribeDisposed = openCodeRuntime.onConnectionDisposed((connectionID) => {
      this.connections.get(connectionID)?.unsubscribe();
      this.connections.delete(connectionID);
      this.projectSections();
      this.publish();
    });
    if (process.platform === "linux") {
      this.activated = true;
      this.invalidate();
    }
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    this.stopFollowingAppearance?.();
    this.unsubscribeEvent();
    this.unsubscribeStatus();
    this.unsubscribeDisposed();
    for (const entry of this.connections.values()) entry.unsubscribe();
    this.connections.clear();
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    if (this.attentionRefreshTimer) clearTimeout(this.attentionRefreshTimer);
    this.refreshTimer = null;
    this.attentionRefreshTimer = null;
    this.tray?.destroy();
    await this.status.dispose();
  }

  invalidate(refreshAll = true): void {
    if (!this.activated || this.disposed) return;
    if (refreshAll)
      for (const runtime of openCodeRuntime.listRuntimes()) this.dirty.add(runtime.connectionID);
    if (this.refreshTimer) return;
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      void this.refresh();
    }, REFRESH_DELAY_MS);
  }

  private async openMenu(): Promise<void> {
    this.activated = true;
    await this.refresh();
    if (!this.disposed) this.tray?.popUpContextMenu(this.buildMenu());
  }

  private handleEvent(event: OpenCodeEvent, runtime: OpenCodeRuntimeStatus): void {
    if (this.activated && REFRESH_EVENT_TYPES.has(event.type)) {
      this.dirty.add(runtime.connectionID);
      this.invalidate(false);
    }
  }

  private invalidateAttention(connectionID: string): void {
    this.attentionDirty.add(connectionID);
    const entry = this.connections.get(connectionID);
    if (entry) entry.attentionState = "syncing";
    if (this.attentionRefreshTimer) return;
    this.attentionState = "syncing";
    this.publish();
    this.attentionRefreshTimer = setTimeout(() => {
      this.attentionRefreshTimer = null;
      void this.refreshAttention();
    }, REFRESH_DELAY_MS);
  }

  private async refreshAttention(): Promise<void> {
    const ids = [...this.attentionDirty];
    this.attentionDirty.clear();
    await Promise.all(
      ids.map(async (connectionID) => {
        const entry = this.connections.get(connectionID);
        const input = entry?.input;
        if (!entry || !input) return true;
        const result = await this.loadAttention(input, entry.runtime.profileID).catch(() => null);
        if (this.connections.get(connectionID) !== entry || entry.input !== input || this.disposed)
          return true;
        if (result)
          entry.sections.attention = result.complete
            ? result.items
            : [
                ...new Map(
                  [...entry.sections.attention, ...result.items].map((item) => [
                    item.sessionID,
                    item,
                  ]),
                ).values(),
              ];
        entry.attentionState = result?.complete ? "ready" : "error";
      }),
    );
    this.projectSections();
    this.publish();
  }

  private refresh(): Promise<void> {
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = this.loadSections()
      .then((sections) => {
        this.sections = sections;
        this.publish();
      })
      .catch(() => undefined)
      .finally(() => {
        this.refreshPromise = null;
        if (this.dirty.size) this.invalidate(false);
      });
    return this.refreshPromise;
  }

  private publish(): void {
    if (this.disposed) return;
    if (process.platform === "linux") this.tray?.setContextMenu(this.buildMenu());
    this.status.publish(this.sections);
  }

  private async loadSections(): Promise<TrayTaskSections> {
    const runtimes = openCodeRuntime.listRuntimes().filter((runtime) => runtime.connected);
    const ids = new Set(runtimes.map((runtime) => runtime.connectionID));
    for (const id of this.dirty) if (!ids.has(id)) this.dirty.delete(id);
    for (const [id, entry] of this.connections) {
      if (ids.has(id)) continue;
      entry.unsubscribe();
      this.connections.delete(id);
    }
    await Promise.allSettled(
      runtimes.map(async (runtime) => {
        const { connectionID } = runtime;
        let entry = this.connections.get(connectionID);
        if (!entry) {
          entry = {
            runtime,
            sections: { attention: [], pinned: [], running: [], recent: [] },
            input: null,
            attentionState: "syncing",
            unsubscribe: openCodeAttentionIndex(connectionID).subscribe(() =>
              this.invalidateAttention(connectionID),
            ),
          };
          this.connections.set(connectionID, entry);
          this.dirty.add(connectionID);
        }
        if (!this.dirty.delete(connectionID)) return;
        const sections = await this.loadConnectionSections(runtime);
        if (this.connections.get(connectionID) === entry && !this.disposed)
          entry.sections = sections;
      }),
    );
    this.projectSections();
    return this.sections;
  }

  private projectSections(): void {
    const sections: TrayTaskSections = { attention: [], pinned: [], running: [], recent: [] };
    const updated = new Map<string, number>();
    for (const entry of this.connections.values()) {
      for (const session of entry.input?.sessions ?? [])
        updated.set(JSON.stringify([entry.runtime.profileID, session.id]), session.updatedAt);
      for (const section of ["attention", "pinned", "running", "recent"] as const)
        sections[section].push(...entry.sections[section]);
    }
    const timestamp = (item: TrayTaskItem) =>
      updated.get(
        JSON.stringify([
          item.target.type === "session" ? item.target.profileID : undefined,
          item.sessionID,
        ]),
      ) ?? 0;
    sections.running.sort((left, right) => timestamp(right) - timestamp(left));
    sections.recent.sort((left, right) => timestamp(right) - timestamp(left));
    this.sections = prioritizeTrayTasks(sections);
    const states = [...this.connections.values()].map((entry) => entry.attentionState);
    this.attentionState = states.includes("error")
      ? "error"
      : states.includes("syncing")
        ? "syncing"
        : "ready";
  }

  private async loadConnectionSections(runtime: OpenCodeRuntimeStatus): Promise<TrayTaskSections> {
    const { connectionID, profileID } = runtime;
    return openCodeRuntime.scopedConnection(connectionID).withClient(async (client) => {
      const [recentResponse, active, projects] = await Promise.all([
        client.session.list(
          { limit: RECENT_SESSION_LIMIT, order: "desc", parentID: null },
          { signal: requestSignal() },
        ),
        client.session.active({ signal: requestSignal() }),
        client.project.list({ signal: requestSignal() }),
      ]);
      const recent = recentResponse.data.filter((session) => session.time.archived === undefined);
      const sessions = new Map(recent.map((session) => [session.id, session]));
      const pendingSessions = new Map<string, Promise<SessionInfo>>();
      const getSession = async (sessionID: string) => {
        const cached = sessions.get(sessionID);
        if (cached) return cached;
        let pending = pendingSessions.get(sessionID);
        if (!pending) {
          pending = client.session.get({ sessionID }, { signal: requestSignal() });
          pendingSessions.set(sessionID, pending);
        }
        const session = await pending;
        sessions.set(session.id, session);
        return session;
      };
      const rootSession = async (sessionID: string) => {
        let session = await getSession(sessionID);
        const visited = new Set([session.id]);
        while (session.parentID && !visited.has(session.parentID)) {
          visited.add(session.parentID);
          session = await getSession(session.parentID);
        }
        return session;
      };
      const activeRoots = await settledValues(
        Object.keys(active).map((sessionID) => () => rootSession(sessionID)),
      );
      const pinnedRecords = sessionTriageStore()
        .load(profileID)
        .sessions.filter((record) => record.pinnedAt !== null)
        .toSorted((left, right) => (right.pinnedAt ?? 0) - (left.pinnedAt ?? 0));
      const pinnedRoots = await settledValues(
        pinnedRecords.map((record) => async () => ({
          session: await rootSession(record.sessionID),
          pinnedAt: record.pinnedAt ?? 0,
        })),
      );
      const attentionInput = attentionSnapshotInput(connectionID, sessions.values());
      const entry = this.connections.get(connectionID);
      if (entry) entry.input = attentionInput;
      this.invalidateAttention(connectionID);
      const projectNames = new Map(projects.map((project) => [project.id, projectName(project)]));

      return {
        attention: entry?.sections.attention ?? [],
        pinned: pinnedRoots.map(({ session }) =>
          taskItem(
            session,
            `${projectNames.get(session.projectID) ?? "Project"} · Pinned`,
            profileID,
          ),
        ),
        running: activeRoots
          .toSorted((left, right) => right.time.updated - left.time.updated)
          .map((session) =>
            taskItem(
              session,
              `${projectNames.get(session.projectID) ?? "Project"} · Running`,
              profileID,
            ),
          ),
        recent: recent.map((session) =>
          taskItem(
            session,
            `${projectNames.get(session.projectID) ?? "Project"} · ${formatTrayRelativeTime(session.time.updated)}`,
            profileID,
          ),
        ),
      };
    });
  }

  private async loadAttention(
    input: AttentionSnapshotInput,
    profileID: string,
  ): Promise<{ items: TrayTaskItem[]; complete: boolean }> {
    const snapshot = await openCodeAttentionIndex(input.connectionID).snapshot(input);
    const sessions = new Map(
      [...input.sessions, ...snapshot.sessions].map((session) => [session.id, session]),
    );
    const requests: AttentionNotificationInput[] = [];
    for (const entry of snapshot.requests) {
      for (const value of entry.value.permissions) {
        requests.push({ sessionID: value.sessionID, requestID: value.id, type: "permission" });
      }
      for (const value of entry.value.forms) {
        requests.push({
          sessionID: value.sessionID,
          requestID: value.id,
          type: value.metadata?.kind === "question" ? "question" : "form",
        });
      }
    }
    const byRoot = new Map<
      string,
      { root: PalotSession; request: AttentionNotificationInput; count: number }
    >();
    for (const request of new Map(requests.map((value) => [attentionKey(value), value])).values()) {
      const root = rootSessionFromMap(sessions, request.sessionID);
      if (!root) continue;
      const current = byRoot.get(root.id);
      if (current) current.count += 1;
      else byRoot.set(root.id, { root, request, count: 1 });
    }
    const items: TrayTaskItem[] = [...byRoot.values()]
      .toSorted((left, right) => left.root.updatedAt - right.root.updatedAt)
      .map(({ root, request, count }) => ({
        sessionID: root.id,
        title: sessionTitle(root),
        detail: `${connectionName(profileID)} · ${count > 1 ? `${count} requests waiting` : attentionLabel(request.type)}`,
        target: {
          type: "session",
          profileID,
          sessionID: request.sessionID,
          requestID: request.requestID,
          requestType: request.type,
        },
      }));
    return { items, complete: snapshot.complete };
  }

  private buildMenu(): Menu {
    const template: MenuItemConstructorOptions[] = [];
    if (this.connections.size && this.attentionState !== "ready") {
      template.push({
        label: this.attentionState === "syncing" ? "Syncing requests…" : "Requests unavailable",
        enabled: false,
      });
    }
    for (const section of ["attention", "pinned", "running", "recent"] as const) {
      const items = this.sections[section];
      if (items.length === 0) continue;
      if (template.length > 0) template.push({ type: "separator" });
      template.push({ label: SECTION_LABELS[section], enabled: false });
      template.push(
        ...items.map((item) => ({
          label: item.title,
          sublabel: item.detail,
          click: () => desktopNavigation.request(item.target),
        })),
      );
    }
    if (template.length === 0) template.push({ label: "No tasks yet", enabled: false });
    template.push(
      { type: "separator" },
      {
        label: `Open ${this.displayName}`,
        click: () => desktopNavigation.request({ type: "open" }),
      },
      { label: "New Task", click: () => desktopNavigation.request({ type: "new-task" }) },
      {
        label: "Notification Settings...",
        click: () => desktopNavigation.request({ type: "notification-settings" }),
      },
      { type: "separator" },
      { label: `Quit ${this.displayName}`, role: "quit" },
    );
    return Menu.buildFromTemplate(template);
  }
}

export async function installTray(input: {
  currentDirectory: string;
  displayName: string;
  appID: string;
  iconVariant: string;
}): Promise<void> {
  if ((process.platform !== "darwin" && process.platform !== "linux") || controller) return;
  const linux = process.platform === "linux";
  const names = linux
    ? await desktopProbe("busctl", ["--user", "--no-pager", "--no-legend", "list"])
    : null;
  const host = !linux || Boolean(names?.includes("org.kde.StatusNotifierWatcher"));
  if (!host && process.env.PALOT_OMARCHY_STATUS !== "1") return;
  const resource = linux ? "tray/trayLinux.png" : "tray/trayTemplate.png";
  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, "icons", resource)
    : path.join(input.currentDirectory, "../../resources/icons", resource);
  try {
    controller = new TrayController(
      host ? iconPath : null,
      input.displayName,
      new DesktopStatus(input.appID),
    );
  } catch (error) {
    console.warn("[tray] Desktop tray unavailable", error);
  }
}

export function refreshTrayMenu(): void {
  controller?.invalidate();
}

export async function destroyTray(): Promise<void> {
  await controller?.dispose();
  controller = null;
}

function taskItem(session: SessionInfo, detail: string, profileID: string): TrayTaskItem {
  return {
    sessionID: session.id,
    title: sessionTitle(session),
    detail: `${connectionName(profileID)} · ${detail}`,
    target: { type: "session", profileID, sessionID: session.id },
  };
}

function sessionTitle(session: Pick<SessionInfo, "title"> | Pick<PalotSession, "title">): string {
  const title = session.title?.trim() || "Untitled task";
  return title.length <= 64 ? title : `${title.slice(0, 61)}...`;
}

function connectionName(profileID: string): string {
  return (
    openCodeRuntime.profileSnapshot().profiles.find((profile) => profile.id === profileID)?.name ??
    profileID
  );
}

function attentionSnapshotInput(
  connectionID: string,
  sessions: Iterable<SessionInfo>,
): AttentionSnapshotInput {
  const mappedSessions = [...sessions].map(mapSession);
  return { connectionID, sessions: mappedSessions };
}

function rootSessionFromMap(
  sessions: ReadonlyMap<string, PalotSession>,
  sessionID: string,
): PalotSession | null {
  let session = sessions.get(sessionID);
  if (!session) return null;
  const visited = new Set([session.id]);
  while (session.parentID && !visited.has(session.parentID)) {
    const parent = sessions.get(session.parentID);
    if (!parent) break;
    visited.add(parent.id);
    session = parent;
  }
  return session;
}

function mapSession(session: SessionInfo): PalotSession {
  return {
    id: session.id,
    parentID: session.parentID ?? null,
    projectID: session.projectID,
    title: session.title ?? null,
    agent: session.agent ?? null,
    model: session.model ? { ...session.model } : null,
    location: { ...session.location },
    createdAt: session.time.created,
    updatedAt: session.time.updated,
    ...(session.time.idle === undefined ? {} : { idleAt: session.time.idle }),
    ...(session.time.viewed === undefined ? {} : { viewedAt: session.time.viewed }),
    ...(session.outcome ? { outcome: session.outcome } : {}),
    archivedAt: session.time.archived ?? null,
    cost: session.cost,
    tokens: {
      input: session.tokens.input,
      output: session.tokens.output,
      reasoning: session.tokens.reasoning,
      cache: { ...session.tokens.cache },
    },
    ...(session.revert
      ? {
          revert: {
            ...session.revert,
            ...(session.revert.files
              ? { files: session.revert.files.map((file) => ({ ...file })) }
              : {}),
          },
        }
      : {}),
  };
}

function projectName(project: Project): string {
  return project.name?.trim() || path.basename(project.canonical) || "Project";
}

function attentionLabel(type: AttentionNotificationInput["type"]): string {
  if (type === "permission") return "Permission required";
  if (type === "form") return "Form response required";
  if (type === "question") return "Question waiting";
  return "Input required";
}

function attentionKey(input: AttentionNotificationInput): string {
  return `${input.sessionID}:${input.type}:${input.requestID}`;
}

function requestSignal(): AbortSignal {
  return AbortSignal.timeout(REQUEST_TIMEOUT_MS);
}

async function settledValues<T>(tasks: Array<() => Promise<T>>): Promise<T[]> {
  const results = new Map<number, T>();
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(4, tasks.length) }, async () => {
      while (next < tasks.length) {
        const index = next++;
        const task = tasks[index]!;
        try {
          results.set(index, await task());
        } catch {
          /* A missing task must not hide other servers. */
        }
      }
    }),
  );
  return [...results.entries()].sort(([left], [right]) => left - right).map(([, value]) => value);
}
