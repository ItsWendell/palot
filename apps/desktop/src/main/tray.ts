import path from "node:path";
import type { OpenCodeEvent, Project, SessionInfo } from "@opencode/client";
import { app, Menu, nativeImage, Tray, type MenuItemConstructorOptions } from "electron";
import type {
  AttentionNotificationInput,
  AttentionSnapshotInput,
  PalotSession,
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
  private attentionInput: AttentionSnapshotInput | null = null;
  private attentionState: "syncing" | "ready" | "error" = "syncing";
  private attentionConnectionID: string | null = null;
  private activated = false;
  private readonly unsubscribeEvent: () => void;
  private readonly unsubscribeReconnect: () => void;
  private unsubscribeAttention?: () => void;

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
    this.unsubscribeEvent = openCodeRuntime.onEvent((event) => this.handleEvent(event));
    this.unsubscribeReconnect = openCodeRuntime.onReconnect(() => {
      if (!this.activated) return;
      this.attentionState = "syncing";
      this.publish();
      return this.refresh();
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
    this.unsubscribeReconnect();
    this.unsubscribeAttention?.();
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    if (this.attentionRefreshTimer) clearTimeout(this.attentionRefreshTimer);
    this.refreshTimer = null;
    this.attentionRefreshTimer = null;
    this.tray?.destroy();
    await this.status.dispose();
  }

  invalidate(): void {
    if (!this.activated || this.disposed) return;
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

  private handleEvent(event: OpenCodeEvent): void {
    if (this.activated && REFRESH_EVENT_TYPES.has(event.type)) this.invalidate();
  }

  private invalidateAttention(): void {
    if (!this.attentionInput || this.attentionRefreshTimer) return;
    this.attentionState = "syncing";
    this.publish();
    this.attentionRefreshTimer = setTimeout(() => {
      this.attentionRefreshTimer = null;
      void this.refreshAttention();
    }, REFRESH_DELAY_MS);
  }

  private async refreshAttention(): Promise<void> {
    const input = this.attentionInput;
    if (!input) return;
    const result = await this.loadAttention(input).catch(() => null);
    if (input !== this.attentionInput || this.disposed) return;
    this.attentionState = result?.complete ? "ready" : "error";
    if (!result) {
      this.publish();
      return;
    }
    const attention = result.complete
      ? result.items
      : [
          ...new Map(
            [...this.sections.attention, ...result.items].map((item) => [item.sessionID, item]),
          ).values(),
        ];
    this.sections = prioritizeTrayTasks({ ...this.sections, attention });
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
      });
    return this.refreshPromise;
  }

  private publish(): void {
    if (this.disposed) return;
    if (process.platform === "linux") this.tray?.setContextMenu(this.buildMenu());
    this.status.publish(this.sections);
  }

  private async loadSections(): Promise<TrayTaskSections> {
    const connectionID = openCodeRuntime.runtimeStatus().connectionID;
    return openCodeRuntime.withClient(async (client) => {
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
      const getSession = async (sessionID: string) => {
        const cached = sessions.get(sessionID);
        if (cached) return cached;
        const session = await client.session.get({ sessionID }, { signal: requestSignal() });
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
        Object.keys(active).map((sessionID) => rootSession(sessionID)),
      );
      const pinnedRecords = sessionTriageStore()
        .load(openCodeRuntime.runtimeStatus().profileID)
        .sessions.filter((record) => record.pinnedAt !== null)
        .toSorted((left, right) => (right.pinnedAt ?? 0) - (left.pinnedAt ?? 0));
      const pinnedRoots = await settledValues(
        pinnedRecords.map(async (record) => ({
          session: await rootSession(record.sessionID),
          pinnedAt: record.pinnedAt ?? 0,
        })),
      );
      if (connectionID !== openCodeRuntime.runtimeStatus().connectionID) {
        throw new Error("OpenCode connection changed while loading tray tasks");
      }
      const attentionInput = attentionSnapshotInput(connectionID, sessions.values());
      if (this.attentionConnectionID !== connectionID) {
        this.unsubscribeAttention?.();
        this.attentionConnectionID = connectionID;
        this.attentionState = "syncing";
        this.sections = { ...this.sections, attention: [] };
        this.unsubscribeAttention = openCodeAttentionIndex(connectionID).subscribe(() =>
          this.invalidateAttention(),
        );
      }
      this.attentionInput = attentionInput;
      this.invalidateAttention();
      const projectNames = new Map(projects.map((project) => [project.id, projectName(project)]));

      return prioritizeTrayTasks({
        attention: this.sections.attention,
        pinned: pinnedRoots.map(({ session }) =>
          taskItem(session, `${projectNames.get(session.projectID) ?? "Project"} · Pinned`),
        ),
        running: activeRoots
          .toSorted((left, right) => right.time.updated - left.time.updated)
          .map((session) =>
            taskItem(session, `${projectNames.get(session.projectID) ?? "Project"} · Running`),
          ),
        recent: recent.map((session) =>
          taskItem(
            session,
            `${projectNames.get(session.projectID) ?? "Project"} · ${formatTrayRelativeTime(session.time.updated)}`,
          ),
        ),
      });
    });
  }

  private async loadAttention(
    input: AttentionSnapshotInput,
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
        detail: count > 1 ? `${count} requests waiting` : attentionLabel(request.type),
        target: {
          type: "session",
          sessionID: request.sessionID,
          requestID: request.requestID,
          requestType: request.type,
        },
      }));
    return { items, complete: snapshot.complete };
  }

  private buildMenu(): Menu {
    const template: MenuItemConstructorOptions[] = [];
    if (this.attentionInput && this.attentionState !== "ready") {
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

function taskItem(session: SessionInfo, detail: string): TrayTaskItem {
  return {
    sessionID: session.id,
    title: sessionTitle(session),
    detail,
    target: { type: "session", sessionID: session.id },
  };
}

function sessionTitle(session: Pick<SessionInfo, "title"> | Pick<PalotSession, "title">): string {
  const title = session.title?.trim() || "Untitled task";
  return title.length <= 64 ? title : `${title.slice(0, 61)}...`;
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

async function settledValues<T>(promises: Promise<T>[]): Promise<T[]> {
  const results = await Promise.allSettled(promises);
  return results.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
}
