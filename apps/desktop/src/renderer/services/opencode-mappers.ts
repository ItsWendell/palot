import type {
  CommandInfo,
  ModelInfo,
  PermissionRuleset,
  Project,
  PromptFileAttachment,
  ProviderInfo,
  SessionInfo,
  SessionMessageAssistant,
  SessionMessageAssistantReasoning,
  SessionMessageAssistantText,
  SessionMessageAssistantTool,
  SessionMessageCompaction,
  SessionMessageInfo,
  SkillInfo,
  TokenUsageInfo,
} from "@opencode/client";
import type {
  JsonValue,
  PalotCommand,
  PalotFileAttachment,
  PalotMessage,
  PalotMessageContent,
  PalotModel,
  PalotProject,
  PalotProvider,
  PalotSession,
  PalotSkill,
} from "../../shared";

const projectCache = new WeakMap<Project, PalotProject>();
const sessionCache = new WeakMap<SessionInfo, PalotSession>();
const permissionCache = new WeakMap<PermissionRuleset, PermissionRuleset>();

function mapPermissions(rules: PermissionRuleset): PermissionRuleset {
  const cached = permissionCache.get(rules);
  if (cached) return cached;
  const mapped = rules.map((rule) => ({ ...rule }));
  permissionCache.set(rules, mapped);
  return mapped;
}

function json(value: unknown, seen = new WeakSet<object>()): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "undefined" || typeof value === "function" || typeof value === "symbol")
    return null;
  if (Array.isArray(value)) return value.map((item) => json(item, seen));
  if (typeof value !== "object") return String(value);
  if (seen.has(value)) return "[Circular]";
  seen.add(value);
  const result: Record<string, JsonValue> = {};
  for (const [key, item] of Object.entries(value)) result[key] = json(item, seen);
  seen.delete(value);
  return result;
}

function mapTokens(tokens: TokenUsageInfo): PalotSession["tokens"] {
  return {
    input: tokens.input,
    output: tokens.output,
    reasoning: tokens.reasoning,
    cache: { ...tokens.cache },
  };
}

export function mapProject(project: Project): PalotProject {
  const cached = projectCache.get(project);
  if (cached) return cached;
  const mapped = {
    id: project.id,
    canonical: project.canonical,
    name: project.name ?? null,
    sandboxes: [...project.sandboxes],
    vcs: project.vcs ? json(project.vcs) : null,
    updatedAt: typeof project.time.updated === "number" ? project.time.updated : null,
  };
  projectCache.set(project, mapped);
  return mapped;
}

export function mapSession(session: SessionInfo): PalotSession {
  const cached = sessionCache.get(session);
  if (cached) return cached;
  const mapped = {
    id: session.id,
    parentID: session.parentID ?? null,
    projectID: session.projectID,
    title: session.title ?? null,
    agent: session.agent ?? null,
    model: session.model ? { ...session.model } : null,
    ...(session.permissions === undefined
      ? {}
      : { permissions: mapPermissions(session.permissions) }),
    location: { ...session.location },
    createdAt: session.time.created,
    updatedAt: session.time.updated,
    ...(session.time.idle === undefined ? {} : { idleAt: session.time.idle }),
    ...(session.time.viewed === undefined ? {} : { viewedAt: session.time.viewed }),
    ...(session.outcome ? { outcome: session.outcome } : {}),
    archivedAt: session.time.archived ?? null,
    cost: typeof session.cost === "number" ? session.cost : null,
    tokens: mapTokens(session.tokens),
    ...(session.revert
      ? {
          revert: {
            messageID: session.revert.messageID,
            ...(session.revert.partID ? { partID: session.revert.partID } : {}),
            ...(session.revert.snapshot ? { snapshot: session.revert.snapshot } : {}),
            ...(session.revert.files
              ? { files: session.revert.files.map((file) => ({ ...file })) }
              : {}),
          },
        }
      : {}),
  };
  sessionCache.set(session, mapped);
  return mapped;
}

function mapPresentation(value: JsonValue | undefined): Pick<PalotMessageContent, "presentation"> {
  return value === "thought" || value === "preamble" || value === "recap"
    ? { presentation: value }
    : {};
}

function mapTextContent(
  value: SessionMessageAssistantText | SessionMessageAssistantReasoning,
): PalotMessageContent {
  return {
    type: value.type,
    text: value.text,
    ...mapPresentation(value.state?.presentation),
    ...(value.type === "reasoning" && value.time ? { time: { ...value.time } } : {}),
    ...(value.state ? { state: json(value.state) } : {}),
    data: json(value),
  };
}

function mapToolContent(value: SessionMessageAssistantTool): PalotMessageContent {
  return {
    type: value.type,
    id: value.id,
    name: value.name,
    time: { ...value.time },
    ...(value.executed !== undefined ? { executed: value.executed } : {}),
    ...(value.providerState ? { providerState: json(value.providerState) } : {}),
    ...(value.providerResultState ? { providerResultState: json(value.providerResultState) } : {}),
    state: json(value.state),
    data: json(value),
  };
}

function mapAssistantContent(
  value: SessionMessageAssistant["content"][number],
): PalotMessageContent {
  switch (value.type) {
    case "text":
    case "reasoning":
      return mapTextContent(value);
    case "tool":
      return mapToolContent(value);
  }
}

function mapCompactionContent(value: SessionMessageCompaction): PalotMessageContent {
  return {
    type: value.type,
    id: value.id,
    time: { created: value.time.created },
    status: value.status,
    reason: value.reason,
    text: "summary" in value ? value.summary : "",
    ...(value.status === "failed" ? {} : { recent: value.recent }),
    ...(value.status === "failed" ? { error: value.error.message } : {}),
    ...(value.status !== "running" && value.cost !== undefined ? { cost: value.cost } : {}),
    ...(value.status !== "running" && value.tokens ? { tokens: mapTokens(value.tokens) } : {}),
    data: json(value),
  };
}

// Match the read-image preview raster allowlist and native attachment byte limit.
const ATTACHMENT_IMAGE_MIMES = new Set(["image/gif", "image/jpeg", "image/png", "image/webp"]);
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

function attachmentImageDataUrl(attachment: PromptFileAttachment): string | undefined {
  const mime = attachment.mime.toLowerCase();
  const data = attachment.data;
  if (
    !ATTACHMENT_IMAGE_MIMES.has(mime) ||
    !data ||
    data.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 ||
    data.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(data)
  )
    return undefined;
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  if ((data.length / 4) * 3 - padding > MAX_IMAGE_BYTES) return undefined;
  return `data:${mime};base64,${data}`;
}

function mapFiles(files: PromptFileAttachment[] | undefined) {
  if (!files) return {};
  const attachments = files
    .filter((attachment) => !attachment.mention)
    .map((attachment, index): PalotFileAttachment => ({
      uri:
        attachment.source.type === "uri"
          ? attachment.source.uri
          : `opencode-inline:attachment-${index + 1}`,
      name: attachment.name ?? `Attachment ${index + 1}`,
      mime: attachment.mime,
      previewDataUrl: attachmentImageDataUrl(attachment),
      size: null,
    }));
  return {
    ...(attachments.length ? { files: attachments } : {}),
    fileReferences: files.flatMap((attachment) =>
      attachment.mention && attachment.source.type === "uri"
        ? [
            {
              uri: attachment.source.uri,
              name: attachment.name ?? attachment.mention.text,
              mention: { ...attachment.mention },
            },
          ]
        : [],
    ),
  };
}

export function mapMessage(message: SessionMessageInfo): PalotMessage {
  let text: string | null = null;
  let agent: string | null = null;
  let model: PalotMessage["model"] = null;
  let tokens: TokenUsageInfo | null = null;
  let finish: PalotMessage["finish"] = null;
  let rawFinish: string | undefined;
  let providerState: JsonValue | undefined;
  let content: PalotMessageContent[] = [];
  let files: Pick<PalotMessage, "files" | "fileReferences"> = {};
  let skillReferences: PalotMessage["skillReferences"];

  switch (message.type) {
    case "agent-switched":
      agent = message.agent;
      break;
    case "model-switched":
      model = { ...message.model };
      break;
    case "synthetic":
    case "system":
    case "skill":
      text = message.text;
      break;
    case "user":
      text =
        message.metadata?.palotAttachmentPaths === true &&
        typeof message.metadata.displayText === "string"
          ? message.metadata.displayText
          : message.text;
      files = mapFiles(message.files);
      if (
        message.metadata?.palotAttachmentPaths === true &&
        Array.isArray(message.metadata.attachments)
      ) {
        const references = message.metadata.attachments.flatMap((entry) => {
          if (
            !entry ||
            typeof entry !== "object" ||
            Array.isArray(entry) ||
            typeof entry.uri !== "string" ||
            typeof entry.name !== "string" ||
            typeof entry.mime !== "string"
          )
            return [];
          return [
            {
              uri: entry.uri,
              name: entry.name,
              mime: entry.mime,
              size: typeof entry.size === "number" ? entry.size : null,
            },
          ];
        });
        files = { ...files, files: [...(files.files ?? []), ...references] };
      }
      skillReferences = message.skills?.flatMap((skill) =>
        skill.mention
          ? [
              {
                id: skill.id,
                mention: { ...skill.mention },
                ...(skill.text ? { text: skill.text } : {}),
              },
            ]
          : [],
      );
      break;
    case "assistant":
      agent = message.agent;
      model = { ...message.model };
      tokens = message.tokens ? mapTokens(message.tokens) : null;
      finish = message.finish ?? null;
      rawFinish = message.rawFinish;
      providerState = message.providerState ? json(message.providerState) : undefined;
      content = message.content.map(mapAssistantContent);
      break;
    case "compaction":
      if (message.status === "completed") {
        model = message.model ? { ...message.model } : null;
        providerState = message.providerState ? json(message.providerState) : undefined;
      }
      content = [mapCompactionContent(message)];
      break;
    case "location-switched":
    case "shell":
      break;
  }

  const completedAt =
    message.type === "assistant" || message.type === "shell"
      ? (message.time.completed ?? null)
      : message.type === "compaction" && message.status !== "running"
        ? message.time.created
        : null;

  return {
    id: message.id,
    type: message.type,
    createdAt: message.time.created,
    ...(message.type === "assistant" && message.time.streamed !== undefined
      ? { streamedAt: message.time.streamed }
      : {}),
    completedAt,
    text,
    agent,
    model,
    tokens,
    finish,
    ...(rawFinish !== undefined ? { rawFinish } : {}),
    ...(providerState !== undefined ? { providerState } : {}),
    ...files,
    ...(skillReferences ? { skillReferences } : {}),
    content,
    data: json(message),
  };
}

export function mapModel(model: ModelInfo): PalotModel {
  return {
    id: model.id,
    modelID: model.modelID,
    providerID: model.providerID,
    canonicalProviderID: model.canonical ?? model.providerID,
    name: model.name,
    family: model.family ?? null,
    variants: model.variants.map((variant) => variant.id),
    inputLimit: model.limit.input ?? null,
    contextLimit: model.limit.context,
    outputLimit: model.limit.output,
    releasedAt: model.time.released,
    capabilities: {
      tools: model.capabilities.tools,
      input: [...model.capabilities.input],
      output: [...model.capabilities.output],
    },
    compatibility: {
      requireAssistantAfterTool: model.compatibility?.requireAssistantAfterTool ?? false,
      requireReasoning: model.compatibility?.requireReasoning ?? false,
    },
    status: model.status,
  };
}

export function mapProvider(provider: ProviderInfo): PalotProvider {
  return {
    id: provider.id,
    canonicalID: provider.canonical ?? provider.id,
    name: provider.name,
    integrationID: provider.integrationID ?? null,
    package: provider.package,
    disabled: provider.activation === "disabled",
  };
}

export function mapSkill(skill: SkillInfo): PalotSkill {
  return {
    id: skill.id,
    name: skill.name,
    description: skill.description ?? null,
    location: skill.path,
    slash: true,
    autoinvoke: skill.autoinvoke ?? false,
  };
}

export function mapCommand(command: CommandInfo): PalotCommand {
  return {
    name: command.name,
    description: command.description ?? null,
    agent: null,
    model: null,
    subtask: false,
  };
}

export function toJson(value: unknown): JsonValue {
  return json(value);
}
