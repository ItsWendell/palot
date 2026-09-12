// @vitest-environment node
import { describe, expect, it } from "vitest";
import { parseDesktopLaunch } from "./desktop-launch";

describe("desktop launch routing", () => {
  it("resolves project paths against the launching process directory", () => {
    expect(
      parseDesktopLaunch(
        ["/opt/palot/palot", "--project", "../project with spaces"],
        "/home/user/code",
      ),
    ).toEqual({ type: "project", directory: "/home/user/project with spaces" });
  });
  it("ignores Chromium switches and routes task IDs", () => {
    expect(parseDesktopLaunch(["--ozone-platform=wayland", "--task", "ses_123abc"], "/")).toEqual({
      type: "session",
      sessionID: "ses_123abc",
    });
    expect(parseDesktopLaunch(["--remote-debugging-port=9223"], "/")).toBeNull();
  });
  it("rejects ambiguous and malformed actions", () => {
    expect(() => parseDesktopLaunch(["--project"], "/")).toThrow("requires a value");
    expect(() => parseDesktopLaunch(["--task", "../../etc/passwd"], "/")).toThrow("session ID");
    expect(() => parseDesktopLaunch(["--show", "--new-task"], "/")).toThrow("Choose one");
  });
});
