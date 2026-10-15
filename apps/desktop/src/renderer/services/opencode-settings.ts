import type {
  ConfigShellOption,
  FormField,
  IntegrationAttemptStatus,
  IntegrationCommandMethod,
  IntegrationCommandAttemptStatus,
  IntegrationMethod,
  OpenCodeClient,
  PluginInfo,
} from "@opencode/client";
import type {
  AddMcpServerInput,
  ActivateCredentialInput,
  ConnectIntegrationCommandInput,
  ConnectIntegrationExternalInput,
  AddWellknownIntegrationInput,
  CompleteIntegrationOAuthInput,
  ConnectIntegrationKeyInput,
  ConnectIntegrationOAuthInput,
  IntegrationAttemptInput,
  McpServerInput,
  PalotConfigSource,
  PalotFormField,
  PalotIntegrationAttemptStatus,
  PalotIntegrationCommandAttempt,
  PalotIntegrationMethod,
  PalotIntegrationOAuthAttempt,
  PalotPlugin,
  PalotSettingsSnapshot,
  RemoveCredentialInput,
  RemoveSavedPermissionInput,
  SettingsLocationInput,
  SettingsCapability,
  UpdateCredentialInput,
} from "../../shared";
import { openCodeClient } from "./opencode-client";
import { mapCommand, mapSkill, toJson } from "./opencode-mappers";
import { openCodeRequestSignal } from "./opencode-request";
import { listModels } from "./opencode-resources";

const requestSignal = (outer?: AbortSignal) => openCodeRequestSignal(outer);
export const ALL_SETTINGS_CAPABILITIES: SettingsCapability[] = [
  "config",
  "catalog",
  "agents",
  "integrations",
  "mcp",
  "mcpResources",
  "savedPermissions",
  "plugins",
  "skills",
  "commands",
  "references",
  "websearchProviders",
];
const settingsLocation = (input: { directory: string; workspaceID?: string }) => ({
  directory: input.directory,
  ...(input.workspaceID ? { workspace: input.workspaceID } : {}),
});
const locationRequest = (input: { directory: string; workspaceID?: string }) => ({
  location: settingsLocation(input),
});

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string")
    return error.message;
  return "Unknown OpenCode error";
}

function capabilityError(capability: string, label: string, error: unknown) {
  return { capability, label, message: errorMessage(error) };
}

function mapPlugin(plugin: PluginInfo): PalotPlugin {
  return {
    ...plugin,
    source: { ...plugin.source },
    features: { ...plugin.features },
    state: { ...plugin.state },
  };
}

export async function checkPlugins(input: SettingsLocationInput): Promise<PalotPlugin[]> {
  const client = openCodeClient(input.connectionID);
  const response = await client.plugin.check(locationRequest(input), { signal: requestSignal() });
  return response.data.map(mapPlugin);
}

export async function updatePlugins(
  input: SettingsLocationInput & { targets: string[] },
): Promise<void> {
  const client = openCodeClient(input.connectionID);
  await client.plugin.update(
    { ...locationRequest(input), targets: input.targets },
    { signal: requestSignal() },
  );
}

async function settleCapability<T>(
  enabled: boolean,
  load: () => Promise<T>,
): Promise<PromiseSettledResult<T> | null> {
  if (!enabled) return null;
  try {
    return { status: "fulfilled", value: await load() };
  } catch (reason) {
    return { status: "rejected", reason };
  }
}

function finiteNumber(value: number | string): number {
  if (typeof value === "number") return Number.isNaN(value) ? 0 : value;
  if (value === "Infinity") return Number.POSITIVE_INFINITY;
  if (value === "-Infinity") return Number.NEGATIVE_INFINITY;
  return 0;
}

function optionalFiniteNumber(value: number | string | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function configState(value: unknown): boolean | "configured" {
  return typeof value === "boolean" ? value : "configured";
}

function configSummary(value: unknown): PalotConfigSource["summary"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const info = value as Record<string, unknown>;
  const compaction =
    info.compaction && typeof info.compaction === "object" && !Array.isArray(info.compaction)
      ? (info.compaction as Record<string, unknown>)
      : null;
  const count = (item: unknown) =>
    item && typeof item === "object" && !Array.isArray(item) ? Object.keys(item).length : 0;
  const listCount = (item: unknown) => (Array.isArray(item) ? item.length : 0);
  const mcp =
    info.mcp && typeof info.mcp === "object" && !Array.isArray(info.mcp)
      ? (info.mcp as Record<string, unknown>)
      : null;
  const experimental =
    info.experimental && typeof info.experimental === "object" && !Array.isArray(info.experimental)
      ? (info.experimental as Record<string, unknown>)
      : null;
  const model = info.model;
  return {
    ...(typeof model === "string"
      ? { model }
      : model && typeof model === "object" && !Array.isArray(model)
        ? {
            model: `${String((model as Record<string, unknown>).providerID ?? "")}/${String((model as Record<string, unknown>).model ?? "")}`,
          }
        : {}),
    ...(typeof info.default_agent === "string" ? { defaultAgent: info.default_agent } : {}),
    ...(info.update === "disable" || info.update === "notify" || info.update === "auto"
      ? { update: info.update }
      : {}),
    ...(info.share === "manual" || info.share === "auto" || info.share === "disabled"
      ? { share: info.share }
      : {}),
    ...(typeof info.shell === "string" ? { shell: true } : {}),
    ...(info.enterprise !== undefined ? { enterprise: true } : {}),
    ...(info.permissions !== undefined ? { permissionCount: listCount(info.permissions) } : {}),
    ...(info.agents !== undefined ? { agentCount: count(info.agents) } : {}),
    ...(info.snapshots !== undefined ? { snapshots: configState(info.snapshots) } : {}),
    ...(compaction?.auto !== undefined ? { compactionAuto: configState(compaction.auto) } : {}),
    ...(info.warming !== undefined ? { warming: configState(info.warming) } : {}),
    ...(info.formatter !== undefined ? { formatter: configState(info.formatter) } : {}),
    ...(info.formatter !== undefined ? { formatterCount: count(info.formatter) } : {}),
    ...(info.lsp !== undefined ? { lsp: configState(info.lsp) } : {}),
    ...(info.lsp !== undefined ? { lspCount: count(info.lsp) } : {}),
    ...(info.watcher !== undefined ? { watcher: true } : {}),
    ...(info.media !== undefined ? { media: true } : {}),
    ...(info.tool_output !== undefined ? { toolOutput: true } : {}),
    ...(mcp?.servers !== undefined ? { mcpServerCount: count(mcp.servers) } : {}),
    ...(info.skills !== undefined ? { skillCount: listCount(info.skills) } : {}),
    ...(info.commands !== undefined ? { commandCount: count(info.commands) } : {}),
    ...(info.instructions !== undefined ? { instructionCount: listCount(info.instructions) } : {}),
    ...(info.references !== undefined ? { referenceCount: count(info.references) } : {}),
    ...(info.websearch && typeof info.websearch === "object" && !Array.isArray(info.websearch)
      ? {
          websearchProvider: String(
            (info.websearch as Record<string, unknown>).provider ?? "configured",
          ),
        }
      : {}),
    ...(info.plugins !== undefined ? { pluginCount: listCount(info.plugins) } : {}),
    ...(info.providers !== undefined ? { providerCount: count(info.providers) } : {}),
    ...(experimental?.policies !== undefined
      ? { experimentalPolicyCount: listCount(experimental.policies) }
      : {}),
  };
}

function command(value: unknown): { executable: string | null; argumentCount: number } {
  if (!Array.isArray(value)) return { executable: null, argumentCount: 0 };
  const items = value.filter((item): item is string => typeof item === "string");
  return { executable: items[0] ?? null, argumentCount: Math.max(0, items.length - 1) };
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function keys(value: unknown): string[] {
  return value && typeof value === "object" && !Array.isArray(value)
    ? Object.keys(value).toSorted()
    : [];
}

function configFormatters(value: unknown): PalotConfigSource["formatters"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.entries(value).flatMap(([id, item]) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const config = item as Record<string, unknown>;
    return [
      {
        id,
        disabled: config.disabled === true,
        ...command(config.command),
        extensions: strings(config.extensions),
        environmentVariables: keys(config.environment),
      },
    ];
  });
}

function configLanguageServers(value: unknown): PalotConfigSource["languageServers"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.entries(value).flatMap(([id, item]) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const config = item as Record<string, unknown>;
    return [
      {
        id,
        disabled: config.disabled === true,
        ...command(config.command),
        extensions: strings(config.extensions),
        environmentVariables: keys(config.env),
        initializationKeys: keys(config.initialization),
      },
    ];
  });
}

/**
 * Providers a config document defines and its `provider.use` policies. OpenCode removes
 * providers a deny policy matches from `provider.list`, so the policy is the only
 * readable record of why a connected provider is unavailable.
 */
function configProviderFacts(
  info: unknown,
): Pick<PalotConfigSource, "providerIDs" | "providerPolicies"> {
  if (!info || typeof info !== "object" || Array.isArray(info)) return {};
  const record = info as Record<string, unknown>;
  const experimental =
    record.experimental &&
    typeof record.experimental === "object" &&
    !Array.isArray(record.experimental)
      ? (record.experimental as Record<string, unknown>)
      : null;
  const policies: NonNullable<PalotConfigSource["providerPolicies"]> = Array.isArray(
    experimental?.policies,
  )
    ? experimental.policies.flatMap((item: unknown) => {
        if (!item || typeof item !== "object") return [];
        const policy = item as Record<string, unknown>;
        return policy.action === "provider.use" &&
          typeof policy.resource === "string" &&
          (policy.effect === "allow" || policy.effect === "deny")
          ? [{ resource: policy.resource, effect: policy.effect as "allow" | "deny" }]
          : [];
      })
    : [];
  const providerIDs = keys(record.providers);
  return {
    ...(providerIDs.length ? { providerIDs } : {}),
    ...(policies.length ? { providerPolicies: policies } : {}),
  };
}

function mapFormField(field: FormField): PalotFormField {
  const base = {
    key: field.key,
    title: field.title ?? null,
    description: field.description ?? null,
  };
  if (field.type === "external") return { ...base, type: "external", url: field.url };
  const conditional = {
    ...base,
    ...(field.hidden ? { hidden: true } : {}),
    required: field.required ?? false,
    when: (field.when ?? []).map((item) => ({ ...item })),
  };
  if (field.type === "string") {
    return {
      ...conditional,
      type: "string",
      format: field.format ?? null,
      minLength: field.minLength ?? null,
      maxLength: field.maxLength ?? null,
      pattern: field.pattern ?? null,
      placeholder: field.placeholder ?? null,
      defaultValue: field.default ?? null,
      options: (field.options ?? []).map((option) => ({
        value: option.value,
        label: option.label,
        description: option.description ?? null,
      })),
      custom: field.custom ?? false,
    };
  }
  if (field.type === "number" || field.type === "integer") {
    return {
      ...conditional,
      type: field.type,
      minimum: optionalFiniteNumber(field.minimum),
      maximum: optionalFiniteNumber(field.maximum),
      defaultValue: optionalFiniteNumber(field.default),
    };
  }
  if (field.type === "boolean") {
    return { ...conditional, type: "boolean", defaultValue: field.default ?? null };
  }
  return {
    ...conditional,
    type: "multiselect",
    options: field.options.map((option) => ({
      value: option.value,
      label: option.label,
      description: option.description ?? null,
    })),
    minItems: field.minItems ?? null,
    maxItems: field.maxItems ?? null,
    custom: field.custom ?? false,
    defaultValue: [...(field.default ?? [])],
  };
}

function mapAttemptStatus(
  status: IntegrationAttemptStatus | IntegrationCommandAttemptStatus,
): PalotIntegrationAttemptStatus {
  return {
    status: status.status,
    message: "message" in status ? (status.message ?? null) : null,
    createdAt: finiteNumber(status.time.created),
    expiresAt: finiteNumber(status.time.expires),
  };
}

function mapIntegrationMethod(method: IntegrationMethod): PalotIntegrationMethod {
  switch (method.type) {
    case "oauth":
    case "external":
      return {
        id: method.id,
        type: method.type,
        label: method.label,
        form: (method.form ?? []).map(mapFormField),
      };
    case "command":
      return {
        id: method.id,
        type: method.type,
        label: method.label,
        command: [...method.command],
        form: [],
      };
    case "key":
      return {
        id: null,
        type: method.type,
        label: method.label ?? "API key",
        form: (method.form ?? []).map(mapFormField),
      };
    case "env":
      return {
        id: null,
        type: method.type,
        label: method.names.join(", "),
        names: [...method.names],
        form: [],
      };
    default: {
      // The Promise client does not decode responses, so a newer service may
      // advertise methods outside the pinned contract. Never reinterpret them.
      const unsupported = method as { type: string; id?: string; label?: string };
      return {
        id: unsupported.id ?? null,
        type: "unsupported",
        methodType: unsupported.type,
        label: unsupported.label ?? unsupported.type,
        form: [],
      };
    }
  }
}

async function resolveSettingsLocation(
  client: OpenCodeClient,
  input: SettingsLocationInput,
  signal = requestSignal(),
): Promise<Awaited<ReturnType<OpenCodeClient["location"]["get"]>>> {
  return client.location.get(locationRequest(input), { signal });
}

async function assertCredential(
  client: OpenCodeClient,
  input: RemoveCredentialInput,
): Promise<void> {
  const response = await client.integration.list(locationRequest(input), {
    signal: requestSignal(),
  });
  const exists = response.data.some((integration) =>
    integration.connections.some(
      (connection) => connection.type === "credential" && connection.id === input.credentialID,
    ),
  );
  if (!exists) throw new Error("Credential does not belong to the selected OpenCode location");
}

export async function loadSettings(
  input: SettingsLocationInput,
  outerSignal?: AbortSignal,
): Promise<PalotSettingsSnapshot> {
  const client = openCodeClient(input.connectionID);
  const request = locationRequest(input);
  const requested = new Set(input.capabilities ?? ALL_SETTINGS_CAPABILITIES);
  const settle = <T>(capability: SettingsCapability, load: (signal: AbortSignal) => Promise<T>) =>
    settleCapability(requested.has(capability), async () => {
      return load(requestSignal(outerSignal));
    });
  let resolvedLocation: ReturnType<typeof resolveSettingsLocation> | null = null;
  const projectID = async (signal: AbortSignal) => {
    resolvedLocation ??= resolveSettingsLocation(client, input, signal);
    return (await resolvedLocation).project.id;
  };
  const results = await Promise.all([
    settle("config", (signal) => client.config.get(request, { signal })),
    settle("catalog", (signal) => listModels(input, signal, input.connectionID)),
    settle("agents", (signal) => client.agent.list(request, { signal })),
    settle("integrations", (signal) => client.integration.list(request, { signal })),
    settle("mcp", (signal) => client.mcp.list(request, { signal })),
    settle("mcpResources", (signal) => client.mcp.resource.catalog(request, { signal })),
    settle("savedPermissions", async (signal) =>
      client.permission.saved.list({ projectID: await projectID(signal) }, { signal }),
    ),
    settle("plugins", (signal) => client.plugin.list(request, { signal })),
    settle("skills", (signal) => client.skill.list(request, { signal })),
    settle("commands", (signal) => client.command.list(request, { signal })),
    settle("references", (signal) => client.reference.list(request, { signal })),
    settle("websearchProviders", (signal) => client.websearch.providers(request, { signal })),
  ] as const);
  outerSignal?.throwIfAborted();
  const [
    config,
    catalog,
    agents,
    integrations,
    mcp,
    mcpResources,
    permissions,
    plugins,
    skills,
    commands,
    references,
    websearchProviders,
  ] = results;
  const groups = [
    ["config", "Configuration"],
    ["catalog", "Models and providers"],
    ["agents", "Agents"],
    ["integrations", "Integrations"],
    ["mcp", "MCP servers"],
    ["mcpResources", "MCP resources"],
    ["savedPermissions", "Saved permissions"],
    ["plugins", "Plugins"],
    ["skills", "Skills"],
    ["commands", "Commands"],
    ["references", "References"],
    ["websearchProviders", "Web search providers"],
  ] as const;

  return {
    location: {
      directory: input.directory,
      ...(input.workspaceID ? { workspaceID: input.workspaceID } : {}),
    },
    configSources:
      config?.status === "fulfilled"
        ? config.value.map((entry) => ({
            type: entry.type,
            path: "path" in entry && typeof entry.path === "string" ? entry.path : null,
            summary: "info" in entry ? configSummary(entry.info) : null,
            formatters: "info" in entry ? configFormatters(entry.info.formatter) : [],
            languageServers: "info" in entry ? configLanguageServers(entry.info.lsp) : [],
            permissions:
              "info" in entry && Array.isArray(entry.info.permissions)
                ? entry.info.permissions.map((rule) => ({ ...rule }))
                : [],
            ...("info" in entry ? configProviderFacts(entry.info) : {}),
          }))
        : [],
    catalog:
      catalog?.status === "fulfilled"
        ? catalog.value
        : { models: [], defaultModel: null, providers: [], errors: [] },
    agents:
      agents?.status === "fulfilled"
        ? agents.value.data.map((agent) => ({
            id: agent.id,
            name: agent.name,
            description: agent.description ?? null,
            mode: agent.mode,
            hidden: agent.hidden,
            color: agent.color ?? null,
            steps: agent.steps ?? null,
            model: agent.model ? { ...agent.model } : null,
            permissions: agent.permissions.map((rule) => ({ ...rule })),
          }))
        : [],
    integrations:
      integrations?.status === "fulfilled"
        ? integrations.value.data.map((integration) => ({
            id: integration.id,
            name: integration.name,
            methods: integration.methods.map(mapIntegrationMethod),
            // OpenCode orders the selected credential first, followed by other stored
            // credentials and environment fallbacks. Its public connection type does
            // not expose this state separately.
            connections: integration.connections.map((connection, index) => ({
              type: connection.type,
              id: connection.type === "credential" ? connection.id : null,
              label: connection.type === "credential" ? connection.label : connection.name,
              active: index === 0,
              ...(connection.type === "credential" && connection.method
                ? { method: connection.method }
                : {}),
            })),
            ...(integration.metadata ? { metadata: toJson(integration.metadata) } : {}),
          }))
        : [],
    mcpResources:
      mcpResources?.status === "fulfilled"
        ? mcpResources.value.data.resources.map((resource) => ({
            server: resource.server,
            name: resource.name,
            uri: resource.uri,
            description: resource.description ?? null,
            mimeType: resource.mimeType ?? null,
          }))
        : [],
    mcpResourceTemplates:
      mcpResources?.status === "fulfilled"
        ? mcpResources.value.data.templates.map((resource) => ({
            server: resource.server,
            name: resource.name,
            uriTemplate: resource.uriTemplate,
            description: resource.description ?? null,
            mimeType: resource.mimeType ?? null,
          }))
        : [],
    mcpServers:
      mcp?.status === "fulfilled"
        ? mcp.value.data.map((server) => ({
            name: server.name,
            status: server.status.status,
            error: server.status.status === "failed" ? server.status.error : null,
            integrationID: server.integrationID ?? null,
          }))
        : [],
    savedPermissions:
      permissions?.status === "fulfilled"
        ? permissions.value.map((permission) => ({ ...permission }))
        : [],
    plugins: plugins?.status === "fulfilled" ? plugins.value.data.map(mapPlugin) : [],
    skills: skills?.status === "fulfilled" ? skills.value.data.map(mapSkill) : [],
    commands: commands?.status === "fulfilled" ? commands.value.data.map(mapCommand) : [],
    references:
      references?.status === "fulfilled"
        ? references.value.data.map((reference) => ({
            name: reference.name,
            path: reference.path,
            description: reference.description ?? null,
            hidden: reference.hidden ?? false,
            sourceType: reference.source.type,
            source:
              reference.source.type === "git"
                ? `${reference.source.repository}${reference.source.branch ? `#${reference.source.branch}` : ""}`
                : reference.source.path,
          }))
        : [],
    websearchProviders:
      websearchProviders?.status === "fulfilled"
        ? websearchProviders.value.data.map((provider) => ({ ...provider }))
        : [],
    errors: [
      ...(catalog?.status === "fulfilled" ? catalog.value.errors : []),
      ...(plugins?.status === "fulfilled"
        ? plugins.value.data.flatMap((plugin) =>
            plugin.state.status === "failed"
              ? [
                  {
                    ...capabilityError("plugins", "Plugins", new Error(plugin.state.error)),
                    ...(plugin.state.ref ? { reference: plugin.state.ref } : {}),
                  },
                ]
              : [],
          )
        : []),
      ...results.flatMap((result, index) => {
        if (!result || result.status !== "rejected") return [];
        const group = groups[index] ?? ["unknown", "Settings"];
        return [capabilityError(group[0], group[1], result.reason)];
      }),
    ],
  };
}

export interface ShellSettings {
  shells: ConfigShellOption[];
  /** The shell saved in global OpenCode config; `null` means OpenCode picks automatically. */
  shell: string | null;
}

/** Shells OpenCode found on the server and the globally configured default. */
export async function loadShellSettings(
  connectionID: string,
  outerSignal?: AbortSignal,
): Promise<ShellSettings> {
  const client = openCodeClient(connectionID);
  const [entries, shells] = await Promise.all([
    client.config.get(undefined, { signal: requestSignal(outerSignal) }),
    client.config.shells({ signal: requestSignal(outerSignal) }),
  ]);
  // Entries before the first directory marker are global; later documents are project config.
  const boundary = entries.findIndex((entry) => entry.type === "directory");
  const global = boundary === -1 ? entries : entries.slice(0, boundary);
  const shell = global
    .flatMap((entry) =>
      entry.type === "document" && typeof entry.info.shell === "string" ? [entry.info.shell] : [],
    )
    .at(-1);
  return { shells, shell: shell ?? null };
}

/** Saves the default shell in global OpenCode config; `null` returns to automatic. */
export async function updateDefaultShell(connectionID: string, shell: string | null) {
  await openCodeClient(connectionID).config.update({ shell }, { signal: requestSignal() });
}

export interface ShellSelectOption {
  /** Value saved to config: the shell name, or its path when names collide. */
  value: string;
  label: string;
  /** OpenCode can open it in terminals but won't run agent commands with it. */
  terminalOnly: boolean;
}

export function shellSelectOptions(settings: ShellSettings): ShellSelectOption[] {
  const counts = new Map<string, number>();
  for (const shell of settings.shells) counts.set(shell.name, (counts.get(shell.name) ?? 0) + 1);
  const options = settings.shells.map((shell) => {
    const ambiguous = (counts.get(shell.name) ?? 0) > 1;
    return {
      value: ambiguous ? shell.path : shell.name,
      label: ambiguous ? shell.path : shell.name,
      terminalOnly: !shell.acceptable,
    };
  });
  if (settings.shell && !options.some((option) => option.value === settings.shell)) {
    options.push({ value: settings.shell, label: settings.shell, terminalOnly: false });
  }
  return options;
}

export async function checkPluginUpdates(input: SettingsLocationInput): Promise<void> {
  await checkPlugins(input);
}

export async function updatePlugin(
  input: SettingsLocationInput & { target: string },
): Promise<void> {
  await updatePlugins({ ...input, targets: [input.target] });
}

export async function addWellknownIntegration(input: AddWellknownIntegrationInput): Promise<void> {
  const client = openCodeClient(input.connectionID);
  await resolveSettingsLocation(client, input);
  await client.integration.wellknown.add(
    { url: input.url, location: settingsLocation(input) },
    { signal: requestSignal() },
  );
}

export async function addMcpServer(input: AddMcpServerInput): Promise<void> {
  const client = openCodeClient(input.connectionID);
  validateMcpConfig(input.config);
  await resolveSettingsLocation(client, input);
  await client.mcp.add(
    { server: input.server, location: settingsLocation(input), config: input.config },
    { signal: requestSignal() },
  );
}

export function validateMcpConfig(config: AddMcpServerInput["config"]): void {
  if (config.type === "local") {
    if (!config.command[0]?.trim()) throw new Error("Local MCP servers require a command.");
    return;
  }
  let url: URL;
  try {
    url = new URL(config.url);
  } catch {
    throw new Error("Remote MCP server URLs must be valid HTTP or HTTPS URLs.");
  }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) {
    throw new Error("Remote MCP server URLs must be valid HTTP or HTTPS URLs without credentials.");
  }
}

export async function removeMcpServer(input: McpServerInput): Promise<void> {
  const client = openCodeClient(input.connectionID);
  await resolveSettingsLocation(client, input);
  await client.mcp.remove(
    { server: input.server, location: settingsLocation(input) },
    { signal: requestSignal() },
  );
}

export async function connectMcpServer(input: McpServerInput): Promise<void> {
  const client = openCodeClient(input.connectionID);
  await resolveSettingsLocation(client, input);
  await client.mcp.connect(
    { server: input.server, location: settingsLocation(input) },
    { signal: requestSignal() },
  );
}

export async function disconnectMcpServer(input: McpServerInput): Promise<void> {
  const client = openCodeClient(input.connectionID);
  await resolveSettingsLocation(client, input);
  await client.mcp.disconnect(
    { server: input.server, location: settingsLocation(input) },
    { signal: requestSignal() },
  );
}

export async function removeSavedPermission(input: RemoveSavedPermissionInput): Promise<void> {
  const client = openCodeClient(input.connectionID);
  const location = await resolveSettingsLocation(client, input);
  const saved = await client.permission.saved.list(
    { projectID: location.project.id },
    { signal: requestSignal() },
  );
  if (!saved.some((permission) => permission.id === input.id)) {
    throw new Error("Saved permission does not belong to the selected project");
  }
  await client.permission.saved.remove({ id: input.id }, { signal: requestSignal() });
}

export async function connectIntegrationKey(input: ConnectIntegrationKeyInput): Promise<void> {
  const client = openCodeClient(input.connectionID);
  await resolveSettingsLocation(client, input);
  await client.integration.connect.key(
    {
      integrationID: input.integrationID,
      location: settingsLocation(input),
      key: input.key,
      ...(input.answer ? { answer: input.answer } : {}),
      ...(input.label ? { label: input.label } : {}),
    },
    { signal: requestSignal() },
  );
}

export async function connectIntegrationOAuth(
  input: ConnectIntegrationOAuthInput,
): Promise<PalotIntegrationOAuthAttempt> {
  const client = openCodeClient(input.connectionID);
  await resolveSettingsLocation(client, input);
  const response = await client.integration.oauth.connect(
    {
      integrationID: input.integrationID,
      methodID: input.methodID,
      location: settingsLocation(input),
      ...(input.answer ? { answer: input.answer } : {}),
      ...(input.label ? { label: input.label } : {}),
    },
    { signal: requestSignal() },
  );
  return {
    attemptID: response.data.attemptID,
    url: response.data.url,
    instructions: response.data.instructions,
    mode: response.data.mode,
    createdAt: finiteNumber(response.data.time.created),
    expiresAt: finiteNumber(response.data.time.expires),
  };
}

export async function connectIntegrationExternal(
  input: ConnectIntegrationExternalInput,
): Promise<void> {
  const client = openCodeClient(input.connectionID);
  await resolveSettingsLocation(client, input);
  await client.integration.connect.external(
    {
      integrationID: input.integrationID,
      methodID: input.methodID,
      location: settingsLocation(input),
      ...(input.answer ? { answer: input.answer } : {}),
      ...(input.label ? { label: input.label } : {}),
    },
    { signal: requestSignal() },
  );
}

export async function integrationOAuthStatus(
  input: IntegrationAttemptInput,
): Promise<PalotIntegrationAttemptStatus> {
  const client = openCodeClient(input.connectionID);
  await resolveSettingsLocation(client, input);
  const response = await client.integration.oauth.status(
    {
      integrationID: input.integrationID,
      attemptID: input.attemptID,
      location: settingsLocation(input),
    },
    { signal: requestSignal() },
  );
  return mapAttemptStatus(response.data);
}

export async function completeIntegrationOAuth(
  input: CompleteIntegrationOAuthInput,
): Promise<void> {
  const client = openCodeClient(input.connectionID);
  await resolveSettingsLocation(client, input);
  await client.integration.oauth.complete(
    {
      integrationID: input.integrationID,
      attemptID: input.attemptID,
      location: settingsLocation(input),
      ...(input.code !== undefined ? { code: input.code } : {}),
    },
    { signal: requestSignal() },
  );
}

export async function cancelIntegrationOAuth(input: IntegrationAttemptInput): Promise<void> {
  const client = openCodeClient(input.connectionID);
  await resolveSettingsLocation(client, input);
  await client.integration.oauth.cancel(
    {
      integrationID: input.integrationID,
      attemptID: input.attemptID,
      location: settingsLocation(input),
    },
    { signal: requestSignal() },
  );
}

export async function connectIntegrationCommand(
  input: ConnectIntegrationCommandInput,
): Promise<PalotIntegrationCommandAttempt> {
  const client = openCodeClient(input.connectionID);
  await resolveSettingsLocation(client, input);
  const integrations = await client.integration.list(locationRequest(input), {
    signal: requestSignal(),
  });
  const method = integrations.data
    .find((integration) => integration.id === input.integrationID)
    ?.methods.find(
      (candidate): candidate is IntegrationCommandMethod =>
        candidate.type === "command" && candidate.id === input.methodID,
    );
  if (!method || !sameStrings(method.command, input.command)) {
    throw new Error(
      "The integration command changed after it was reviewed. Review it again before connecting.",
    );
  }
  const response = await client.integration.command.connect(
    {
      integrationID: input.integrationID,
      methodID: input.methodID,
      location: settingsLocation(input),
      ...(input.label ? { label: input.label } : {}),
    },
    { signal: requestSignal() },
  );
  return {
    attemptID: response.data.attemptID,
    createdAt: finiteNumber(response.data.time.created),
    expiresAt: finiteNumber(response.data.time.expires),
  };
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export async function integrationCommandStatus(
  input: IntegrationAttemptInput,
): Promise<PalotIntegrationAttemptStatus> {
  const client = openCodeClient(input.connectionID);
  await resolveSettingsLocation(client, input);
  const response = await client.integration.command.status(
    {
      integrationID: input.integrationID,
      attemptID: input.attemptID,
      location: settingsLocation(input),
    },
    { signal: requestSignal() },
  );
  return mapAttemptStatus(response.data);
}

export async function cancelIntegrationCommand(input: IntegrationAttemptInput): Promise<void> {
  const client = openCodeClient(input.connectionID);
  await resolveSettingsLocation(client, input);
  await client.integration.command.cancel(
    {
      integrationID: input.integrationID,
      attemptID: input.attemptID,
      location: settingsLocation(input),
    },
    { signal: requestSignal() },
  );
}

export async function updateCredential(input: UpdateCredentialInput): Promise<void> {
  const client = openCodeClient(input.connectionID);
  await resolveSettingsLocation(client, input);
  await assertCredential(client, input);
  await client.credential.update(
    {
      credentialID: input.credentialID,
      label: input.label,
    },
    { signal: requestSignal() },
  );
}

export async function activateCredential(input: ActivateCredentialInput): Promise<void> {
  const client = openCodeClient(input.connectionID);
  await resolveSettingsLocation(client, input);
  await assertCredential(client, input);
  await client.credential.activate(
    { credentialID: input.credentialID },
    { signal: requestSignal() },
  );
}

export async function removeCredential(input: RemoveCredentialInput): Promise<void> {
  const client = openCodeClient(input.connectionID);
  await resolveSettingsLocation(client, input);
  await assertCredential(client, input);
  await client.credential.remove({ credentialID: input.credentialID }, { signal: requestSignal() });
}
