/**
 * Stable Palot contracts for the Electron boundary.
 *
 * OpenCode client objects and credentials must never cross this boundary.
 */

import type { OpenCodeReleaseChannel, OpenCodeReleaseStatus } from "./opencode-release-contract";
import type {
  OpenCodeInstallationStatus,
  OpenCodeInstallationUpgradeInput,
  OpenCodeRuntimePreference,
} from "./opencode-installation-contract";
import type {
  FileDiffInfo,
  FormInfo,
  FormValue,
  LocationRef,
  ModelRef,
  OpenCodeEvent,
  PermissionRequest,
  PermissionRule,
  PermissionRuleset,
  PermissionSavedInfo,
  PluginInfo,
  PromptMention,
  SessionInboxInfo,
  ServerGetOutput,
  ServiceHealth,
  TokenUsageInfo,
} from "@opencode/client";
import type {
  AppearancePreferences,
  AppearanceUpdateInput,
  AppearanceUpdateResult,
  NativeSystemAppearance,
} from "./appearance-contract";
import type { WindowChromeTier } from "./window-chrome";
import type { SessionTriageCommand, SessionTriageSnapshot } from "./session-triage-contract";
import type {
  AutomationChangedEvent,
  AutomationCommand,
  AutomationHostSettings,
  AutomationNotificationTarget,
  AutomationSchedulePreview,
  AutomationSnapshot,
  AutomationTrigger,
} from "./automation-contract";
import type { PalotPerformanceSnapshot } from "./performance-contract";
import type { SshConfig, SshConnectionState, SshPromptResponse } from "./ssh-contract";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type OpenCodeRuntimePhase =
  | "idle"
  | "discovering"
  | "starting"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "error"
  | "stopped";

export type OpenCodeProfileKind = "local" | "remote" | "ssh";

export interface LocalOpenCodeProfile {
  id: string;
  kind: "local";
  name: string;
}

export interface RemoteOpenCodeProfile {
  id: string;
  kind: "remote";
  name: string;
  urls: string[];
  credentialID: string | null;
  allowPlainHttp: boolean;
  lastSuccessfulUrl: string | null;
  lastConnectedAt: number | null;
}

export interface SshOpenCodeProfile {
  id: string;
  kind: "ssh";
  name: string;
  ssh: SshConfig;
}

export type OpenCodeProfile = LocalOpenCodeProfile | RemoteOpenCodeProfile | SshOpenCodeProfile;

export type OpenCodeCredentialInput =
  | { type: "none" }
  | { type: "basic"; username: string; password: string }
  | { type: "bearer"; token: string }
  | { type: "headers"; headers: Record<string, string> };

export type OpenCodeProfileCreateInput =
  | { kind: "ssh"; name: string; ssh: SshConfig }
  | { kind: "local"; name: string }
  | {
      kind: "remote";
      name: string;
      urls: string[];
      credential: OpenCodeCredentialInput;
      allowPlainHttp: boolean;
    };

export type OpenCodeProfileUpdateInput =
  | { id: string; kind: "ssh"; name: string; ssh: SshConfig }
  | { id: string; kind: "local"; name: string }
  | {
      id: string;
      kind: "remote";
      name: string;
      urls: string[];
      credential?: OpenCodeCredentialInput;
      allowPlainHttp: boolean;
    };

export interface OpenCodeProfileSnapshot {
  activeProfileID: string;
  profiles: OpenCodeProfile[];
}

export interface OpenCodeProfileTestResult {
  url: string;
  version: ServiceHealth["version"];
  pid: ServiceHealth["pid"] | null;
  secure: boolean;
}

export interface OpenCodePairPayload {
  urls: ServerGetOutput["urls"];
  username: string;
  password: string;
}

export interface OpenCodePairImportInput {
  payload: OpenCodePairPayload;
  allowPlainHttp: boolean;
}

export interface OpenCodePairingInfo {
  urls: string[];
  username: string;
  password: string;
  payload: string;
}

export interface LocalOpenCodeServiceInfo {
  available: boolean;
  reason: string | null;
  url: string | null;
  version: string | null;
  pid: number | null;
  managed: boolean;
  restartAvailable: boolean;
  pairingAvailable: boolean;
}

export type TailscaleConnectionState = "unavailable" | "disconnected" | "connected";
export type TailscaleServeState = "inactive" | "active" | "conflict";

export interface TailscaleWebAccessInfo {
  connectionState: TailscaleConnectionState;
  backendState: string | null;
  version: string | null;
  dnsName: string | null;
  publicUrl: string | null;
  serveState: TailscaleServeState;
  proxyTarget: string | null;
  managedByPalot: boolean;
  error: string | null;
}

export interface OpenCodeWebAccessInfo {
  local: LocalOpenCodeServiceInfo;
  tailscale: TailscaleWebAccessInfo;
}

export type OpenCodeRuntimeSource = "shared-service" | "network-server";
export type OpenCodeRuntimeTopology = "same-machine" | "remote-machine";

export interface OpenCodeRuntimeCapabilities {
  serverFilesystem: boolean;
  localPathActions: boolean;
  localFileAttachments: boolean;
  worktreeCreate: boolean;
  pty: "persistent" | "legacy" | "none";
  scheduledAutomations: boolean;
  manualAutomations: boolean;
  integrationCallback: "local" | "code" | "unknown";
  pairing: "show" | "import-only" | "none";
}

export interface OpenCodeVersionMismatch {
  detectedVersion: string;
  expectedVersion: string;
  canContinue: boolean;
}

export interface OpenCodeConnectInput {
  versionMismatch?: "continue" | "replace";
  /** Exact detected version shown by the confirmation; required for continuation. */
  approvedVersion?: string;
  /** Explicitly confirmed service startup/recovery, never used for automatic reconnects. */
  startLocalService?: boolean;
}

export interface OpenCodeRuntimeStatus {
  connectionID: string;
  profileID: string;
  contractVersion: string;
  phase: OpenCodeRuntimePhase;
  connected: boolean;
  source?: OpenCodeRuntimeSource;
  topology?: OpenCodeRuntimeTopology;
  capabilities?: OpenCodeRuntimeCapabilities;
  binaryPath: string | null;
  version: string | null;
  pid: number | null;
  managed: boolean;
  lastConnectedAt: number | null;
  error: string | null;
  versionMismatch: OpenCodeVersionMismatch | null;
  /** Shared local discovery failed; a confirmed start/recovery action may be offered. */
  canStartLocalService?: boolean;
}

export interface PreparePtyConnectionInput {
  ptyID: string;
  location: LocationRef;
  cursor: number;
  transport: PalotPtyTransport;
  readOnly?: boolean;
}

export type PalotPtyTransport = "legacy" | "persistent";

export interface CreateSessionPtyInput {
  sessionID: string;
  location: LocationRef;
}

export interface PalotPty {
  id: string;
  title: string;
  status: "running" | "exited";
  transport: PalotPtyTransport;
}

export interface PalotPtySnapshot {
  buffer: string;
  cursor: number;
  cols: number;
  rows: number;
}

export type PtyTransportEvent =
  | { connectionID: string; type: "open" }
  | { connectionID: string; type: "data"; data: string | ArrayBuffer }
  | { connectionID: string; type: "close"; code: number }
  | { connectionID: string; type: "error"; message: string };

export interface WritePtyInput {
  connectionID: string;
  data: string;
  cols: number;
  rows: number;
  control?: boolean;
}

export interface PalotProject {
  id: string;
  canonical: string;
  name: string | null;
  sandboxes: string[];
  vcs: JsonValue | null;
  updatedAt: number | null;
}

export interface PalotModel {
  id: string;
  modelID: string;
  providerID: string;
  canonicalProviderID?: string;
  name: string;
  family: string | null;
  variants: string[];
  inputLimit: number | null;
  contextLimit: number;
  outputLimit: number;
  releasedAt: number;
  capabilities: {
    tools: boolean;
    input: string[];
    output: string[];
  };
  compatibility?: {
    requireAssistantAfterTool: boolean;
    requireReasoning: boolean;
  };
  status: "alpha" | "beta" | "deprecated" | "active";
}

export interface PalotProvider {
  id: string;
  canonicalID?: string;
  name: string;
  integrationID: string | null;
  package: string;
  disabled: boolean;
}

export interface PalotCapabilityError {
  capability: string;
  label: string;
  message: string;
  reference?: string;
}

export interface PalotModelCatalog {
  models: PalotModel[];
  defaultModel: PalotModel | null;
  providers: PalotProvider[];
  errors: PalotCapabilityError[];
}

export type SettingsCapability =
  | "config"
  | "catalog"
  | "agents"
  | "integrations"
  | "mcp"
  | "mcpResources"
  | "savedPermissions"
  | "plugins"
  | "skills"
  | "commands"
  | "references"
  | "websearchProviders";

export interface SettingsLocationInput extends ListModelsInput {
  projectID: string;
  capabilities?: SettingsCapability[];
}

export interface PalotConfigSource {
  type: string;
  path: string | null;
  formatters: PalotConfigFormatter[];
  languageServers: PalotConfigLanguageServer[];
  summary: {
    model?: string;
    defaultAgent?: string;
    update?: "disable" | "notify" | "auto";
    share?: "manual" | "auto" | "disabled";
    shell?: boolean;
    enterprise?: boolean;
    permissionCount?: number;
    agentCount?: number;
    snapshots?: boolean | "configured";
    compactionAuto?: boolean | "configured";
    warming?: boolean | "configured";
    formatter?: boolean | "configured";
    formatterCount?: number;
    lsp?: boolean | "configured";
    lspCount?: number;
    watcher?: boolean;
    media?: boolean;
    toolOutput?: boolean;
    mcpServerCount?: number;
    skillCount?: number;
    commandCount?: number;
    instructionCount?: number;
    referenceCount?: number;
    websearchProvider?: string;
    pluginCount?: number;
    providerCount?: number;
    experimentalPolicyCount?: number;
  } | null;
  permissions: PermissionRule[];
}

export interface PalotConfigFormatter {
  id: string;
  disabled: boolean;
  executable: string | null;
  argumentCount: number;
  extensions: string[];
  environmentVariables: string[];
}

export interface PalotConfigLanguageServer extends PalotConfigFormatter {
  initializationKeys: string[];
}

export interface PalotAgent {
  id: string;
  name: string;
  description: string | null;
  mode: "primary" | "subagent" | "all";
  hidden: boolean;
  color: string | null;
  steps: number | null;
  model: ModelRef | null;
  permissions: PermissionRule[];
}

export interface PalotFormWhen {
  key: string;
  op: "eq" | "neq";
  value: string | number | boolean;
}

export interface PalotFormOption {
  value: string;
  label: string;
  description: string | null;
}

interface PalotFormFieldBase {
  key: string;
  title: string | null;
  description: string | null;
  required: boolean;
  when: PalotFormWhen[];
}

export type PalotFormField =
  | (PalotFormFieldBase & {
      type: "string";
      format: "email" | "uri" | "date" | "date-time" | null;
      minLength: number | null;
      maxLength: number | null;
      pattern: string | null;
      placeholder: string | null;
      defaultValue: string | null;
      options: PalotFormOption[];
      custom: boolean;
    })
  | (PalotFormFieldBase & {
      type: "number" | "integer";
      minimum: number | null;
      maximum: number | null;
      defaultValue: number | null;
    })
  | (PalotFormFieldBase & {
      type: "boolean";
      defaultValue: boolean | null;
    })
  | (PalotFormFieldBase & {
      type: "multiselect";
      options: PalotFormOption[];
      minItems: number | null;
      maxItems: number | null;
      custom: boolean;
      defaultValue: string[];
    })
  | {
      key: string;
      type: "external";
      url: string;
      title: string | null;
      description: string | null;
    };

export type PalotIntegrationMethod =
  | {
      id: string;
      type: "oauth";
      label: string;
      form: PalotFormField[];
    }
  | {
      id: string;
      type: "command";
      label: string;
      command: string[];
      form: [];
    }
  | {
      id: null;
      type: "key";
      label: string;
      form: PalotFormField[];
    }
  | {
      id: null;
      type: "env";
      label: string;
      names: string[];
      form: [];
    };

export interface PalotIntegrationConnection {
  type: "credential" | "env";
  id: string | null;
  label: string;
  active: boolean;
}

export interface PalotIntegration {
  id: string;
  name: string;
  methods: PalotIntegrationMethod[];
  connections: PalotIntegrationConnection[];
  metadata?: JsonValue;
}

export interface PalotMcpServer {
  name: string;
  status: "connected" | "pending" | "disabled" | "failed" | "needs_auth";
  error: string | null;
  integrationID: string | null;
}

export interface PalotMcpResource {
  server: string;
  name: string;
  uri: string;
  description: string | null;
  mimeType: string | null;
}

export interface PalotMcpResourceTemplate {
  server: string;
  name: string;
  uriTemplate: string;
  description: string | null;
  mimeType: string | null;
}

export interface PalotSkill {
  id: string;
  name: string;
  description: string | null;
  location: string;
  slash: boolean;
  autoinvoke: boolean;
}

export interface PalotCommand {
  name: string;
  description: string | null;
  agent: string | null;
  model: ModelRef | null;
  subtask: boolean;
}

export interface PalotComposerCatalog {
  commands: PalotCommand[];
  skills: PalotSkill[];
  errors: PalotCapabilityError[];
}

export interface FindWorkspaceFilesInput extends LocationRef {
  query: string;
  limit?: number;
}

export interface PalotPromptFileReference {
  path: string;
  name: string;
  mention: PromptMention;
}

export interface PalotPromptSkillReference {
  id: string;
  mention: PromptMention;
  text?: string;
}

export interface PalotReference {
  name: string;
  path: string;
  description: string | null;
  hidden: boolean;
  sourceType: "local" | "git";
  source: string;
}

export interface PalotWebsearchProvider {
  id: string;
  name: string;
}

export type PalotPlugin = PluginInfo;

export interface PalotSettingsSnapshot {
  location: LocationRef;
  configSources: PalotConfigSource[];
  catalog: PalotModelCatalog;
  agents: PalotAgent[];
  integrations: PalotIntegration[];
  mcpServers: PalotMcpServer[];
  mcpResources: PalotMcpResource[];
  mcpResourceTemplates: PalotMcpResourceTemplate[];
  savedPermissions: PermissionSavedInfo[];
  plugins: PalotPlugin[];
  skills: PalotSkill[];
  commands: PalotCommand[];
  references: PalotReference[];
  websearchProviders: PalotWebsearchProvider[];
  errors: PalotCapabilityError[];
}

export type PalotMcpConfig =
  | {
      type: "local";
      command: string[];
      cwd?: string;
      environment?: Record<string, string>;
      disabled?: boolean;
      codemode?: boolean;
      timeout?: PalotMcpTimeout;
    }
  | {
      type: "remote";
      url: string;
      headers?: Record<string, string>;
      oauth?: PalotMcpOAuth | false;
      disabled?: boolean;
      codemode?: boolean;
      timeout?: PalotMcpTimeout;
    };

export interface PalotMcpTimeout {
  startup?: number;
  catalog?: number;
  execution?: number;
}

export interface PalotMcpOAuth {
  client_id?: string;
  client_secret?: string;
  scope?: string;
  callback_port?: number;
  redirect_uri?: string;
}

export interface McpServerInput extends SettingsLocationInput {
  server: string;
}

export interface AddMcpServerInput extends McpServerInput {
  config: PalotMcpConfig;
}

export interface RemoveSavedPermissionInput extends SettingsLocationInput {
  id: string;
}

export interface ConnectIntegrationKeyInput extends SettingsLocationInput {
  integrationID: string;
  key: string;
  answer?: Record<string, FormValue>;
  label?: string;
}

export interface IntegrationMethodInput extends SettingsLocationInput {
  integrationID: string;
  methodID: string;
  label?: string;
}

export interface ConnectIntegrationCommandInput extends IntegrationMethodInput {
  command: string[];
}

export interface ConnectIntegrationOAuthInput extends IntegrationMethodInput {
  answer?: Record<string, FormValue>;
}

export interface PalotIntegrationOAuthAttempt {
  attemptID: string;
  url: string;
  instructions: string;
  mode: "auto" | "code";
  createdAt: number;
  expiresAt: number;
}

export interface PalotIntegrationCommandAttempt {
  attemptID: string;
  createdAt: number;
  expiresAt: number;
}

export interface IntegrationAttemptInput extends SettingsLocationInput {
  integrationID: string;
  attemptID: string;
}

export interface CompleteIntegrationOAuthInput extends IntegrationAttemptInput {
  code?: string;
}

export interface PalotIntegrationAttemptStatus {
  status: "pending" | "complete" | "failed" | "expired";
  message: string | null;
  createdAt: number;
  expiresAt: number;
}

export interface AddWellknownIntegrationInput extends SettingsLocationInput {
  url: string;
}

export interface UpdateCredentialInput extends RemoveCredentialInput {
  label: string;
}

export type ActivateCredentialInput = RemoveCredentialInput;

export interface RemoveCredentialInput extends SettingsLocationInput {
  credentialID: string;
}

export interface PalotFileAttachment {
  uri: string;
  previewGrant?: string;
  /** Validated, bounded raster image data from OpenCode's persisted attachment bytes. */
  previewDataUrl?: string;
  name: string;
  mime: string;
  size: number | null;
}

export interface PalotFilePickerResult {
  files: PalotFileAttachment[];
  errors: string[];
}

export interface SessionExportFileInput {
  suggestedName: string;
  contents: string;
}

export interface SessionImportFile {
  path: string;
  contents: string;
}

export interface PalotClipboardImage {
  mime: string;
  data: ArrayBuffer;
}

export interface PalotAttachmentPreview {
  mime: string;
  data: ArrayBuffer;
}

export interface PalotSession {
  id: string;
  parentID: string | null;
  projectID: string;
  title: string | null;
  agent: string | null;
  model: ModelRef | null;
  metadata?: Record<string, JsonValue>;
  permissions?: PermissionRuleset;
  location: LocationRef;
  createdAt: number;
  updatedAt: number;
  idleAt?: number;
  viewedAt?: number;
  outcome?: "succeeded" | "failed" | "interrupted";
  archivedAt: number | null;
  cost: number | null;
  tokens: TokenUsageInfo;
  revert?: {
    messageID: string;
    partID?: string;
    snapshot?: string;
    files?: FileDiffInfo[];
  } | null;
}

export interface PalotMessageContent {
  type: string;
  text?: string;
  /** Palot-only live text/reasoning lifecycle; never an OpenCode wire field. */
  streaming?: boolean;
  presentation?: "thought" | "preamble" | "recap";
  status?: "running" | "completed" | "failed" | "interrupted";
  reason?: "auto" | "manual";
  recent?: string;
  error?: string;
  /** Compaction request usage, not the size of the resulting context. */
  cost?: number;
  tokens?: TokenUsageInfo;
  name?: string;
  id?: string;
  time?: {
    created: number;
    ran?: number;
    completed?: number;
  };
  executed?: boolean;
  providerState?: JsonValue;
  providerResultState?: JsonValue;
  state?: JsonValue;
  data?: JsonValue;
}

export interface PalotMessage {
  id: string;
  type: string;
  optimistic?: boolean;
  createdAt: number;
  timelineAt?: number;
  delivery?: "steer" | "queue";
  promotedAt?: number;
  runStartedAt?: number;
  runCompletedAt?: number;
  firstTokenAt?: number;
  streamedAt?: number;
  completedAt: number | null;
  text: string | null;
  agent: string | null;
  model: ModelRef | null;
  tokens: TokenUsageInfo | null;
  finish: "stop" | "length" | "tool-calls" | "content-filter" | "error" | "unknown" | null;
  rawFinish?: string;
  providerState?: JsonValue;
  files?: PalotFileAttachment[];
  fileReferences?: Array<{
    uri: string;
    name: string;
    mention: PromptMention;
  }>;
  skillReferences?: PalotPromptSkillReference[];
  content: PalotMessageContent[];
  data: JsonValue;
}

export interface PalotPage<T> {
  data: T[];
  cursor: {
    previous: string | null;
    next: string | null;
  };
}

export interface ListSessionsInput {
  limit?: number;
  cursor?: string;
  search?: string;
}

export interface LoadMessagesInput {
  sessionID: string;
  limit?: number;
  cursor?: string;
}

export interface PalotProjectDirectory {
  directory: string;
  strategy: string | null;
}

export interface PromptInput {
  sessionID: string;
  id?: string;
  text: string;
  files?: PalotFileAttachment[];
  fileReferences?: PalotPromptFileReference[];
  skillReferences?: PalotPromptSkillReference[];
  delivery?: "steer" | "queue";
}

export interface RunCommandInput extends SessionInput {
  command: string;
  arguments?: string;
  fileReferences?: PalotPromptFileReference[];
  skillReferences?: PalotPromptSkillReference[];
  delivery?: "steer" | "queue";
}

export interface PromptReceipt {
  id: string;
  sessionID: string;
  type: string;
  delivery: "steer" | "queue" | null;
  createdAt: number | null;
}

export interface SessionInput {
  sessionID: string;
}

export interface RestartAppInput {
  reason?: string;
}

export interface ListModelsInput {
  directory: string;
  workspaceID?: string;
}

export interface ReplyQuestionInput extends SessionInput {
  requestID: string;
  answers: string[][];
}

export interface RejectQuestionInput extends SessionInput {
  requestID: string;
}

export interface UpdatePendingInput extends SessionInput {
  inputID: string;
  action: "steer" | "queue" | "cancel";
}

export interface SessionRequestSnapshot {
  permissions: PermissionRequest[];
  forms: FormInfo[];
  inbox: SessionInboxInfo[];
  errors: string[];
  requestCreatedAtByID?: Record<string, number>;
}

export interface PalotAttentionSnapshot {
  complete: boolean;
  sessions: PalotSession[];
  requests: Array<{
    sessionID: string;
    value: SessionRequestSnapshot;
  }>;
}

export interface AttentionSnapshotInput {
  connectionID: string;
  sessions: PalotSession[];
}

export interface AttentionNotificationInput {
  sessionID: string;
  requestID: string;
  type: "permission" | "form" | "question" | "input";
}

export type TurnCompletionNotificationMode = "never" | "unfocused" | "always";

export interface DesktopNotificationSettings {
  turnCompletion: TurnCompletionNotificationMode;
  permissionRequests: boolean;
  questionRequests: boolean;
}

export interface DesktopNotificationDeliveryStatus {
  authorization:
    | "not-determined"
    | "denied"
    | "authorized"
    | "provisional"
    | "ephemeral"
    | "unavailable";
  delivery: "alerts" | "notification-center" | "off" | "unknown";
}

export const DEFAULT_DESKTOP_NOTIFICATION_SETTINGS: DesktopNotificationSettings = {
  turnCompletion: "always",
  permissionRequests: true,
  questionRequests: true,
};

export type PalotOpenTarget =
  | { type: "open" }
  | { type: "project"; directory: string; files?: PalotFileAttachment[] }
  | {
      type: "session";
      sessionID: string;
      profileID?: string;
      requestID?: string;
      requestType?: AttentionNotificationInput["type"];
    }
  | { type: "new-task" }
  | { type: "notification-settings" };

export interface ListDiffsInput {
  directory: string;
  workspaceID?: string;
  mode: "working" | "branch";
  base?: string;
  context?: number;
}

export interface PalotRunningShell {
  id: string;
  sessionID: string | null;
  command: string;
  cwd: string;
  startedAt: number;
  status: "running" | "exited" | "timeout" | "killed";
  exit?: number;
}

export interface PalotEventDeliveryMetadata {
  receiveSequence: number;
  createdAt: number;
}

export type PalotRuntimeEvent = {
  id: string;
  type: "palot.runtime.status";
  createdAt: number;
  location: null;
  data: OpenCodeRuntimeStatus;
  durable?: never;
};

export type OpenCodeTransportEvent = OpenCodeEvent & {
  createdAt: number;
  durable?: {
    aggregateID: string;
    seq: number;
    version: number;
  };
};

export type PalotEventInput = OpenCodeTransportEvent | PalotRuntimeEvent;

export type PalotEvent = PalotEventInput & PalotEventDeliveryMetadata;

export interface PalotEventBatch {
  connectionID: string;
  contractVersion: string;
  streamEpoch: number;
  batchSequence: number;
  receivedAt: number;
  sentAt: number;
  rendererReceivedAt?: number;
  replicaAppliedAt?: number;
  events: PalotEvent[];
}

export interface OpenCodeRequestInput {
  /** Exact retained profile/generation. Explicit targets never fall back to focus. */
  profileID?: string;
  connectionID?: string;
  id: string;
  rendererStartedAt: number;
  path: string;
  method: string;
  headers: Record<string, string>;
  body: ArrayBuffer | null;
}

export interface OpenCodeResponseOutput {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: ArrayBuffer | null;
  timings?: {
    rendererToMainMs: number;
    connectionMs: number;
    serviceMs: number;
    responseBodyMs: number;
    mainTotalMs: number;
  };
}

export type PalotPlatform =
  | "aix"
  | "android"
  | "darwin"
  | "freebsd"
  | "haiku"
  | "linux"
  | "openbsd"
  | "sunos"
  | "win32"
  | "cygwin"
  | "netbsd";

export interface NativeSymbolInput {
  name: string;
  pointSize?: number;
  weight?:
    | "ultralight"
    | "thin"
    | "light"
    | "regular"
    | "medium"
    | "semibold"
    | "bold"
    | "heavy"
    | "black";
  scale?: "small" | "medium" | "large";
}

export interface PalotDataLocations {
  data: string;
  logs: string;
  database: string;
  backups: string;
  temporaryAttachments: string;
}

export const IPC_CHANNELS = {
  appearanceLoad: "palot:appearance:load",
  appearanceUpdate: "palot:appearance:update",
  appearanceChanged: "palot:appearance:changed",
  nativeSystemAppearance: "palot:appearance:native-system-appearance",
  nativeSystemAppearanceChanged: "palot:appearance:native-system-appearance-changed",
  nativeSymbol: "palot:appearance:native-symbol",
  reducedTransparencyChanged: "palot:appearance:reduced-transparency-changed",
  chromeTier: "palot:window:chrome-tier",
  openSessionWindow: "palot:window:open-session",
  closeWindow: "palot:window:close",
  chromeTierChanged: "palot:window:chrome-tier-changed",
  runtimeStatus: "palot:opencode:runtime-status",
  openCodeReleaseStatus: "palot:opencode:release-status",
  openCodeReleaseChannel: "palot:opencode:release-channel",
  openCodeReleaseCheck: "palot:opencode:release-check",
  openCodeReleasePrepare: "palot:opencode:release-prepare",
  openCodeReleaseReset: "palot:opencode:release-reset",
  openCodeInstallationsInspect: "palot:opencode:installations-inspect",
  openCodeInstallationStatus: "palot:opencode:installation-status",
  openCodeRuntimePreference: "palot:opencode:runtime-preference",
  openCodeInstallationSelect: "palot:opencode:installation-select",
  openCodeInstallationUpgrade: "palot:opencode:installation-upgrade",
  runtimeList: "palot:opencode:runtime-list",
  profileConnect: "palot:opencode:profile-connect",
  profileDisconnect: "palot:opencode:profile-disconnect",
  connect: "palot:opencode:connect",
  sshState: "palot:opencode:ssh-state",
  sshStateChanged: "palot:opencode:ssh-state-changed",
  sshRespond: "palot:opencode:ssh-respond",
  sshCancel: "palot:opencode:ssh-cancel",
  networkRestored: "palot:opencode:network-restored",
  profilesList: "palot:opencode:profiles-list",
  profilesCreate: "palot:opencode:profiles-create",
  profilesUpdate: "palot:opencode:profiles-update",
  profilesDelete: "palot:opencode:profiles-delete",
  profilesTest: "palot:opencode:profiles-test",
  profilesSwitch: "palot:opencode:profiles-switch",
  pairingInfo: "palot:opencode:pairing-info",
  pairingImport: "palot:opencode:pairing-import",
  webAccessInfo: "palot:opencode:web-access-info",
  webAccessEnableTailscale: "palot:opencode:web-access-enable-tailscale",
  webAccessDisableTailscale: "palot:opencode:web-access-disable-tailscale",
  localServiceRestart: "palot:opencode:local-service-restart",
  ptyConnect: "palot:opencode:pty-connect",
  ptyCreate: "palot:opencode:pty-create",
  ptyStart: "palot:opencode:pty-start",
  ptyWrite: "palot:opencode:pty-write",
  ptyDisconnect: "palot:opencode:pty-disconnect",
  ptyEvents: "palot:opencode:pty-events",
  request: "palot:opencode:request",
  cancelRequest: "palot:opencode:cancel-request",
  pickDirectory: "palot:system:pick-directory",
  openExternalUrl: "palot:system:open-external-url",
  revealFileInFinder: "palot:system:reveal-file-in-finder",
  externalOpenTargets: "palot:system:external-open-targets",
  externalOpen: "palot:system:external-open",
  pickFiles: "palot:system:pick-files",
  saveSessionExport: "palot:system:save-session-export",
  pickSessionImport: "palot:system:pick-session-import",
  writeClipboardText: "palot:system:write-clipboard-text",
  attachClipboardImages: "palot:system:attach-clipboard-images",
  attachmentPreview: "palot:system:attachment-preview",
  downloadUrl: "palot:system:download-url",
  performanceSnapshot: "palot:system:performance-snapshot",
  performanceTraceStart: "palot:system:performance-trace-start",
  performanceTraceStop: "palot:system:performance-trace-stop",
  restartApp: "palot:system:restart-app",
  rendererStartupFailure: "palot:system:renderer-startup-failure",
  dataLocations: "palot:system:data-locations",
  dataReveal: "palot:system:data-reveal",
  supportBundleExport: "palot:system:support-bundle-export",
  dataReset: "palot:system:data-reset",
  attentionNotification: "palot:system:attention-notification",
  attentionSnapshot: "palot:system:attention-snapshot",
  notificationSettingsLoad: "palot:system:notification-settings-load",
  notificationSettingsUpdate: "palot:system:notification-settings-update",
  notificationDeliveryStatus: "palot:system:notification-delivery-status",
  notificationPermissionRequest: "palot:system:notification-permission-request",
  notificationSystemSettingsOpen: "palot:system:notification-system-settings-open",
  notificationTest: "palot:system:notification-test",
  openTargetTake: "palot:system:open-target-take",
  openTargetRequested: "palot:system:open-target-requested",
  triageLoad: "palot:triage:load",
  triageDispatch: "palot:triage:dispatch",
  automationLoad: "palot:automation:load",
  automationDispatch: "palot:automation:dispatch",
  automationPreview: "palot:automation:preview",
  automationTakeNotification: "palot:automation:take-notification",
  automationSettingsLoad: "palot:automation:settings-load",
  automationSettingsUpdate: "palot:automation:settings-update",
  automationChanged: "palot:automation:changed",
  automationNotificationOpened: "palot:automation:notification-opened",
  events: "palot:opencode:events",
} as const;

export interface PalotApi {
  readonly platform: PalotPlatform;
  /** Immutable BrowserWindow startup hints; use loadAppearance before renderer hydration. */
  readonly appearancePreferences: AppearancePreferences;
  readonly hasStoredAppearancePreferences: boolean;
  readonly reducedTransparency: boolean;
  readonly chromeTier: WindowChromeTier;
  loadAppearance(): Promise<{
    preferences: AppearancePreferences;
    hasStoredPreferences: boolean;
    reducedTransparency: boolean;
    chromeTier: WindowChromeTier;
  }>;
  updateAppearance(input: AppearanceUpdateInput): Promise<AppearanceUpdateResult>;
  onAppearanceChanged(listener: (preferences: AppearancePreferences) => void): () => void;
  nativeSystemAppearance(): Promise<NativeSystemAppearance>;
  onNativeSystemAppearanceChanged(
    listener: (appearance: NativeSystemAppearance) => void,
  ): () => void;
  nativeSymbol(input: NativeSymbolInput): Promise<string | null>;
  onReducedTransparencyChanged(listener: (reduced: boolean) => void): () => void;
  getChromeTier(): Promise<WindowChromeTier>;
  onChromeTierChanged(listener: (tier: WindowChromeTier) => void): () => void;
  runtimeStatus(): Promise<OpenCodeRuntimeStatus>;
  openCodeReleaseStatus(): Promise<OpenCodeReleaseStatus>;
  setOpenCodeReleaseChannel(channel: OpenCodeReleaseChannel): Promise<OpenCodeReleaseStatus>;
  checkOpenCodeRelease(): Promise<OpenCodeReleaseStatus>;
  prepareOpenCodeRelease(input: {
    version: string;
    allowUntested?: boolean;
  }): Promise<OpenCodeReleaseStatus>;
  resetOpenCodeRelease(): Promise<OpenCodeReleaseStatus>;
  inspectOpenCodeInstallations(): Promise<OpenCodeInstallationStatus>;
  openCodeInstallationStatus(): Promise<OpenCodeInstallationStatus>;
  setOpenCodeRuntimePreference(
    preference: OpenCodeRuntimePreference,
  ): Promise<OpenCodeInstallationStatus>;
  selectOpenCodeInstallation(id: string): Promise<OpenCodeInstallationStatus>;
  upgradeOpenCodeInstallation(
    input: OpenCodeInstallationUpgradeInput,
  ): Promise<OpenCodeInstallationStatus>;
  connectOpenCode(input?: OpenCodeConnectInput): Promise<OpenCodeRuntimeStatus>;
  listOpenCodeRuntimes(): Promise<OpenCodeRuntimeStatus[]>;
  connectOpenCodeProfile(profileID: string): Promise<OpenCodeRuntimeStatus>;
  disconnectOpenCodeProfile(profileID: string): Promise<void>;
  listOpenCodeProfiles(): Promise<OpenCodeProfileSnapshot>;
  getSshConnectionState(): Promise<SshConnectionState | null>;
  onSshConnectionState(listener: (state: SshConnectionState | null) => void): () => void;
  respondSshPrompt(input: SshPromptResponse): Promise<void>;
  cancelSshConnection(operationID: string): Promise<void>;
  createOpenCodeProfile(input: OpenCodeProfileCreateInput): Promise<OpenCodeProfileSnapshot>;
  updateOpenCodeProfile(input: OpenCodeProfileUpdateInput): Promise<OpenCodeProfileSnapshot>;
  deleteOpenCodeProfile(profileID: string): Promise<OpenCodeProfileSnapshot>;
  testOpenCodeProfile(input: OpenCodeProfileCreateInput): Promise<OpenCodeProfileTestResult>;
  switchOpenCodeProfile(profileID: string): Promise<OpenCodeRuntimeStatus>;
  openCodePairingInfo(): Promise<OpenCodePairingInfo>;
  importOpenCodePairing(input: OpenCodePairImportInput): Promise<OpenCodeProfileSnapshot>;
  openCodeWebAccessInfo(): Promise<OpenCodeWebAccessInfo>;
  enableOpenCodeTailscaleAccess(): Promise<OpenCodeWebAccessInfo>;
  disableOpenCodeTailscaleAccess(): Promise<OpenCodeWebAccessInfo>;
  restartLocalOpenCodeService(): Promise<OpenCodeRuntimeStatus>;
  /** Native session actions require the focused runtime's exact connection ID; omitted IDs reject. */
  createPty(input: CreateSessionPtyInput, connectionID?: string): Promise<PalotPty>;
  connectPty(input: PreparePtyConnectionInput, connectionID?: string): Promise<string>;
  startPty(connectionID: string): Promise<void>;
  writePty(input: WritePtyInput): Promise<void>;
  disconnectPty(connectionID: string): Promise<void>;
  onPtyEvent(listener: (event: PtyTransportEvent) => void): () => void;
  openCodeRequest(input: OpenCodeRequestInput): Promise<OpenCodeResponseOutput>;
  cancelOpenCodeRequest(requestID: string): Promise<void>;
  pickDirectory(connectionID?: string): Promise<string | null>;
  openExternalUrl(url: string): Promise<boolean>;
  revealFileInFinder(path: string, connectionID?: string): Promise<boolean>;
  externalOpenTargets(
    sessionID: string,
    connectionID?: string,
  ): Promise<import("./external-open-contract").ExternalOpenTarget[]>;
  externalOpen(
    input: import("./external-open-contract").ExternalOpenInput,
    connectionID?: string,
  ): Promise<import("./external-open-contract").ExternalOpenResult>;
  pickFiles(connectionID?: string): Promise<PalotFilePickerResult>;
  saveSessionExport(input: SessionExportFileInput): Promise<string | null>;
  pickSessionImport(): Promise<SessionImportFile | null>;
  writeClipboardText(value: string): Promise<void>;
  attachClipboardImages(
    images: PalotClipboardImage[],
    connectionID?: string,
  ): Promise<PalotFilePickerResult>;
  attachmentPreview(grant: string, connectionID?: string): Promise<PalotAttachmentPreview | null>;
  downloadUrl(url: string): Promise<void>;
  performanceSnapshot(): Promise<PalotPerformanceSnapshot>;
  performanceTraceStart(): Promise<void>;
  performanceTraceStop(): Promise<string>;
  restartApp(input?: RestartAppInput): Promise<void>;
  reportRendererStartupFailure(message: string): Promise<void>;
  dataLocations(): Promise<PalotDataLocations>;
  revealDataLocation(location: "data" | "logs"): Promise<void>;
  exportSupportBundle(): Promise<string | null>;
  resetPalotData(scope: "settings" | "all"): Promise<void>;
  showAttentionNotification(input: AttentionNotificationInput): Promise<void>;
  loadAttentionSnapshot(input: AttentionSnapshotInput): Promise<PalotAttentionSnapshot>;
  loadDesktopNotificationSettings(): Promise<DesktopNotificationSettings>;
  updateDesktopNotificationSettings(
    settings: DesktopNotificationSettings,
  ): Promise<DesktopNotificationSettings>;
  desktopNotificationDeliveryStatus(): Promise<DesktopNotificationDeliveryStatus>;
  requestDesktopNotificationPermission(): Promise<DesktopNotificationDeliveryStatus>;
  openDesktopNotificationSystemSettings(): Promise<void>;
  sendDesktopTestNotification(): Promise<void>;
  takeOpenTarget(): Promise<PalotOpenTarget | null>;
  openSessionWindow(sessionID: string, connectionID?: string): Promise<void>;
  closeWindow(): Promise<void>;
  onOpenTargetRequested(listener: (target: PalotOpenTarget) => void): () => void;
  loadSessionTriage(profileID: string): Promise<SessionTriageSnapshot>;
  dispatchSessionTriage(command: SessionTriageCommand): Promise<SessionTriageSnapshot>;
  loadAutomations(profileID: string): Promise<AutomationSnapshot>;
  dispatchAutomation(command: AutomationCommand): Promise<AutomationSnapshot>;
  previewAutomationSchedule(trigger: AutomationTrigger): Promise<AutomationSchedulePreview>;
  takeAutomationNotificationTarget(): Promise<AutomationNotificationTarget | null>;
  loadAutomationHostSettings(): Promise<AutomationHostSettings>;
  updateAutomationHostSettings(settings: AutomationHostSettings): Promise<AutomationHostSettings>;
  onAutomationChanged(listener: (event: AutomationChangedEvent) => void): () => void;
  onAutomationNotificationOpened(
    listener: (target: AutomationNotificationTarget) => void,
  ): () => void;
  onOpenCodeEvents(listener: (batch: PalotEventBatch) => void): () => void;
}
