import { describe, expect, it } from "vitest";
import { mentionFileSuggestions, openWorkbenchFiles } from "./composer-open-files";
import type { WorkbenchContextState, WorkbenchTab } from "./workbench-tabs";

const location = { directory: "/repo" };

function file(id: string, path: string, overrides: Partial<WorkbenchTab["resource"]> = {}) {
  return {
    id,
    pinned: false,
    kind: "file",
    resource: { profileID: "profile", location, path, ...overrides },
  } as WorkbenchTab;
}

function context(
  right: WorkbenchTab[],
  rightActive: string | null,
  bottom: WorkbenchTab[] = [],
  bottomActive: string | null = null,
): WorkbenchContextState {
  return {
    right: { tabs: right, activeTabID: rightActive, requestedOpen: true },
    bottom: { tabs: bottom, activeTabID: bottomActive, requestedOpen: false },
    updatedAt: 1,
  };
}

describe("openWorkbenchFiles", () => {
  it("puts the active file first, then other open files once each", () => {
    const tabs = [file("a", "src/a.ts"), file("b", "src/b.ts"), file("dup", "src/a.ts")];
    expect(openWorkbenchFiles(context(tabs, "b"), "profile", location)).toEqual([
      "src/b.ts",
      "src/a.ts",
    ]);
  });

  it("ignores tabs from another profile or location and non-file tabs", () => {
    const tabs = [
      file("other-profile", "secret.ts", { profileID: "other" }),
      file("other-location", "elsewhere.ts", { location: { directory: "/other" } }),
      file("other-workspace", "ws.ts", { location: { directory: "/repo", workspaceID: "w" } }),
      {
        id: "changes",
        pinned: false,
        kind: "changes",
        resource: { profileID: "profile", location, mode: "working" },
      } as WorkbenchTab,
      file("mine", "mine.ts"),
    ];
    expect(openWorkbenchFiles(context(tabs, "other-profile"), "profile", location)).toEqual([
      "mine.ts",
    ]);
    expect(openWorkbenchFiles(context(tabs, "mine"), null, location)).toEqual([]);
  });
});

describe("mentionFileSuggestions", () => {
  it("lists matching open files before search results without repeating them", () => {
    expect(
      mentionFileSuggestions(
        ["src/active.ts", "docs/readme.md"],
        ["src/other.ts", "src/active.ts"],
        "SRC",
      ),
    ).toEqual([
      { path: "src/active.ts", open: true },
      { path: "src/other.ts", open: false },
    ]);
  });
});
