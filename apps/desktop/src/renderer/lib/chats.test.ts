import { describe, expect, it } from "vitest";
import {
  chatFolderName,
  chatRootDirectory,
  isChatDirectory,
  joinServerPath,
  withoutChatProjects,
} from "./chats";

describe("project-free chats", () => {
  it("recognizes chat folders on POSIX and Windows servers", () => {
    expect(isChatDirectory("/home/me/.palot/chats/2026-10-27-hello-abc123")).toBe(true);
    expect(isChatDirectory("C:\\Users\\me\\.palot\\chats\\2026-10-27-chat-abc123\\")).toBe(true);
    expect(isChatDirectory("/home/me/.palot/chats")).toBe(false);
    expect(isChatDirectory("/home/me/.palot/chats/x/src")).toBe(false);
    expect(isChatDirectory("/home/me/Projects/palot")).toBe(false);
    expect(isChatDirectory(undefined)).toBe(false);
  });

  it("names folders by date, the first words of the prompt, and an ID", () => {
    const now = new Date(2026, 9, 27, 12).getTime();
    expect(chatFolderName(now, "Quick question about RRULE's DST handling?", "k3f9x2")).toBe(
      "2026-10-27-quick-question-about-rrule-s-k3f9x2",
    );
    expect(chatFolderName(now, "   ", "k3f9x2")).toBe("2026-10-27-chat-k3f9x2");
    expect(chatFolderName(now, "Ünïcödé café", "id")).toBe("2026-10-27-unicode-cafe-id");
  });

  it("builds paths in the server's style and hides chat folders from project lists", () => {
    expect(chatRootDirectory("/home/me/")).toBe("/home/me/.palot/chats");
    expect(chatRootDirectory("C:\\Users\\me")).toBe("C:\\Users\\me\\.palot\\chats");
    expect(joinServerPath("/a/b/", "c")).toBe("/a/b/c");
    const projects = [{ canonical: "/repo" }, { canonical: "/home/me/.palot/chats/2026-x-1" }];
    expect(withoutChatProjects(projects)).toEqual([{ canonical: "/repo" }]);
  });
});
