import type { PermissionRuleset } from "@opencode/client";
import type { PalotSession } from "../../shared";
import { CHAT_MARKER_FILE, chatFolderName, chatRootDirectory, joinServerPath } from "../lib/chats";
import { openCodeClient } from "./opencode-client";
import { palot } from "./palot";

type Client = ReturnType<typeof openCodeClient>;

/** The server's default folder is inside a repository, so chat folders would join it. */
export class ChatFolderUnavailableError extends Error {
  constructor(readonly directory: string) {
    super(
      `Chats need a folder outside a repository, but this server's default folder (${directory}) is inside one. Start the server from another folder, such as your home folder.`,
    );
    this.name = "ChatFolderUnavailableError";
  }
}

const trimmed = (path: string) => path.replace(/[\\/]+$/, "");

/**
 * The server's default folder, which holds `.palot/chats`. OpenCode resolves a folder to the
 * nearest enclosing repository, so a default folder inside one would make every chat part of
 * that repository's project; refuse instead, as T3 Code does for its scratch folders.
 */
export async function chatHomeDirectory(client: Client, signal?: AbortSignal): Promise<string> {
  const options = signal ? { signal } : undefined;
  const home = await client.location.get({}, options);
  const insideAnother = trimmed(home.project.directory) !== trimmed(home.directory);
  const project = insideAnother
    ? null
    : (await client.project.list(undefined, options)).find((item) => item.id === home.project.id);
  if (insideAnother || project?.vcs) throw new ChatFolderUnavailableError(home.directory);
  return home.directory;
}

/**
 * Starts a project-free chat: creates its folder under the server's `.palot/chats` and a
 * session there. The folder is created first so the agent's working folder exists.
 */
export async function createChatSession(input: {
  connectionID: string | undefined;
  permissions?: PermissionRuleset;
  /** The first message, for a readable folder name. */
  prompt?: string;
  now?: number;
}): Promise<PalotSession | null> {
  const client = openCodeClient(input.connectionID);
  const home = await chatHomeDirectory(client);
  const id = crypto.randomUUID().replaceAll("-", "").slice(0, 6);
  const directory = joinServerPath(
    chatRootDirectory(home),
    chatFolderName(input.now ?? Date.now(), input.prompt, id),
  );
  await client.experimental.file.write({
    path: joinServerPath(directory, CHAT_MARKER_FILE),
    payload: new TextEncoder().encode(`${JSON.stringify({ version: 1 })}\n`),
  });
  return palot.createSession(directory, undefined, input.connectionID, input.permissions);
}
