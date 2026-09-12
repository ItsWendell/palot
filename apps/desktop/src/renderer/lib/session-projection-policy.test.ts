import { describe, expect, it } from "vitest";
import type { PalotMessageContent } from "../../shared";
import {
  DEFAULT_SESSION_PROJECTION_PREFERENCE,
  activityCategory,
  isSessionProjectionPreference,
  migrateSessionProjectionPreference,
  resolveSessionProjectionPreference,
} from "./session-projection-policy";

function tool(name: string, input: Record<string, string>): PalotMessageContent {
  return { type: "tool", name, state: { status: "completed", input } };
}

describe("session projection policy", () => {
  it("defaults new users to balanced activity", () => {
    const policy = resolveSessionProjectionPreference(DEFAULT_SESSION_PROJECTION_PREFERENCE);

    expect(policy).toMatchObject({
      foldCompletedTurns: true,
      groupTitle: "summary",
      groupSameFileReads: true,
      showReasoningSummaries: true,
      keepCurrentActivityExpanded: true,
      categories: {
        read: { presentation: "grouped", details: "collapsed", foldedTurn: "inside" },
        edit: { presentation: "grouped", details: "collapsed", foldedTurn: "inside" },
        command: { presentation: "grouped", details: "collapsed", foldedTurn: "inside" },
      },
    });
  });

  it("resolves category overrides without mutating the preset", () => {
    const policy = resolveSessionProjectionPreference({
      version: 2,
      preset: "code-focus",
      categories: { read: { presentation: "hidden" } },
    });

    expect(policy.categories.read).toEqual({
      presentation: "hidden",
      details: "collapsed",
      foldedTurn: "inside",
    });
    expect(
      resolveSessionProjectionPreference(DEFAULT_SESSION_PROJECTION_PREFERENCE).categories.read
        .presentation,
    ).toBe("grouped");
  });

  it("migrates the legacy compact boolean", () => {
    expect(migrateSessionProjectionPreference(true)).toEqual({ version: 2, preset: "compact" });
    expect(migrateSessionProjectionPreference(false)).toEqual({ version: 2, preset: "expanded" });
    expect(
      migrateSessionProjectionPreference({
        version: 1,
        preset: "compact",
        groupSameFileReads: true,
      }),
    ).toEqual({ version: 2, preset: "compact", groupSameFileReads: true });
    expect(migrateSessionProjectionPreference("compact")).toBeUndefined();
  });

  it("validates persisted category overrides", () => {
    expect(
      isSessionProjectionPreference({
        version: 2,
        preset: "code-focus",
        groupTitle: "latest-reasoning",
        groupSameFileReads: true,
        showReasoningSummaries: false,
        keepCurrentActivityExpanded: true,
        categories: { command: { presentation: "individual", foldedTurn: "pinned" } },
      }),
    ).toBe(true);
    expect(
      isSessionProjectionPreference({
        version: 2,
        preset: "code-focus",
        categories: { command: { presentation: "sometimes" } },
      }),
    ).toBe(false);
    expect(
      isSessionProjectionPreference({
        version: 2,
        preset: "code-focus",
        groupTitle: "recent-tool",
      }),
    ).toBe(false);
  });

  it("classifies interpreted native and command-derived searches", () => {
    expect(activityCategory(tool("grep", { pattern: "ToolRow", path: "src" }), 0)).toBe(
      "code-search",
    );
    expect(activityCategory(tool("glob", { pattern: "**/*.tsx" }), 0)).toBe("code-search");
    expect(activityCategory(tool("shell", { command: "rg ToolRow src" }), 0)).toBe("code-search");
    expect(
      activityCategory(tool("shell", { command: "ast-grep -p 'console.log($A)' src" }), 0),
    ).toBe("code-search");
  });

  it("keeps compound shell commands classified as commands", () => {
    expect(activityCategory(tool("shell", { command: "bun test | rg failed" }), 0)).toBe("command");
    expect(activityCategory(tool("shell", { command: 'result="$(rg ToolRow src)"' }), 0)).toBe(
      "command",
    );
  });
});
