import { isSessionNotFoundError, type SessionMessagesResponse } from "@opencode/client";
import type {
  FindWorkspaceFilesInput,
  ListDiffsInput,
  ListModelsInput,
  ListSessionsInput,
  LoadMessagesInput,
  PalotModelCatalog,
  PalotPage,
  PromptInput,
  PromptReceipt,
  PalotSession,
  SessionRequestSnapshot,
} from "../../shared";
import { workspaceFileAttachments } from "../lib/workspace-references";
import { openCodeClient } from "./opencode-client";
import { attachmentPrompt, type AttachmentDeliveryInput } from "./opencode-attachment-delivery";
import {
  mapCommand,
  mapModel,
  mapProject,
  mapProvider,
  mapSession,
  mapSkill,
} from "./opencode-mappers";
import { mergeBuiltinCommands } from "../lib/builtin-commands";
import { openCodeRequestSignal } from "./opencode-request";

const DEFAULT_MESSAGE_LIMIT = 20;

const pageWindow = (cursor?: string) => (cursor ? { cursor } : { order: "desc" as const });
const location = (input: { directory: string; workspaceID?: string }) => ({
  directory: input.directory,
  ...(input.workspaceID ? { workspace: input.workspaceID } : {}),
});
const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "Unknown OpenCode error";

export async function listProjects(requestSignal?: AbortSignal) {
  return (
    await openCodeClient().project.list({ signal: openCodeRequestSignal(requestSignal) })
  ).map(mapProject);
}

export async function listSessions(
  input: ListSessionsInput = {},
  requestSignal?: AbortSignal,
): Promise<PalotPage<PalotSession>> {
  const response = await openCodeClient().session.list(
    {
      limit: input.limit ?? 50,
      parentID: null,
      ...(input.search ? { search: input.search } : {}),
      ...pageWindow(input.cursor),
    },
    { signal: openCodeRequestSignal(requestSignal) },
  );
  return {
    data: response.data.map(mapSession),
    cursor: { previous: response.cursor.previous ?? null, next: response.cursor.next ?? null },
  };
}

export async function listChildSessions(
  parentID: string,
  requestSignal?: AbortSignal,
): Promise<PalotSession[]> {
  const combinedSignal = openCodeRequestSignal(requestSignal);
  const sessions: PalotSession[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  while (true) {
    const response = await openCodeClient().session.list(
      { limit: 100, parentID, ...(cursor ? { cursor } : {}) },
      { signal: combinedSignal },
    );
    sessions.push(...response.data.map(mapSession));
    const next = response.cursor.next;
    if (!next || seen.has(next)) break;
    seen.add(next);
    cursor = next;
  }
  return sessions.toSorted((left, right) => left.createdAt - right.createdAt);
}

export async function getSession(
  sessionID: string,
  requestSignal?: AbortSignal,
  connectionID?: string,
): Promise<PalotSession | null> {
  try {
    return mapSession(
      await openCodeClient(connectionID).session.get(
        { sessionID },
        { signal: openCodeRequestSignal(requestSignal) },
      ),
    );
  } catch (error) {
    if (isSessionNotFoundError(error)) return null;
    throw error;
  }
}

async function rootedMessages(
  input: LoadMessagesInput,
  requestSignal?: AbortSignal,
  client = openCodeClient(),
): Promise<SessionMessagesResponse> {
  const pages: SessionMessagesResponse[] = [];
  const seen = new Set<string>();
  let cursor = input.cursor;
  let nextCursor: string | null = null;
  const limit = input.limit ?? DEFAULT_MESSAGE_LIMIT;
  const combinedSignal = openCodeRequestSignal(requestSignal);
  while (true) {
    const page = await client.message.list(
      {
        sessionID: input.sessionID,
        limit,
        ...pageWindow(cursor),
      },
      { signal: combinedSignal },
    );
    pages.push(page);
    const chronological = pages.flatMap((item) => item.data).toReversed();
    const boundary = chronological.find(
      (message) =>
        message.type === "user" ||
        message.type === "shell" ||
        message.type === "assistant" ||
        (message.type === "synthetic" && Boolean(message.description?.trim())),
    );
    const next = page.cursor.next ?? null;
    if (boundary?.type !== "assistant") {
      nextCursor =
        page.data.length < limit
          ? null
          : await verifiedMessageCursor(input.sessionID, next, combinedSignal, client);
      break;
    }
    if (page.data.length < limit || !next || seen.has(next)) break;
    seen.add(next);
    cursor = next;
  }
  return {
    data: pages.flatMap((page) => page.data),
    cursor: {
      previous: pages[0]?.cursor.previous ?? null,
      next: nextCursor,
    },
  };
}

async function verifiedMessageCursor(
  sessionID: string,
  cursor: string | null,
  signal: AbortSignal,
  client = openCodeClient(),
): Promise<string | null> {
  if (!cursor) return null;
  const probe = await client.message.list({ sessionID, cursor, limit: 1 }, { signal });
  return probe.data.length > 0 ? cursor : null;
}

export async function loadMessages(
  input: LoadMessagesInput,
  rooted = true,
  requestSignal?: AbortSignal,
  connectionID?: string,
): Promise<SessionMessagesResponse> {
  const client = openCodeClient(connectionID);
  const limit = input.limit ?? DEFAULT_MESSAGE_LIMIT;
  const response = rooted
    ? await rootedMessages(input, requestSignal, client)
    : await client.message.list(
        {
          sessionID: input.sessionID,
          limit,
          ...pageWindow(input.cursor),
        },
        { signal: openCodeRequestSignal(requestSignal) },
      );
  const next = response.data.length < limit ? null : (response.cursor.next ?? null);
  return {
    data: response.data,
    cursor: {
      previous: response.cursor.previous ?? null,
      next:
        rooted || !next
          ? next
          : await verifiedMessageCursor(
              input.sessionID,
              next,
              openCodeRequestSignal(requestSignal),
              client,
            ),
    },
  };
}

/** A separate pagination stream: never use these cursors for transcript history. */
export async function loadPromptIndex(
  sessionID: string,
  cursor: string | null,
  requestSignal?: AbortSignal,
): Promise<SessionMessagesResponse> {
  const signal = openCodeRequestSignal(requestSignal);
  const page = await openCodeClient().message.list(
    { sessionID, type: "user", limit: 100, ...pageWindow(cursor ?? undefined) },
    { signal },
  );
  const next = page.data.length < 100 ? null : (page.cursor.next ?? null);
  // The API can return an end cursor even when the next page is empty.
  const more = next
    ? await openCodeClient().message.list(
        { sessionID, type: "user", limit: 1, cursor: next },
        { signal },
      )
    : null;
  return {
    data: page.data,
    cursor: { previous: page.cursor.previous ?? null, next: more?.data.length ? next : null },
  };
}

export async function listRunningShells(
  input: { directory: string; workspaceID?: string },
  requestSignal?: AbortSignal,
) {
  const response = await openCodeClient().shell.list(
    { location: location(input) },
    { signal: openCodeRequestSignal(requestSignal) },
  );
  return response.data
    .filter((shell) => shell.status === "running")
    .map((shell) => ({
      id: shell.id,
      sessionID: typeof shell.metadata.sessionID === "string" ? shell.metadata.sessionID : null,
      command: shell.command,
      cwd: shell.cwd,
      startedAt: shell.time.started,
      status: shell.status,
      ...(shell.exit === undefined ? {} : { exit: shell.exit }),
    }));
}

export async function listRequests(
  sessionID: string,
  requestSignal?: AbortSignal,
  connectionID?: string,
): Promise<SessionRequestSnapshot> {
  const client = openCodeClient(connectionID);
  const options = { signal: openCodeRequestSignal(requestSignal) };
  const values = await Promise.allSettled([
    client.permission.list({ sessionID }, options),
    client.session.form.list({ sessionID }, options),
    client.session.inbox.list({ sessionID }, options),
  ]);
  const errors = values.flatMap((result, index) =>
    result.status === "rejected"
      ? [
          `${["permissions", "forms", "inbox"][index]}:${result.reason instanceof Error ? result.reason.message : "Unknown OpenCode error"}`,
        ]
      : [],
  );
  if (requestSignal?.aborted) throw requestSignal.reason;
  return {
    permissions: values[0]?.status === "fulfilled" ? values[0].value : [],
    forms: values[1]?.status === "fulfilled" ? values[1].value : [],
    inbox: values[2]?.status === "fulfilled" ? values[2].value : [],
    errors,
  };
}

export async function listSessionInputs(
  sessionID: string,
  requestSignal?: AbortSignal,
  connectionID?: string,
) {
  return openCodeClient(connectionID).session.inbox.list(
    { sessionID },
    { signal: openCodeRequestSignal(requestSignal) },
  );
}

export async function listDiffs(
  input: ListDiffsInput,
  requestSignal?: AbortSignal,
  connectionID?: string,
) {
  const response = await openCodeClient(connectionID).vcs.diff(
    {
      location: location(input),
      mode: input.mode,
      ...(input.mode === "branch" && input.base ? { base: input.base } : {}),
      ...(input.context !== undefined ? { context: input.context } : {}),
    },
    { signal: openCodeRequestSignal(requestSignal) },
  );
  return response.data;
}

export async function listModels(
  input: ListModelsInput,
  requestSignal?: AbortSignal,
  connectionID?: string,
): Promise<PalotModelCatalog> {
  const client = openCodeClient(connectionID);
  const request = { location: location(input) };
  const combinedSignal = openCodeRequestSignal(requestSignal);
  const [models, defaultModel, providers] = await Promise.allSettled([
    client.model.list(request, { signal: combinedSignal }),
    client.model.default(request, { signal: combinedSignal }),
    client.provider.list(request, { signal: combinedSignal }),
  ]);
  if (combinedSignal.aborted) throw combinedSignal.reason;
  const mappedDefault =
    defaultModel.status === "fulfilled" && defaultModel.value.data
      ? mapModel(defaultModel.value.data)
      : null;
  const mappedModels =
    models.status === "fulfilled"
      ? models.value.data.filter((model) => model.enabled).map(mapModel)
      : [];
  if (
    mappedDefault &&
    !mappedModels.some(
      (model) => model.id === mappedDefault.id && model.providerID === mappedDefault.providerID,
    )
  )
    mappedModels.unshift(mappedDefault);
  return {
    models: mappedModels,
    defaultModel: mappedDefault,
    providers: providers.status === "fulfilled" ? providers.value.data.map(mapProvider) : [],
    errors: [
      ...(models.status === "rejected"
        ? [
            {
              capability: "models",
              label: "Available models",
              message: errorMessage(models.reason),
            },
          ]
        : []),
      ...(defaultModel.status === "rejected"
        ? [
            {
              capability: "defaultModel",
              label: "Default model",
              message: errorMessage(defaultModel.reason),
            },
          ]
        : []),
      ...(providers.status === "rejected"
        ? [{ capability: "providers", label: "Providers", message: errorMessage(providers.reason) }]
        : []),
    ],
  };
}

export async function loadComposerCatalog(
  input: ListModelsInput,
  requestSignal?: AbortSignal,
  connectionID?: string,
) {
  const client = openCodeClient(connectionID);
  const request = { location: location(input) };
  const combinedSignal = openCodeRequestSignal(requestSignal);
  const [commands, skills] = await Promise.allSettled([
    client.command.list(request, { signal: combinedSignal }),
    client.skill.list(request, { signal: combinedSignal }),
  ]);
  if (combinedSignal.aborted) throw combinedSignal.reason;
  const customCommands = commands.status === "fulfilled" ? commands.value.data.map(mapCommand) : [];
  return {
    commands: mergeBuiltinCommands(customCommands),
    skills: skills.status === "fulfilled" ? skills.value.data.map(mapSkill) : [],
    errors: [
      ...(commands.status === "rejected"
        ? [{ capability: "commands", label: "Commands", message: errorMessage(commands.reason) }]
        : []),
      ...(skills.status === "rejected"
        ? [{ capability: "skills", label: "Skills", message: errorMessage(skills.reason) }]
        : []),
    ],
  };
}

export async function findWorkspaceFiles(
  input: FindWorkspaceFilesInput,
  requestSignal?: AbortSignal,
  connectionID?: string,
) {
  const response = await openCodeClient(connectionID).file.find(
    { location: location(input), query: input.query, type: "file", limit: input.limit ?? 20 },
    { signal: openCodeRequestSignal(requestSignal) },
  );
  return response.data.map((entry) => ({
    path: entry.path.replaceAll("\\", "/"),
    type: entry.type,
  }));
}

export async function readWorkspaceFile(
  input: { directory: string; workspaceID?: string; path: string },
  requestSignal?: AbortSignal,
  connectionID?: string,
) {
  return openCodeClient(connectionID).file.read(
    { location: location(input), path: input.path },
    { signal: openCodeRequestSignal(requestSignal) },
  );
}

export async function listWorkspaceDirectory(
  input: { directory: string; workspaceID?: string; path?: string },
  requestSignal?: AbortSignal,
  connectionID?: string,
) {
  const response = await openCodeClient(connectionID).file.list(
    {
      location: location(input),
      ...(input.path ? { path: input.path } : {}),
    },
    { signal: openCodeRequestSignal(requestSignal) },
  );
  return response.data;
}

export async function sessionLocation(sessionID: string, requestSignal?: AbortSignal) {
  const session = await openCodeClient().session.get(
    { sessionID },
    { signal: openCodeRequestSignal(requestSignal) },
  );
  return session.location;
}

export function promptFiles(
  directory: string,
  references: Parameters<typeof workspaceFileAttachments>[1],
) {
  return workspaceFileAttachments(directory, references);
}

export async function sendPrompt(
  input: PromptInput & AttachmentDeliveryInput,
): Promise<PromptReceipt> {
  const client = openCodeClient();
  const { inlineFiles, ...delivery } = attachmentPrompt(input.text, input);
  const session = input.fileReferences?.length ? await sessionLocation(input.sessionID) : null;
  const files = [
    ...inlineFiles.map((file) => ({ uri: file.uri, name: file.name })),
    ...(session ? promptFiles(session.directory, input.fileReferences ?? []) : []),
  ];
  const pending = await client.session.prompt(
    {
      sessionID: input.sessionID,
      ...(input.id ? { id: input.id } : {}),
      ...delivery,
      ...(files.length ? { files } : {}),
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
  return {
    id: pending.id,
    sessionID: pending.sessionID,
    type: pending.type,
    delivery: pending.type === "user" ? pending.delivery : null,
    createdAt: pending.time.created ?? null,
  };
}
