/**
 * Project-free chats. OpenCode has no session without a directory, so Palot gives each chat its
 * own folder under `.palot/chats` in the server's default folder (its home, for a local
 * service). OpenCode registers each folder as a directory project; Palot recognizes chats by
 * that path, shows them as chats, and hides their folders from project lists.
 */
import type { PalotProject, PalotSession } from "../../shared";
import { isChatDirectory } from "../../shared/chat-folders";

export { isChatDirectory };

export const CHAT_FOLDER = [".palot", "chats"] as const;
/** Written into a new chat folder to create it on any server; Palot never reads it back. */
export const CHAT_MARKER_FILE = ".palot-chat";

export function isChatSession(session: Pick<PalotSession, "location">): boolean {
  return isChatDirectory(session.location.directory);
}

export function isChatProject(project: Pick<PalotProject, "canonical">): boolean {
  return isChatDirectory(project.canonical);
}

/** Projects a person chose, without the folders Palot made for chats. */
export function withoutChatProjects<T extends Pick<PalotProject, "canonical">>(projects: T[]): T[] {
  return projects.some(isChatProject)
    ? projects.filter((project) => !isChatProject(project))
    : projects;
}

/** `2026-10-27-quick-question-about-rrule-k3f9x2`: sortable, readable, unique. */
export function chatFolderName(now: number, prompt: string | undefined, id: string): string {
  const date = new Date(now);
  const day = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
  const words = (prompt ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/[\s-]+/)
    .filter(Boolean)
    .slice(0, 5);
  const slug = words.join("-").slice(0, 48).replace(/-+$/, "") || "chat";
  return `${day}-${slug}-${id}`;
}

/** The chats folder inside the server's default folder, in that server's path style. */
export function chatRootDirectory(serverDirectory: string): string {
  const separator = serverDirectory.includes("\\") && !serverDirectory.includes("/") ? "\\" : "/";
  return [serverDirectory.replace(/[\\/]+$/, ""), ...CHAT_FOLDER].join(separator);
}

export function joinServerPath(directory: string, name: string): string {
  const separator = directory.includes("\\") && !directory.includes("/") ? "\\" : "/";
  return `${directory.replace(/[\\/]+$/, "")}${separator}${name}`;
}
