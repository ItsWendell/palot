/** A project-free chat's folder: `<server default folder>/.palot/chats/<name>`. */
const CHAT_DIRECTORY = /[\\/]\.palot[\\/]chats[\\/][^\\/]+[\\/]?$/;

export function isChatDirectory(directory: string | null | undefined): boolean {
  return Boolean(directory && CHAT_DIRECTORY.test(directory));
}
