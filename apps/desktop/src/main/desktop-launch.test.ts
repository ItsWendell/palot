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
  it("opens palot://task links and ignores anything else that claims the scheme", () => {
    const id = "ses_0123456789abcdefghijABCDEF";
    expect(parseDesktopLaunch(["/opt/palot/palot", `palot://task/${id}`], "/")).toEqual({
      type: "session",
      sessionID: id,
    });
    expect(parseDesktopLaunch([`palot://task/${id}?profile=local-default`], "/")).toEqual({
      type: "session",
      sessionID: id,
      profileID: "local-default",
    });
    for (const link of [
      "palot://task/ses_123abc",
      `palot://task/${id}/extra`,
      `palot://task/${id}#x`,
      `palot://task/${id}?profile=../x`,
      `palot://task/${id}?profile=a&profile=b`,
      `palot://task/${id}?other=1`,
      `palot://user:pw@task/${id}`,
      `palot://pair?token=abc`,
      "palot://task/../../etc/passwd",
    ])
      expect(parseDesktopLaunch([link], "/")).toBeNull();
    expect(() => parseDesktopLaunch([`palot://task/${id}`, "--new-task"], "/")).toThrow(
      "Choose one",
    );
  });
  it("takes a link the Linux desktop entry passes after --show", () => {
    const id = "ses_0123456789abcdefghijABCDEF";
    // `Exec=palot-nightly --show %U`, on first launch and as second-instance argv.
    for (const args of [
      ["/opt/Palot Nightly/palot-nightly", "--show", `palot://task/${id}`],
      [
        "/opt/Palot Nightly/palot-nightly",
        "--ozone-platform=wayland",
        "--show",
        `palot://task/${id}`,
      ],
    ])
      expect(parseDesktopLaunch(args, "/")).toEqual({ type: "session", sessionID: id });
    // %U expands to nothing for a plain launch, and a malformed link does not cancel --show.
    expect(parseDesktopLaunch(["palot-nightly", "--show"], "/")).toEqual({ type: "open" });
    expect(parseDesktopLaunch(["--show", "palot://task/ses_123abc"], "/")).toEqual({
      type: "open",
    });
  });
  it("rejects ambiguous and malformed actions", () => {
    expect(() => parseDesktopLaunch(["--project"], "/")).toThrow("requires a value");
    expect(() => parseDesktopLaunch(["--task", "../../etc/passwd"], "/")).toThrow("session ID");
    expect(() => parseDesktopLaunch(["--show", "--new-task"], "/")).toThrow("Choose one");
  });
});
