import { isSessionNotFoundError } from "@opencode/client";
import type {
  FileDiffInfo,
  FileSystemEntry,
  FormCancelInput,
  FormReplyInput,
  LocationRef,
  PermissionReplyInput,
  PermissionRulesInput,
  PermissionRuleset,
  SessionMessagesResponse,
  SessionStatsInput,
  SessionSwitchAgentInput,
  SessionSwitchModelInput,
  SessionTransferData,
} from "@opencode/client";
import { sessionTransferToMarkdown } from "../lib/session-markdown";
import { flushScheduledPersistedValues } from "../atoms/persisted";
import type { SshConnectionState, SshPromptResponse } from "../../shared/ssh-contract";
import type {
  AutomationChangedEvent,
  AutomationCommand,
  AutomationHostSettings,
  AutomationNotificationTarget,
  AutomationSchedulePreview,
  AutomationSnapshot,
  AutomationTrigger,
  AttentionSnapshotInput,
  AppearanceUpdateInput,
  AppearanceUpdateResult,
  DesktopNotificationSettings,
  FindWorkspaceFilesInput,
  ExternalOpenInput,
  ExternalOpenTarget,
  ListDiffsInput,
  ListModelsInput,
  RunCommandInput,
  OpenCodeRuntimeStatus,
  OpenCodeConnectInput,
  OpenCodePairImportInput,
  OpenCodePairingInfo,
  OpenCodeProfileCreateInput,
  OpenCodeProfileSnapshot,
  OpenCodeProfileTestResult,
  OpenCodeProfileUpdateInput,
  OpenCodeWebAccessInfo,
  PalotApi,
  PalotAttentionSnapshot,
  PalotComposerCatalog,
  PalotEventBatch,
  PalotModel,
  PalotModelCatalog,
  PalotPage,
  PalotOpenTarget,
  PalotProject,
  PalotPty,
  PalotPtyTransport,
  PalotSession,
  SessionTriageCommand,
  SessionTriageSnapshot,
  SessionRequestSnapshot,
  PalotSettingsSnapshot,
  RejectQuestionInput,
  ReplyQuestionInput,
  UpdatePendingInput,
} from "../../shared";
import {
  actionableErrorMessage,
  DEFAULT_DESKTOP_NOTIFICATION_SETTINGS,
  errorDiagnostic,
} from "../../shared";
import { mergeBuiltinCommands } from "../lib/builtin-commands";
import { openCodeClient } from "./opencode-client";
import { mapSession } from "./opencode-mappers";
import { openCodeRequestSignal } from "./opencode-request";
import {
  findWorkspaceFiles as findOpenCodeWorkspaceFiles,
  getSession as getOpenCodeSession,
  listDiffs as listOpenCodeDiffs,
  listModels as listOpenCodeModels,
  listWorkspaceDirectory as listOpenCodeWorkspaceDirectory,
  listRequests as listOpenCodeRequests,
  listRunningShells as listOpenCodeRunningShells,
  listSessionInputs as listOpenCodeSessionInputs,
  loadComposerCatalog as loadOpenCodeComposerCatalog,
  loadMessages as loadOpenCodeMessages,
  promptFiles,
  readWorkspaceFile as readOpenCodeWorkspaceFile,
  sendPrompt as sendOpenCodePrompt,
  sessionLocation,
} from "./opencode-resources";
import {
  activateCredential as activateOpenCodeCredential,
  addMcpServer as addOpenCodeMcpServer,
  addWellknownIntegration as addOpenCodeWellknownIntegration,
  cancelIntegrationCommand as cancelOpenCodeIntegrationCommand,
  cancelIntegrationOAuth as cancelOpenCodeIntegrationOAuth,
  checkPluginUpdates as checkOpenCodePluginUpdates,
  checkPlugins as checkOpenCodePlugins,
  completeIntegrationOAuth as completeOpenCodeIntegrationOAuth,
  connectIntegrationCommand as connectOpenCodeIntegrationCommand,
  connectIntegrationKey as connectOpenCodeIntegrationKey,
  connectIntegrationOAuth as connectOpenCodeIntegrationOAuth,
  connectMcpServer as connectOpenCodeMcpServer,
  disconnectMcpServer as disconnectOpenCodeMcpServer,
  integrationCommandStatus as openCodeIntegrationCommandStatus,
  integrationOAuthStatus as openCodeIntegrationOAuthStatus,
  loadSettings as loadOpenCodeSettings,
  removeCredential as removeOpenCodeCredential,
  removeMcpServer as removeOpenCodeMcpServer,
  removeSavedPermission as removeOpenCodeSavedPermission,
  updatePlugins as updateOpenCodePlugins,
  updateCredential as updateOpenCodeCredential,
  updatePlugin as updateOpenCodePlugin,
} from "./opencode-settings";
import {
  createWorktree as createOpenCodeWorktree,
  listWorktrees as listOpenCodeWorktrees,
  refreshWorktrees as refreshOpenCodeWorktrees,
  removeWorktree as removeOpenCodeWorktree,
} from "./opencode-worktrees";
import {
  createPty as createOpenCodePty,
  getPty as getOpenCodePty,
  listPtys as listOpenCodePtys,
  removePty as removeOpenCodePty,
  resizePty as resizeOpenCodePty,
  snapshotPty as snapshotOpenCodePty,
} from "./opencode-pty";

const now = Date.now();
let triageQueue = Promise.resolve();

async function getOwnedSession(client: ReturnType<typeof openCodeClient>, sessionID: string) {
  try {
    return mapSession(await client.session.get({ sessionID }, { signal: openCodeRequestSignal() }));
  } catch (error) {
    if (isSessionNotFoundError(error)) return null;
    throw error;
  }
}

function taskResourceError(session: PalotSession, resource: string, cause: unknown): Error {
  const task = `"${session.title || "Untitled task"}" (${session.id})`;
  let diagnostic: ReturnType<typeof errorDiagnostic> | undefined = errorDiagnostic(cause);
  while (diagnostic) {
    if (diagnostic.name === "TimeoutError" || diagnostic.code === "ETIMEDOUT") {
      return new Error(
        `${resource} for ${task} timed out while waiting for OpenCode. Retry the task; if it keeps happening, the OpenCode service may be busy or stuck.`,
        { cause },
      );
    }
    diagnostic = diagnostic.cause;
  }
  return new Error(
    `${resource} for ${task} failed: ${actionableErrorMessage(cause, "Unknown OpenCode error")}`,
    { cause },
  );
}

async function loadTaskResource<T>(
  session: PalotSession,
  resource: string,
  load: () => Promise<T>,
): Promise<T> {
  try {
    return await load();
  } catch (error) {
    throw taskResourceError(session, resource, error);
  }
}

function enqueueTriage<T>(run: () => Promise<T>): Promise<T> {
  const result = triageQueue.then(run, run);
  triageQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

function dispatchTriage(command: SessionTriageCommand): Promise<SessionTriageSnapshot> {
  return enqueueTriage(async () => {
    const api = getApi();
    if (!api) {
      return {
        profileID: command.profileID,
        bootstrapThrough: command.type === "bootstrap" ? command.through : null,
        sessions: [],
      };
    }
    return api.dispatchSessionTriage(command);
  });
}

const previewTokens = {
  input: 8_420,
  output: 1_280,
  reasoning: 640,
  cache: { read: 12_000, write: 0 },
};
const previewProject: PalotProject = {
  id: "palot-2",
  canonical: "/Users/you/Projects/palot-2",
  name: "Palot 2",
  sandboxes: [],
  vcs: null,
  updatedAt: now,
};

const previewSessions: PalotSession[] = [
  {
    id: "first-shell",
    projectID: previewProject.id,
    parentID: null,
    title: "Build the first Palot 2 shell",
    agent: "build",
    model: { id: "gpt-5.6", providerID: "openai" },
    location: { directory: previewProject.canonical },
    createdAt: now - 600_000,
    updatedAt: now,
    archivedAt: null,
    cost: null,
    tokens: previewTokens,
  },
  {
    id: "transport",
    projectID: previewProject.id,
    parentID: null,
    title: "OpenCode transport and recovery",
    agent: "build",
    model: null,
    location: { directory: previewProject.canonical },
    createdAt: now - 3_600_000,
    updatedAt: now - 1_080_000,
    archivedAt: null,
    cost: null,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  },
];

const previewMessages: SessionMessagesResponse["data"] = [
  {
    id: "user-1",
    type: "user",
    time: { created: now - 480_000 },
    text: "Build the first working Palot 2 shell. Keep it fast, calm, and focused on OpenCode 2.",
  },
  {
    id: "assistant-1",
    type: "assistant",
    time: { created: now - 450_000, completed: now - 90_000 },
    agent: "build",
    model: { id: "gpt-5.6", providerID: "openai" },
    tokens: previewTokens,
    finish: "stop",
    content: [
      {
        type: "text",
        text: "I’ll start with the product spine: projects and tasks on the left, one readable thread in the middle, and the current diff on the right. OpenCode remains the source of truth.",
      },
      {
        type: "tool",
        id: "tool-1",
        name: "shell",
        time: { created: now - 400_000, completed: now - 360_000 },
        state: {
          status: "completed",
          input: {},
          content: [{ type: "text", text: "Found 1 project, 2 tasks, and 4 changed files." }],
          metadata: { title: "Inspect workspace and OpenCode contracts" },
        },
      },
      {
        type: "text",
        text: "The transcript uses measured virtual rows. Stream updates only replace the touched message, and every disconnect starts a full rehydrate.",
      },
    ],
  },
  {
    id: "assistant-live",
    type: "assistant",
    time: { created: now - 25_000 },
    agent: "build",
    model: { id: "gpt-5.6", providerID: "openai" },
    content: [
      {
        type: "tool",
        id: "tool-live",
        name: "write",
        time: { created: now - 20_000, ran: now - 20_000 },
        state: { status: "running", input: {}, metadata: { title: "Create renderer shell" } },
      },
    ],
  },
];

const previewDiffs: FileDiffInfo[] = [
  {
    file: "apps/desktop/src/renderer/app.tsx",
    status: "added",
    additions: 9,
    deletions: 0,
    patch:
      '@@ -0,0 +1,8 @@\n+import { Provider } from "jotai"\n+import { Workspace } from "./components/workspace"\n+\n+export function App() {\n+  return (\n+    <Provider>\n+      <Workspace />\n+    </Provider>\n+  )\n+}',
  },
  {
    file: "apps/desktop/src/renderer/index.css",
    status: "added",
    additions: 420,
    deletions: 0,
    patch: "",
  },
  {
    file: "apps/desktop/src/renderer/components/thread.tsx",
    status: "added",
    additions: 226,
    deletions: 0,
    patch: "",
  },
];

const previewRequests: SessionRequestSnapshot = {
  permissions: [
    {
      id: "permission-1",
      sessionID: "first-shell",
      action: "shell",
      resources: ["bun run test"],
      save: ["bun run *"],
      source: { type: "tool", messageID: "assistant-live", id: "tool-live" },
    },
  ],
  forms: [
    {
      id: "question-preview",
      sessionID: "first-shell",
      title: "Approach",
      metadata: { kind: "question" },
      fields: [
        {
          key: "approach",
          type: "string",
          title: "Approach",
          description: "How should the pending request controls behave?",
          options: [
            {
              value: "inline",
              label: "Inline",
              description: "Answer directly in the request card",
            },
            {
              value: "composer",
              label: "Composer",
              description: "Move the answer into the main composer",
            },
          ],
          custom: true,
        },
      ],
    },
  ],
  inbox: [
    {
      id: "msg_pending_preview",
      sessionID: "first-shell",
      timeCreated: now,
      type: "user",
      payload: { text: "Run the full test suite after the current turn." },
      delivery: "queue",
    },
  ],
  errors: [],
};

const previewRuntime: OpenCodeRuntimeStatus = {
  connectionID: "preview",
  profileID: "preview",
  contractVersion: "0.0.0-beta-19507",
  phase: "connected",
  connected: true,
  source: "shared-service",
  topology: "same-machine",
  capabilities: {
    serverFilesystem: true,
    localPathActions: true,
    localFileAttachments: true,
    worktreeCreate: true,
    pty: "persistent",
    scheduledAutomations: true,
    manualAutomations: true,
    integrationCallback: "local",
    pairing: "show",
  },
  binaryPath: "/opt/homebrew/bin/opencode",
  version: "2.0.0",
  pid: 42001,
  managed: true,
  lastConnectedAt: now,
  error: null,
  versionMismatch: null,
};

const previewSettings: PalotSettingsSnapshot = {
  location: { directory: previewProject.canonical },
  configSources: [
    {
      type: "document",
      path: "~/.config/opencode/opencode.json",
      summary: { snapshots: true },
      formatters: [],
      languageServers: [],
      permissions: [],
    },
  ],
  catalog: {
    models: [],
    defaultModel: null,
    providers: [
      {
        id: "openai",
        canonicalID: "openai",
        name: "OpenAI",
        integrationID: "openai",
        package: "@ai-sdk/openai",
        disabled: false,
      },
    ],
    errors: [],
  },
  agents: [
    {
      id: "build",
      name: "Build",
      description: "Default coding agent",
      mode: "primary",
      hidden: false,
      color: null,
      steps: null,
      model: null,
      permissions: [],
    },
  ],
  integrations: [
    {
      id: "openai",
      name: "OpenAI",
      methods: [{ id: null, type: "key", label: "API key", form: [] }],
      connections: [{ type: "env", id: null, label: "OPENAI_API_KEY", active: true }],
    },
  ],
  mcpServers: [{ name: "context7", status: "connected", error: null, integrationID: null }],
  mcpResources: [],
  mcpResourceTemplates: [],
  savedPermissions: [
    {
      id: "permission-preview",
      projectID: previewProject.id,
      action: "shell",
      resource: "git status *",
    },
  ],
  plugins: [
    {
      id: "opencode-preview-plugin",
      source: { type: "local", path: "~/.config/opencode/plugins/preview" },
      features: { server: true, rpc: true },
      state: { status: "active" },
    },
  ],
  skills: [
    {
      id: "explore",
      name: "Explore",
      description: "Read-only workspace exploration",
      location: "~/.config/opencode/skills/explore",
      slash: true,
      autoinvoke: true,
    },
  ],
  commands: [
    {
      name: "review",
      description: "Review current changes",
      agent: "build",
      model: null,
      subtask: false,
    },
  ],
  references: [],
  websearchProviders: [{ id: "exa", name: "Exa" }],
  errors: [],
};

function apiAvailable(): boolean {
  return typeof window !== "undefined" && typeof getApi()?.runtimeStatus === "function";
}

function getApi(): PalotApi | undefined {
  return window.palot;
}

export const palot = {
  isPreview: () => !apiAvailable(),

  async openCodeReleaseStatus() {
    const api = getApi();
    if (!api) throw new Error("OpenCode releases are available in the desktop app");
    return api.openCodeReleaseStatus();
  },

  async setOpenCodeReleaseChannel(
    channel: import("../../shared/opencode-release-contract").OpenCodeReleaseChannel,
  ) {
    const api = getApi();
    if (!api) throw new Error("OpenCode releases are available in the desktop app");
    const result = await api.setOpenCodeReleaseChannel(channel);
    window.dispatchEvent(new Event("palot:opencode-release-changed"));
    return result;
  },

  async checkOpenCodeRelease() {
    const api = getApi();
    if (!api) throw new Error("OpenCode releases are available in the desktop app");
    const result = await api.checkOpenCodeRelease();
    window.dispatchEvent(new Event("palot:opencode-release-changed"));
    return result;
  },

  async prepareOpenCodeRelease(input: { version: string; allowUntested?: boolean }) {
    const api = getApi();
    if (!api) throw new Error("OpenCode releases are available in the desktop app");
    const result = await api.prepareOpenCodeRelease(input);
    window.dispatchEvent(new Event("palot:opencode-release-changed"));
    return result;
  },

  async resetOpenCodeRelease() {
    const api = getApi();
    if (!api) throw new Error("OpenCode releases are available in the desktop app");
    const result = await api.resetOpenCodeRelease();
    window.dispatchEvent(new Event("palot:opencode-release-changed"));
    return result;
  },

  async inspectOpenCodeInstallations() {
    const api = getApi();
    if (!api) throw new Error("OpenCode installations are available in the desktop app");
    return api.inspectOpenCodeInstallations();
  },

  async openCodeInstallationStatus() {
    const api = getApi();
    if (!api) throw new Error("OpenCode installations are available in the desktop app");
    return api.openCodeInstallationStatus();
  },

  async setOpenCodeRuntimePreference(
    preference: import("../../shared/opencode-installation-contract").OpenCodeRuntimePreference,
  ) {
    const api = getApi();
    if (!api) throw new Error("OpenCode installations are available in the desktop app");
    const result = await api.setOpenCodeRuntimePreference(preference);
    window.dispatchEvent(new Event("palot:opencode-release-changed"));
    return result;
  },

  async selectOpenCodeInstallation(id: string) {
    const api = getApi();
    if (!api) throw new Error("OpenCode installations are available in the desktop app");
    const result = await api.selectOpenCodeInstallation(id);
    window.dispatchEvent(new Event("palot:opencode-release-changed"));
    return result;
  },

  async upgradeOpenCodeInstallation(
    input: import("../../shared/opencode-installation-contract").OpenCodeInstallationUpgradeInput,
  ) {
    const api = getApi();
    if (!api) throw new Error("OpenCode installations are available in the desktop app");
    const result = await api.upgradeOpenCodeInstallation(input);
    window.dispatchEvent(new Event("palot:opencode-release-changed"));
    return result;
  },

  async runtimeStatus(): Promise<OpenCodeRuntimeStatus> {
    const api = getApi();
    return api ? api.runtimeStatus() : previewRuntime;
  },

  async connectOpenCode(input?: OpenCodeConnectInput): Promise<OpenCodeRuntimeStatus> {
    const api = getApi();
    return api ? api.connectOpenCode(input) : previewRuntime;
  },

  async listOpenCodeProfiles(): Promise<OpenCodeProfileSnapshot> {
    const api = getApi();
    return api
      ? api.listOpenCodeProfiles()
      : {
          activeProfileID: "local-default",
          profiles: [{ id: "local-default", kind: "local", name: "Local OpenCode" }],
        };
  },

  async createOpenCodeProfile(input: OpenCodeProfileCreateInput): Promise<OpenCodeProfileSnapshot> {
    const api = getApi();
    if (!api) throw new Error("OpenCode profile settings are unavailable in preview mode");
    const snapshot = await api.createOpenCodeProfile(input);
    window.dispatchEvent(new Event("palot:profiles-changed"));
    return snapshot;
  },

  async updateOpenCodeProfile(input: OpenCodeProfileUpdateInput): Promise<OpenCodeProfileSnapshot> {
    const api = getApi();
    if (!api) throw new Error("OpenCode profile settings are unavailable in preview mode");
    const snapshot = await api.updateOpenCodeProfile(input);
    window.dispatchEvent(new Event("palot:profiles-changed"));
    return snapshot;
  },

  async deleteOpenCodeProfile(profileID: string): Promise<OpenCodeProfileSnapshot> {
    const api = getApi();
    if (!api) throw new Error("OpenCode profile settings are unavailable in preview mode");
    const snapshot = await api.deleteOpenCodeProfile(profileID);
    window.dispatchEvent(new Event("palot:profiles-changed"));
    return snapshot;
  },

  async dataLocations() {
    const api = getApi();
    if (!api) throw new Error("Palot data locations are unavailable in preview mode");
    return api.dataLocations();
  },

  async revealDataLocation(location: "data" | "logs"): Promise<void> {
    const api = getApi();
    if (!api) throw new Error("Palot data locations are unavailable in preview mode");
    await api.revealDataLocation(location);
  },

  async exportSupportBundle(): Promise<string | null> {
    const api = getApi();
    if (!api) throw new Error("Support bundle export is unavailable in preview mode");
    return api.exportSupportBundle();
  },

  async resetPalotData(scope: "settings" | "all"): Promise<void> {
    const api = getApi();
    if (!api) throw new Error("Palot data recovery is unavailable in preview mode");
    await api.resetPalotData(scope);
  },

  async testOpenCodeProfile(input: OpenCodeProfileCreateInput): Promise<OpenCodeProfileTestResult> {
    const api = getApi();
    if (!api) throw new Error("OpenCode profile settings are unavailable in preview mode");
    return api.testOpenCodeProfile(input);
  },

  async getSshConnectionState(): Promise<SshConnectionState | null> {
    return getApi()?.getSshConnectionState() ?? null;
  },

  onSshConnectionState(listener: (state: SshConnectionState | null) => void) {
    return getApi()?.onSshConnectionState(listener) ?? (() => undefined);
  },

  async respondSshPrompt(response: SshPromptResponse): Promise<void> {
    const api = getApi();
    if (!api) throw new Error("SSH is unavailable in preview mode");
    await api.respondSshPrompt(response);
  },

  async cancelSshConnection(operationID: string): Promise<void> {
    const api = getApi();
    if (!api) throw new Error("SSH is unavailable in preview mode");
    await api.cancelSshConnection(operationID);
  },

  async switchOpenCodeProfile(profileID: string): Promise<OpenCodeRuntimeStatus> {
    const api = getApi();
    if (!api) throw new Error("OpenCode profile settings are unavailable in preview mode");
    return api.switchOpenCodeProfile(profileID);
  },

  async openCodePairingInfo(): Promise<OpenCodePairingInfo> {
    const api = getApi();
    if (!api) throw new Error("OpenCode pairing is unavailable in preview mode");
    return api.openCodePairingInfo();
  },

  async importOpenCodePairing(input: OpenCodePairImportInput): Promise<OpenCodeProfileSnapshot> {
    const api = getApi();
    if (!api) throw new Error("OpenCode pairing is unavailable in preview mode");
    return api.importOpenCodePairing(input);
  },

  async openCodeWebAccessInfo(): Promise<OpenCodeWebAccessInfo> {
    const api = getApi();
    if (!api) {
      return {
        local: {
          available: true,
          reason: null,
          url: "http://127.0.0.1:49374",
          version: previewRuntime.version,
          pid: previewRuntime.pid,
          managed: true,
          restartAvailable: true,
          pairingAvailable: true,
        },
        tailscale: {
          connectionState: "connected",
          backendState: "Running",
          version: "1.102.3",
          dnsName: "palot-preview.example.ts.net",
          publicUrl: "https://palot-preview.example.ts.net",
          serveState: "inactive",
          proxyTarget: null,
          managedByPalot: false,
          error: null,
        },
      };
    }
    return api.openCodeWebAccessInfo();
  },

  async enableOpenCodeTailscaleAccess(): Promise<OpenCodeWebAccessInfo> {
    const api = getApi();
    if (!api) throw new Error("Tailscale web access is unavailable in preview mode");
    return api.enableOpenCodeTailscaleAccess();
  },

  async disableOpenCodeTailscaleAccess(): Promise<OpenCodeWebAccessInfo> {
    const api = getApi();
    if (!api) throw new Error("Tailscale web access is unavailable in preview mode");
    return api.disableOpenCodeTailscaleAccess();
  },

  async restartLocalOpenCodeService(): Promise<OpenCodeRuntimeStatus> {
    const api = getApi();
    if (!api) throw new Error("Local service controls are unavailable in preview mode");
    return api.restartLocalOpenCodeService();
  },

  async updateAppearance(input: AppearanceUpdateInput): Promise<AppearanceUpdateResult> {
    const api = getApi();
    return api
      ? api.updateAppearance(input)
      : { preferences: input.preferences, restartRequired: false };
  },

  async hydratePreview(): Promise<{
    runtime: OpenCodeRuntimeStatus;
    projects: PalotProject[];
    sessions: PalotPage<PalotSession>;
    activeSessions: PalotSession[];
  }> {
    const state = new URLSearchParams(window.location.search).get("state");
    if (state === "error") throw new Error("The preview runtime could not start");
    if (state === "offline") {
      return {
        runtime: { ...previewRuntime, phase: "stopped", connected: false, pid: null },
        projects: [],
        sessions: { data: [], cursor: { previous: null, next: null } },
        activeSessions: [],
      };
    }
    return {
      runtime: previewRuntime,
      projects: state === "empty" ? [] : [previewProject],
      sessions: {
        data: state === "empty" ? [] : previewSessions,
        cursor: { previous: null, next: null },
      },
      activeSessions: [],
    };
  },

  async loadSessionTriage(profileID: string): Promise<SessionTriageSnapshot> {
    return enqueueTriage(async () => {
      const api = getApi();
      if (!api) return { profileID, bootstrapThrough: null, sessions: [] };
      return api.loadSessionTriage(profileID);
    });
  },

  async dispatchSessionTriage(command: SessionTriageCommand): Promise<SessionTriageSnapshot> {
    return dispatchTriage(command);
  },

  async loadAutomations(profileID: string): Promise<AutomationSnapshot> {
    const api = getApi();
    if (!api) return { profileID, automations: [], runs: [] };
    return api.loadAutomations(profileID);
  },

  async dispatchAutomation(command: AutomationCommand): Promise<AutomationSnapshot> {
    const api = getApi();
    if (!api) return { profileID: command.profileID, automations: [], runs: [] };
    return api.dispatchAutomation(command);
  },

  async previewAutomationSchedule(trigger: AutomationTrigger): Promise<AutomationSchedulePreview> {
    const api = getApi();
    if (!api) return { summary: "Preview schedule", occurrences: [] };
    return api.previewAutomationSchedule(trigger);
  },

  async takeAutomationNotificationTarget(): Promise<AutomationNotificationTarget | null> {
    return getApi()?.takeAutomationNotificationTarget() ?? null;
  },

  async loadAutomationHostSettings(): Promise<AutomationHostSettings> {
    return (
      getApi()?.loadAutomationHostSettings() ?? {
        launchAtLogin: false,
        preventSleepWhileRunning: false,
      }
    );
  },

  async updateAutomationHostSettings(
    settings: AutomationHostSettings,
  ): Promise<AutomationHostSettings> {
    return getApi()?.updateAutomationHostSettings(settings) ?? settings;
  },

  onAutomationChanged(listener: (event: AutomationChangedEvent) => void) {
    return getApi()?.onAutomationChanged(listener) ?? (() => undefined);
  },

  onAutomationNotificationOpened(listener: (target: AutomationNotificationTarget) => void) {
    return getApi()?.onAutomationNotificationOpened(listener) ?? (() => undefined);
  },

  async getSession(sessionID: string, connectionID?: string): Promise<PalotSession | null> {
    if (!apiAvailable()) return previewSessions.find((session) => session.id === sessionID) ?? null;
    return getOpenCodeSession(sessionID, undefined, connectionID);
  },

  async loadAttentionSnapshot(
    sessions: PalotSession[],
    connectionID?: string,
  ): Promise<PalotAttentionSnapshot> {
    if (!apiAvailable()) {
      return {
        complete: true,
        sessions: previewSessions.slice(0, 1),
        requests: [{ sessionID: previewSessions[0]!.id, value: previewRequests }],
      };
    }
    const api = getApi()!;
    return api.loadAttentionSnapshot({
      connectionID: connectionID ?? (await api.runtimeStatus()).connectionID,
      sessions,
    } satisfies AttentionSnapshotInput);
  },

  async loadSession(
    session: PalotSession,
    targets: { messages: boolean; requests: boolean; diffs: boolean } = {
      messages: true,
      requests: false,
      diffs: false,
    },
    messageMode: "rooted" | "recent" = "rooted",
    connectionID?: string,
  ) {
    if (!apiAvailable()) {
      return {
        messages: {
          data: session.id === "first-shell" ? previewMessages : [],
          cursor: { previous: null, next: null },
        },
        requests:
          session.id === "first-shell" ? previewRequests : { ...previewRequests, permissions: [] },
        diffs: session.id === "first-shell" ? previewDiffs : [],
      };
    }
    const messageLimit = 20;
    const [messages, requests, diffs] = await Promise.all([
      targets.messages
        ? loadTaskResource(session, "Transcript", () =>
            loadOpenCodeMessages(
              { sessionID: session.id, limit: messageLimit },
              messageMode === "rooted",
              undefined,
              connectionID,
            ),
          )
        : null,
      targets.requests
        ? loadTaskResource(session, "Pending requests", () =>
            listOpenCodeRequests(session.id, undefined, connectionID),
          )
        : null,
      targets.diffs
        ? loadTaskResource(session, "Working changes", () =>
            listOpenCodeDiffs({
              directory: session.location.directory,
              ...(session.location.workspaceID
                ? { workspaceID: session.location.workspaceID }
                : {}),
              mode: "working",
            }),
          )
        : null,
    ]);
    return {
      messages,
      requests,
      diffs,
    };
  },

  async loadTranscript(
    session: PalotSession,
    messageMode: "rooted" | "recent" = "rooted",
    requestSignal?: AbortSignal,
    connectionID?: string,
  ) {
    if (!apiAvailable()) {
      return {
        data: session.id === "first-shell" ? previewMessages : [],
        cursor: { previous: null, next: null },
      };
    }
    return loadOpenCodeMessages(
      { sessionID: session.id, limit: 20 },
      messageMode === "rooted",
      requestSignal,
      connectionID,
    );
  },

  async loadOlder(
    sessionID: string,
    cursor: string,
    requestSignal?: AbortSignal,
    connectionID?: string,
  ) {
    if (!apiAvailable()) return { data: [], cursor: { previous: null, next: null } };
    const limit = 100;
    return loadOpenCodeMessages({ sessionID, cursor, limit }, true, requestSignal, connectionID);
  },

  async listRunningShells(location: LocationRef, requestSignal?: AbortSignal) {
    if (!apiAvailable()) return [];
    return listOpenCodeRunningShells(location, requestSignal);
  },

  async listPtys(location: LocationRef): Promise<PalotPty[]> {
    if (!apiAvailable()) return [];
    return listOpenCodePtys(location);
  },

  async createPty(
    sessionID: string,
    location: LocationRef,
    connectionID?: string,
  ): Promise<PalotPty> {
    if (!apiAvailable()) throw new Error("Terminals require the desktop OpenCode connection");
    return createOpenCodePty(sessionID, location, connectionID);
  },

  async getPty(
    location: LocationRef,
    ptyID: string,
    transport: PalotPtyTransport,
  ): Promise<PalotPty> {
    if (!apiAvailable()) throw new Error("Terminal is unavailable in preview mode");
    return getOpenCodePty(location, ptyID, transport);
  },

  async snapshotPty(ptyID: string) {
    if (!apiAvailable()) return null;
    return snapshotOpenCodePty(ptyID);
  },

  async resizePty(
    location: LocationRef,
    ptyID: string,
    transport: PalotPtyTransport,
    size: { cols: number; rows: number },
  ): Promise<void> {
    if (apiAvailable()) await resizeOpenCodePty(location, ptyID, transport, size);
  },

  async removePty(
    location: LocationRef,
    ptyID: string,
    transport: PalotPtyTransport,
  ): Promise<void> {
    if (apiAvailable()) await removeOpenCodePty(location, ptyID, transport);
  },

  async connectPty(
    input: Parameters<PalotApi["connectPty"]>[0],
    connectionID?: string,
  ): Promise<string> {
    const api = getApi();
    if (!api) throw new Error("Terminal transport is unavailable");
    const target = connectionID ?? (await api.runtimeStatus()).connectionID;
    return api.connectPty(input, target);
  },

  async startPty(connectionID: string): Promise<void> {
    await getApi()?.startPty(connectionID);
  },

  async writePty(input: Parameters<PalotApi["writePty"]>[0]): Promise<void> {
    await getApi()?.writePty(input);
  },

  async disconnectPty(connectionID: string): Promise<void> {
    await getApi()?.disconnectPty(connectionID);
  },

  onPtyEvent(listener: Parameters<PalotApi["onPtyEvent"]>[0]) {
    return getApi()?.onPtyEvent(listener) ?? (() => undefined);
  },

  async loadRequests(
    sessionID: string,
    requestSignal?: AbortSignal,
    connectionID?: string,
  ): Promise<SessionRequestSnapshot> {
    if (!apiAvailable()) return previewRequests;
    return listOpenCodeRequests(sessionID, requestSignal, connectionID);
  },

  async loadSessionInbox(sessionID: string, requestSignal?: AbortSignal, connectionID?: string) {
    if (!apiAvailable()) return previewRequests.inbox;
    return listOpenCodeSessionInputs(sessionID, requestSignal, connectionID);
  },

  async showAttentionNotification(input: Parameters<PalotApi["showAttentionNotification"]>[0]) {
    if (apiAvailable()) await getApi()?.showAttentionNotification(input);
  },

  async loadDesktopNotificationSettings(): Promise<DesktopNotificationSettings> {
    return getApi()?.loadDesktopNotificationSettings() ?? DEFAULT_DESKTOP_NOTIFICATION_SETTINGS;
  },

  async updateDesktopNotificationSettings(
    settings: DesktopNotificationSettings,
  ): Promise<DesktopNotificationSettings> {
    return getApi()?.updateDesktopNotificationSettings(settings) ?? settings;
  },

  async desktopNotificationDeliveryStatus() {
    return (
      getApi()?.desktopNotificationDeliveryStatus() ?? {
        authorization: "unavailable" as const,
        delivery: "unknown" as const,
      }
    );
  },

  async requestDesktopNotificationPermission() {
    return (
      getApi()?.requestDesktopNotificationPermission() ?? {
        authorization: "unavailable" as const,
        delivery: "unknown" as const,
      }
    );
  },

  async openDesktopNotificationSystemSettings() {
    await getApi()?.openDesktopNotificationSystemSettings();
  },

  async sendDesktopTestNotification() {
    await getApi()?.sendDesktopTestNotification();
  },

  async takeOpenTarget(): Promise<PalotOpenTarget | null> {
    return getApi()?.takeOpenTarget() ?? null;
  },

  async openSessionWindow(sessionID: string, connectionID?: string): Promise<void> {
    flushScheduledPersistedValues();
    const api = getApi();
    if (!api) return;
    const target = connectionID ?? (await api.runtimeStatus()).connectionID;
    await api.openSessionWindow(sessionID, target);
  },

  async closeWindow(): Promise<void> {
    await getApi()?.closeWindow();
  },

  onOpenTargetRequested(listener: (target: PalotOpenTarget) => void) {
    return getApi()?.onOpenTargetRequested(listener) ?? (() => undefined);
  },

  async createSession(
    directory: string,
    workspaceID?: string,
    connectionID?: string,
    permissions?: PermissionRuleset,
  ) {
    if (!apiAvailable()) return previewSessions[0] ?? null;
    return mapSession(
      await openCodeClient(connectionID).session.create({
        location: { directory, ...(workspaceID ? { workspaceID } : {}) },
        ...(permissions === undefined ? {} : { permissions }),
      }),
    );
  },

  async renameSession(sessionID: string, title: string) {
    if (apiAvailable()) await openCodeClient().session.rename({ sessionID, title });
  },

  async setSessionPermissions(input: PermissionRulesInput, connectionID?: string): Promise<void> {
    if (!apiAvailable()) throw new Error("Connect to OpenCode to change session permissions.");
    await openCodeClient(connectionID).permission.rules(input, {
      signal: openCodeRequestSignal(),
    });
  },

  async moveSession(sessionID: string, directory: string, connectionID?: string) {
    if (!apiAvailable()) return null;
    const client = openCodeClient(connectionID);
    await client.session.move({ sessionID, directory });
    return getOwnedSession(client, sessionID);
  },

  async forkSession(input: { sessionID: string; beforeMessageID?: string }, connectionID?: string) {
    if (!apiAvailable()) {
      const source = previewSessions.find((session) => session.id === input.sessionID);
      if (!source) throw new Error("Task not found");
      return {
        ...source,
        id: `${source.id}-fork`,
        title: `${source.title ?? "Untitled task"} (fork)`,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
    }
    return mapSession(
      await openCodeClient(connectionID).session.fork({
        sessionID: input.sessionID,
        boundary: input.beforeMessageID
          ? { type: "before", messageID: input.beforeMessageID }
          : { type: "through" },
      }),
    );
  },

  async refreshProjectCopies(
    _projectID: string,
    sourceDirectory: string,
    requestSignal?: AbortSignal,
  ) {
    if (apiAvailable()) await refreshOpenCodeWorktrees(sourceDirectory, requestSignal);
  },

  async listProjectDirectories(
    _projectID: string,
    sourceDirectory: string,
    requestSignal?: AbortSignal,
    connectionID?: string,
  ) {
    if (!apiAvailable()) return [{ directory: sourceDirectory, strategy: null }];
    const worktrees = await listOpenCodeWorktrees(sourceDirectory, requestSignal, connectionID);
    return [
      { directory: sourceDirectory, strategy: null },
      ...worktrees.filter((item) => item.directory !== sourceDirectory),
    ];
  },

  async createProjectCopy(
    projectID: string,
    sourceDirectory: string,
    branch?: string,
    connectionID?: string,
  ) {
    if (!apiAvailable())
      return { directory: `/tmp/opencode/worktree/${projectID.slice(0, 6)}/preview` };
    return createOpenCodeWorktree(sourceDirectory, branch, undefined, connectionID);
  },

  async removeProjectCopy(
    _projectID: string,
    sourceDirectory: string,
    directory: string,
    force = false,
  ) {
    if (directory === sourceDirectory) throw new Error("The main checkout cannot be removed");
    if (apiAvailable()) await removeOpenCodeWorktree(sourceDirectory, directory, force);
  },

  async sendComposerPrompt(input: Parameters<typeof sendOpenCodePrompt>[0]) {
    if (!apiAvailable()) return undefined;
    return sendOpenCodePrompt(input);
  },

  async runCommand(input: RunCommandInput) {
    if (!apiAvailable()) return undefined;
    const location = input.fileReferences?.length ? await sessionLocation(input.sessionID) : null;
    await openCodeClient().session.command(
      {
        sessionID: input.sessionID,
        command: input.command,
        text: `/${input.command}${input.arguments ? ` ${input.arguments}` : ""}`,
        ...(input.fileReferences?.length
          ? { files: promptFiles(location!.directory, input.fileReferences) }
          : {}),
        ...(input.skillReferences?.length
          ? {
              skills: input.skillReferences.map((skill) => ({
                id: skill.id,
                mention: { ...skill.mention },
                ...(skill.text ? { text: skill.text } : {}),
              })),
            }
          : {}),
        ...(input.delivery ? { delivery: input.delivery } : {}),
      },
      { signal: openCodeRequestSignal() },
    );
  },

  async loadComposerCatalog(
    input: ListModelsInput,
    requestSignal?: AbortSignal,
  ): Promise<PalotComposerCatalog> {
    if (!apiAvailable()) {
      return {
        commands: mergeBuiltinCommands(previewSettings.commands),
        skills: previewSettings.skills,
        errors: [],
      };
    }
    return loadOpenCodeComposerCatalog(input, requestSignal);
  },

  async findWorkspaceFiles(
    input: FindWorkspaceFilesInput,
    requestSignal?: AbortSignal,
  ): Promise<FileSystemEntry[]> {
    if (!apiAvailable()) {
      const query = input.query.toLowerCase();
      return [
        "apps/desktop/src/renderer/components/composer.tsx",
        "apps/desktop/src/renderer/components/thread.tsx",
        "apps/desktop/src/shared/opencode-contract.ts",
      ]
        .filter((path) => path.toLowerCase().includes(query))
        .slice(0, input.limit ?? 20)
        .map((path) => ({ path, type: "file" as const }));
    }
    return findOpenCodeWorkspaceFiles(input, requestSignal);
  },

  async readWorkspaceFile(
    input: LocationRef & { path: string },
    requestSignal?: AbortSignal,
  ): Promise<Uint8Array> {
    if (!apiAvailable()) {
      return new TextEncoder().encode(`Preview file: ${input.path}\n`);
    }
    return readOpenCodeWorkspaceFile(input, requestSignal);
  },

  async listWorkspaceDirectory(
    input: LocationRef & { path?: string },
    requestSignal?: AbortSignal,
  ): Promise<FileSystemEntry[]> {
    if (!apiAvailable()) return [];
    return listOpenCodeWorkspaceDirectory(input, requestSignal);
  },

  async listDiffs(input: ListDiffsInput, requestSignal?: AbortSignal) {
    if (!apiAvailable()) return previewDiffs;
    return listOpenCodeDiffs(input, requestSignal);
  },

  async listModels(
    input: ListModelsInput,
    requestSignal?: AbortSignal,
  ): Promise<PalotModelCatalog> {
    if (!apiAvailable()) {
      const defaultModel: PalotModel = {
        id: "gpt-5.6",
        modelID: "gpt-5.6",
        providerID: "openai",
        name: "GPT-5.6",
        family: "gpt",
        variants: ["low", "medium", "high"],
        inputLimit: null,
        contextLimit: 400_000,
        outputLimit: 128_000,
        releasedAt: now,
        capabilities: { tools: true, input: ["text", "image"], output: ["text"] },
        status: "active",
      };
      return {
        models: [defaultModel],
        defaultModel,
        providers: [
          {
            id: "openai",
            canonicalID: "openai",
            name: "OpenAI",
            integrationID: "openai",
            package: "@ai-sdk/openai",
            disabled: false,
          },
        ],
        errors: [],
      };
    }
    return listOpenCodeModels(input, requestSignal);
  },

  async loadSettings(
    input: { projectID: string; directory: string; workspaceID?: string },
    requestSignal?: AbortSignal,
  ) {
    if (!apiAvailable()) {
      const catalog = await palot.listModels(input, requestSignal);
      return { ...previewSettings, location: input, catalog };
    }
    return loadOpenCodeSettings(input, requestSignal);
  },

  async checkPlugins(input: Parameters<typeof checkOpenCodePlugins>[0]) {
    if (!apiAvailable()) return previewSettings.plugins;
    return checkOpenCodePlugins(input);
  },

  async updatePlugins(input: Parameters<typeof updateOpenCodePlugins>[0]) {
    if (apiAvailable()) await updateOpenCodePlugins(input);
  },

  async addMcpServer(input: Parameters<typeof addOpenCodeMcpServer>[0]) {
    if (apiAvailable()) await addOpenCodeMcpServer(input);
  },

  async checkPluginUpdates(input: Parameters<typeof checkOpenCodePluginUpdates>[0]) {
    if (apiAvailable()) await checkOpenCodePluginUpdates(input);
  },

  async updatePlugin(input: Parameters<typeof updateOpenCodePlugin>[0]) {
    if (apiAvailable()) await updateOpenCodePlugin(input);
  },

  async addWellknownIntegration(input: Parameters<typeof addOpenCodeWellknownIntegration>[0]) {
    if (apiAvailable()) await addOpenCodeWellknownIntegration(input);
  },

  async removeMcpServer(input: Parameters<typeof removeOpenCodeMcpServer>[0]) {
    if (apiAvailable()) await removeOpenCodeMcpServer(input);
  },

  async connectMcpServer(input: Parameters<typeof connectOpenCodeMcpServer>[0]) {
    if (apiAvailable()) await connectOpenCodeMcpServer(input);
  },

  async disconnectMcpServer(input: Parameters<typeof disconnectOpenCodeMcpServer>[0]) {
    if (apiAvailable()) await disconnectOpenCodeMcpServer(input);
  },

  async removeSavedPermission(input: Parameters<typeof removeOpenCodeSavedPermission>[0]) {
    if (apiAvailable()) await removeOpenCodeSavedPermission(input);
  },

  async connectIntegrationKey(input: Parameters<typeof connectOpenCodeIntegrationKey>[0]) {
    if (apiAvailable()) await connectOpenCodeIntegrationKey(input);
  },

  async connectIntegrationOAuth(input: Parameters<typeof connectOpenCodeIntegrationOAuth>[0]) {
    if (!apiAvailable()) throw new Error("Palot bridge is unavailable");
    return connectOpenCodeIntegrationOAuth(input);
  },

  async integrationOAuthStatus(input: Parameters<typeof openCodeIntegrationOAuthStatus>[0]) {
    if (!apiAvailable()) throw new Error("Palot bridge is unavailable");
    return openCodeIntegrationOAuthStatus(input);
  },

  async completeIntegrationOAuth(input: Parameters<typeof completeOpenCodeIntegrationOAuth>[0]) {
    if (apiAvailable()) await completeOpenCodeIntegrationOAuth(input);
  },

  async cancelIntegrationOAuth(input: Parameters<typeof cancelOpenCodeIntegrationOAuth>[0]) {
    if (apiAvailable()) await cancelOpenCodeIntegrationOAuth(input);
  },

  async connectIntegrationCommand(input: Parameters<typeof connectOpenCodeIntegrationCommand>[0]) {
    if (!apiAvailable()) throw new Error("Palot bridge is unavailable");
    return connectOpenCodeIntegrationCommand(input);
  },

  async integrationCommandStatus(input: Parameters<typeof openCodeIntegrationCommandStatus>[0]) {
    if (!apiAvailable()) throw new Error("Palot bridge is unavailable");
    return openCodeIntegrationCommandStatus(input);
  },

  async cancelIntegrationCommand(input: Parameters<typeof cancelOpenCodeIntegrationCommand>[0]) {
    if (apiAvailable()) await cancelOpenCodeIntegrationCommand(input);
  },

  async updateCredential(input: Parameters<typeof updateOpenCodeCredential>[0]) {
    if (apiAvailable()) await updateOpenCodeCredential(input);
  },

  async activateCredential(input: Parameters<typeof activateOpenCodeCredential>[0]) {
    if (apiAvailable()) await activateOpenCodeCredential(input);
  },

  async removeCredential(input: Parameters<typeof removeOpenCodeCredential>[0]) {
    if (apiAvailable()) await removeOpenCodeCredential(input);
  },

  async switchModel(input: SessionSwitchModelInput): Promise<void> {
    if (apiAvailable()) await openCodeClient().session.switchModel(input);
  },

  async switchAgent(input: SessionSwitchAgentInput): Promise<void> {
    if (apiAvailable()) await openCodeClient().session.switchAgent(input);
  },

  async removeSession(sessionID: string, connectionID?: string): Promise<void> {
    if (apiAvailable()) await openCodeClient(connectionID).session.remove({ sessionID });
  },

  async sessionStats(input: SessionStatsInput, requestSignal?: AbortSignal) {
    if (!apiAvailable()) return null;
    return openCodeClient().session.stats(input, { signal: openCodeRequestSignal(requestSignal) });
  },

  async loadSessionContext(sessionID: string) {
    if (!apiAvailable()) return [];
    return openCodeClient().session.context({ sessionID }, { signal: openCodeRequestSignal() });
  },

  async listSessionInstructionEntries(sessionID: string) {
    if (!apiAvailable()) return [];
    return openCodeClient().session.instructions.entry.list(
      { sessionID },
      { signal: openCodeRequestSignal() },
    );
  },

  async removeSessionInstructionEntry(sessionID: string, key: string): Promise<void> {
    if (apiAvailable()) {
      await openCodeClient().session.instructions.entry.remove(
        { sessionID, key },
        { signal: openCodeRequestSignal() },
      );
    }
  },

  async exportSession(
    sessionID: string,
    title?: string | null,
    connectionID?: string,
  ): Promise<string | null> {
    if (!apiAvailable()) return null;
    const api = getApi();
    if (!api) throw new Error("Palot bridge is unavailable");
    const transfer = await openCodeClient(connectionID).session.export(
      { sessionID, sanitize: true },
      { signal: openCodeRequestSignal() },
    );
    const standalone = {
      ...transfer,
      info: { ...transfer.info, parentID: undefined },
    };
    return api.saveSessionExport({
      suggestedName: `${title?.trim() || sessionID}.palot-task.json`,
      contents: `${JSON.stringify(standalone, null, 2)}\n`,
    });
  },

  async copySessionMarkdown(sessionID: string, connectionID?: string): Promise<void> {
    if (!apiAvailable()) return;
    const api = getApi();
    if (!api) throw new Error("Palot bridge is unavailable");
    const transfer = await openCodeClient(connectionID).session.export(
      { sessionID, sanitize: true },
      { signal: openCodeRequestSignal() },
    );
    await api.writeClipboardText(sessionTransferToMarkdown(transfer));
  },

  async importSession(
    destination?: LocationRef,
    connectionID?: string,
  ): Promise<PalotSession | null> {
    if (!apiAvailable()) return null;
    const client = openCodeClient(connectionID);
    const ownerConnectionID = connectionID ?? (await palot.runtimeStatus()).connectionID;
    const api = getApi();
    if (!api) throw new Error("Palot bridge is unavailable");
    const file = await api.pickSessionImport();
    if (!file) return null;
    const location =
      destination ??
      (await api
        .pickDirectory(ownerConnectionID)
        .then((directory) => (directory ? { directory } : null)));
    if (!location) return null;
    let transfer: SessionTransferData;
    try {
      transfer = JSON.parse(file.contents) as SessionTransferData;
    } catch {
      throw new Error("This file is not valid JSON.");
    }
    if (
      !transfer ||
      typeof transfer !== "object" ||
      !transfer.info ||
      !Array.isArray(transfer.messages)
    ) {
      throw new Error("This file is not a valid Palot task export.");
    }
    const imported = await client.session.import(
      { ...transfer, info: { ...transfer.info, parentID: undefined }, location },
      { signal: openCodeRequestSignal() },
    );
    return mapSession(imported);
  },

  async replyPermission(
    input: Pick<PermissionReplyInput, "sessionID" | "requestID" | "reply" | "message">,
  ): Promise<void> {
    if (apiAvailable()) await openCodeClient().permission.reply(input);
  },

  async replyQuestion(input: ReplyQuestionInput): Promise<void> {
    if (!apiAvailable()) return;
    const client = openCodeClient();
    const form = await client.form.get({ sessionID: input.sessionID, formID: input.requestID });
    const answer = Object.fromEntries(
      input.answers.flatMap((answers, index) => {
        const field = form.fields[index];
        if (!field) return [];
        return [[field.key, field.type === "multiselect" ? answers : (answers[0] ?? "")]];
      }),
    );
    await client.form.reply({ sessionID: input.sessionID, formID: input.requestID, answer });
  },

  async rejectQuestion(input: RejectQuestionInput): Promise<void> {
    if (apiAvailable()) {
      await openCodeClient().form.cancel({ sessionID: input.sessionID, formID: input.requestID });
    }
  },

  async replyForm(input: FormReplyInput): Promise<void> {
    if (apiAvailable()) await openCodeClient().form.reply(input);
  },

  async cancelForm(input: FormCancelInput): Promise<void> {
    if (apiAvailable()) await openCodeClient().form.cancel(input);
  },

  async updatePending(input: UpdatePendingInput): Promise<void> {
    if (!apiAvailable()) return;
    const client = openCodeClient();
    if (input.action === "cancel") {
      await client.session.inbox.cancel({ sessionID: input.sessionID, inboxID: input.inputID });
      return;
    }
    await client.session.inbox[input.action]({
      sessionID: input.sessionID,
      inboxID: input.inputID,
    });
  },

  async interrupt(sessionID: string, connectionID?: string) {
    if (apiAvailable()) await openCodeClient(connectionID).session.interrupt({ sessionID });
  },

  async waitForSessionIdle(sessionID: string, connectionID?: string) {
    if (apiAvailable()) {
      await openCodeClient(connectionID).session.wait(
        { sessionID },
        { signal: openCodeRequestSignal() },
      );
    }
  },

  async backgroundSession(sessionID: string) {
    if (apiAvailable()) await openCodeClient().session.background({ sessionID });
  },

  async compactSession(sessionID: string) {
    if (apiAvailable()) await openCodeClient().session.compact({ sessionID });
  },

  async stageSessionRevert(
    input: { sessionID: string; messageID: string; files?: boolean },
    connectionID?: string,
  ) {
    if (!apiAvailable()) return null;
    const client = openCodeClient(connectionID);
    await client.session.revert.stage({
      sessionID: input.sessionID,
      messageID: input.messageID,
      files: input.files ?? true,
    });
    return getOwnedSession(client, input.sessionID);
  },

  async clearSessionRevert(sessionID: string, connectionID?: string) {
    if (!apiAvailable()) return null;
    const client = openCodeClient(connectionID);
    await client.session.revert.clear({ sessionID });
    return getOwnedSession(client, sessionID);
  },

  async commitSessionRevert(sessionID: string, connectionID?: string) {
    if (!apiAvailable()) return null;
    const client = openCodeClient(connectionID);
    await client.session.revert.commit({ sessionID });
    return getOwnedSession(client, sessionID);
  },

  async restartApp(reason = "Restart requested from Palot") {
    if (apiAvailable()) await getApi()?.restartApp({ reason });
  },

  pickDirectory: async (connectionID?: string) =>
    apiAvailable()
      ? (getApi()?.pickDirectory(connectionID ?? (await palot.runtimeStatus()).connectionID) ??
        Promise.resolve(null))
      : Promise.resolve(previewProject.canonical),

  openExternalUrl: (url: string): Promise<boolean> =>
    apiAvailable()
      ? (getApi()?.openExternalUrl(url) ?? Promise.resolve(false))
      : Promise.resolve(false),

  revealFileInFinder: async (path: string, connectionID?: string): Promise<boolean> =>
    apiAvailable()
      ? (getApi()?.revealFileInFinder(
          path,
          connectionID ?? (await palot.runtimeStatus()).connectionID,
        ) ?? Promise.resolve(false))
      : Promise.resolve(false),

  externalOpenTargets: async (
    sessionID: string,
    connectionID?: string,
  ): Promise<ExternalOpenTarget[]> =>
    apiAvailable()
      ? (getApi()?.externalOpenTargets(
          sessionID,
          connectionID ?? (await palot.runtimeStatus()).connectionID,
        ) ?? Promise.resolve([]))
      : Promise.resolve([
          {
            id: "finder",
            label: "Reveal in Finder",
            kind: "file-manager",
            iconDataUrl: null,
            preferred: true,
          },
        ]),

  externalOpen: async (input: ExternalOpenInput, connectionID?: string) =>
    apiAvailable()
      ? (getApi()?.externalOpen(
          input,
          connectionID ?? (await palot.runtimeStatus()).connectionID,
        ) ?? Promise.reject(new Error("External open is unavailable")))
      : Promise.resolve({ openedTargetID: input.targetID ?? ("finder" as const) }),

  pickFiles: async (connectionID?: string) =>
    apiAvailable()
      ? (getApi()?.pickFiles(connectionID ?? (await palot.runtimeStatus()).connectionID) ??
        Promise.resolve({ files: [], errors: [] }))
      : Promise.resolve({ files: [], errors: [] }),

  attachClipboardImages: async (
    images: Array<{ mime: string; data: ArrayBuffer }>,
    connectionID?: string,
  ) =>
    apiAvailable()
      ? (getApi()?.attachClipboardImages(
          images,
          connectionID ?? (await palot.runtimeStatus()).connectionID,
        ) ?? Promise.resolve({ files: [], errors: [] }))
      : Promise.resolve({ files: [], errors: [] }),

  attachmentPreview: async (grant: string, connectionID?: string) =>
    apiAvailable()
      ? (getApi()?.attachmentPreview(
          grant,
          connectionID ?? (await palot.runtimeStatus()).connectionID,
        ) ?? Promise.resolve(null))
      : Promise.resolve(null),

  subscribe(listener: (batch: PalotEventBatch) => void): () => void {
    return apiAvailable()
      ? (getApi()?.onOpenCodeEvents(listener) ?? (() => undefined))
      : () => undefined;
  },
};
