import { describe, expect, it } from "vitest";
import { parseWorkbenchState } from "./workbench-persistence";
import {
  createWorkbenchState,
  mutateWorkbench,
  openWorkbenchTab,
  reconcileBrowserPages,
  workbenchScopeKey,
  workbenchTabTitle,
  type WorkbenchScope,
} from "./workbench-tabs";

const scope: WorkbenchScope = { profileID: "profile-1", sessionID: "session-1" };
const location = { directory: "/repo" };

describe("workbench tabs", () => {
  it("projects browser pages by ID and preserves placement while their inventory changes", () => {
    const first = reconcileBrowserPages(
      createWorkbenchState(),
      scope,
      location,
      ["page-a", "page-b"],
      "page-a",
      new Map(),
      1,
      (() => {
        let n = 0;
        return () => `wb-${++n}`;
      })(),
    );
    expect(first.scopes[workbenchScopeKey(scope)]?.right.tabs).toMatchObject([
      { id: "wb-1", kind: "browser", resource: { browserTabID: "page-a" } },
      { id: "wb-2", kind: "browser", resource: { browserTabID: "page-b" } },
    ]);
    const moved = mutateWorkbench(first, scope, {
      type: "move",
      from: "right",
      to: "bottom",
      tabID: "wb-2",
    });
    const same = reconcileBrowserPages(moved, scope, location, ["page-b", "page-a"]);
    expect(same).toBe(moved);
    expect(same.scopes[workbenchScopeKey(scope)]?.bottom.tabs[0]?.id).toBe("wb-2");
    const closed = reconcileBrowserPages(moved, scope, location, ["page-b"]);
    expect(closed.scopes[workbenchScopeKey(scope)]?.right.tabs).toHaveLength(0);
    expect(closed.scopes[workbenchScopeKey(scope)]?.bottom.tabs[0]?.id).toBe("wb-2");
  });

  it("migrates the old browser launcher without creating a second page inventory", () => {
    const saved = parseWorkbenchState({
      version: 1,
      scopes: {
        [workbenchScopeKey(scope)]: {
          updatedAt: 1,
          right: { requestedOpen: false, activeTabID: null, tabs: [] },
          bottom: {
            requestedOpen: true,
            activeTabID: "old-browser",
            tabs: [
              {
                id: "old-browser",
                kind: "browser",
                pinned: true,
                resource: { ...scope, location },
              },
            ],
          },
        },
      },
    });
    const migrated = reconcileBrowserPages(saved, scope, location, ["page-one", "page-two"]);
    expect(migrated.scopes[workbenchScopeKey(scope)]?.bottom.tabs).toMatchObject([
      { id: "old-browser", pinned: false, resource: { browserTabID: "page-one" } },
    ]);
    expect(migrated.scopes[workbenchScopeKey(scope)]?.right.tabs).toMatchObject([
      { resource: { browserTabID: "page-two" } },
    ]);
    expect(
      reconcileBrowserPages(saved, scope, location, []).scopes[workbenchScopeKey(scope)]?.bottom,
    ).toMatchObject({ tabs: [], requestedOpen: false });
  });

  it("keeps background browser pages without opening a pane or consuming ordinary tab slots", () => {
    const background = reconcileBrowserPages(createWorkbenchState(), scope, location, ["page"]);
    expect(background.scopes[workbenchScopeKey(scope)]?.right).toMatchObject({
      requestedOpen: false,
      tabs: [{ kind: "browser", resource: { browserTabID: "page" } }],
    });
    const focused = reconcileBrowserPages(background, scope, location, ["page"], "page");
    expect(focused.scopes[workbenchScopeKey(scope)]?.right.requestedOpen).toBe(true);
    let state = focused;
    for (let i = 0; i < 24; i++) {
      const opened = openWorkbenchTab(state, scope, {
        kind: "file",
        location,
        path: `file-${i}.ts`,
      });
      expect(opened.result.ok).toBe(true);
      state = opened.state;
    }
    expect(
      parseWorkbenchState(JSON.parse(JSON.stringify(state))).scopes[workbenchScopeKey(scope)]?.right
        .tabs,
    ).toHaveLength(25);
  });

  it("places a locally opened page in its requested pane while agent-created pages default right", () => {
    const projected = reconcileBrowserPages(
      createWorkbenchState(),
      scope,
      location,
      ["local-page", "agent-page"],
      "local-page",
      new Map([["local-page", "bottom"]]),
    );
    const context = projected.scopes[workbenchScopeKey(scope)]!;
    expect(context.bottom).toMatchObject({
      requestedOpen: true,
      tabs: [{ resource: { browserTabID: "local-page" } }],
    });
    expect(context.right).toMatchObject({
      requestedOpen: false,
      tabs: [{ resource: { browserTabID: "agent-page" } }],
    });
  });
  it("restores and reopens a command output tab without duplicating it", () => {
    const input = {
      kind: "command" as const,
      location,
      shellID: "sh_one",
      command: "bun run test",
    };
    const first = openWorkbenchTab(createWorkbenchState(), scope, input, {}, 1, () => "command-1");
    const restored = parseWorkbenchState(JSON.parse(JSON.stringify(first.state)));
    const reopened = openWorkbenchTab(restored, scope, input, { pane: "right" }, 2);
    expect(reopened.result).toMatchObject({ tabID: "command-1", created: false, pane: "bottom" });
    expect(restored.scopes[workbenchScopeKey(scope)]?.bottom.tabs[0]).toMatchObject({
      kind: "command",
      resource: { shellID: "sh_one", command: "bun run test", sessionID: scope.sessionID },
    });
  });

  it("keeps an inspected terminal read-only across restoration and reopen", () => {
    const input = {
      kind: "terminal" as const,
      location,
      ptyID: "pty_one",
      transport: "persistent" as const,
      readOnly: true,
    };
    const first = openWorkbenchTab(createWorkbenchState(), scope, input, {}, 1, () => "terminal-1");
    const restored = parseWorkbenchState(JSON.parse(JSON.stringify(first.state)));
    const reopened = openWorkbenchTab(restored, scope, input);
    expect(reopened.result).toMatchObject({ tabID: "terminal-1", created: false });
    expect(restored.scopes[workbenchScopeKey(scope)]?.bottom.tabs[0]).toMatchObject({
      resource: { readOnly: true },
    });
  });

  it("opens an empty pane so it can show the surface launcher", () => {
    const opened = mutateWorkbench(createWorkbenchState(), scope, {
      type: "toggle-pane",
      pane: "right",
    });

    expect(opened.scopes[workbenchScopeKey(scope)]?.right).toMatchObject({
      tabs: [],
      activeTabID: null,
      requestedOpen: true,
    });
  });

  it("deduplicates resources across panes without moving implicitly", () => {
    const first = openWorkbenchTab(
      createWorkbenchState(),
      scope,
      { kind: "changes", location, mode: "working" },
      {},
      1,
      () => "tab-1",
    );
    const second = openWorkbenchTab(
      first.state,
      scope,
      { kind: "changes", location, mode: "working" },
      { pane: "bottom" },
      2,
      () => "tab-2",
    );

    expect(second.result).toEqual({
      ok: true,
      tabID: "tab-1",
      pane: "right",
      created: false,
      moved: false,
    });
    expect(second.state.scopes[workbenchScopeKey(scope)]?.right.tabs).toHaveLength(1);
    expect(second.state.scopes[workbenchScopeKey(scope)]?.bottom.tabs).toHaveLength(0);
  });

  it("opens one pinned context tab per session in the right pane", () => {
    const first = openWorkbenchTab(
      createWorkbenchState(),
      scope,
      { kind: "context", location },
      {},
      1,
      () => "context-1",
    );
    const duplicate = openWorkbenchTab(
      first.state,
      scope,
      { kind: "context", location: { directory: "/moved-repo" } },
      { pane: "bottom" },
      2,
      () => "context-2",
    );

    expect(first.result).toMatchObject({ created: true, pane: "right" });
    expect(first.state.scopes[workbenchScopeKey(scope)]?.right.tabs[0]).toMatchObject({
      id: "context-1",
      kind: "context",
      pinned: true,
      resource: { profileID: scope.profileID, sessionID: scope.sessionID },
    });
    expect(duplicate.result).toEqual({
      ok: true,
      tabID: "context-1",
      pane: "right",
      created: false,
      moved: false,
    });
  });

  it("retargets one stable changes tab between working and branch reviews", () => {
    const working = openWorkbenchTab(
      createWorkbenchState(),
      scope,
      { kind: "changes", location, mode: "working" },
      {},
      1,
      () => "working",
    );
    const branch = openWorkbenchTab(
      working.state,
      scope,
      { kind: "changes", location, mode: "branch" },
      {},
      2,
      () => "branch",
    );

    expect(branch.result).toMatchObject({ created: false, tabID: "working" });
    expect(branch.state.scopes[workbenchScopeKey(scope)]?.right.tabs).toEqual([
      expect.objectContaining({
        id: "working",
        kind: "changes",
        resource: expect.objectContaining({ mode: "branch" }),
      }),
    ]);
    expect(workbenchTabTitle(branch.state.scopes[workbenchScopeKey(scope)]!.right.tabs[0]!)).toBe(
      "Changes",
    );
  });

  it("keeps turn reviews separate from working changes and other turns", () => {
    const changes = openWorkbenchTab(
      createWorkbenchState(),
      scope,
      { kind: "changes", location, mode: "working" },
      {},
      1,
      () => "changes",
    );
    const first = openWorkbenchTab(
      changes.state,
      scope,
      { kind: "turn-diff", location, userMessageID: "user-1" },
      {},
      2,
      () => "turn-1",
    );
    const second = openWorkbenchTab(
      first.state,
      scope,
      { kind: "turn-diff", location, userMessageID: "user-2" },
      {},
      3,
      () => "turn-2",
    );
    const reopened = openWorkbenchTab(
      second.state,
      scope,
      { kind: "turn-diff", location, userMessageID: "user-1" },
      { pane: "bottom" },
      4,
      () => "duplicate",
    );
    expect(reopened.result).toMatchObject({ created: false, pane: "right", tabID: "turn-1" });
    expect(
      reopened.state.scopes[workbenchScopeKey(scope)]?.right.tabs.map((tab) => tab.id),
    ).toEqual(["changes", "turn-1", "turn-2"]);
    expect(workbenchTabTitle(second.state.scopes[workbenchScopeKey(scope)]!.right.tabs[1]!)).toBe(
      "Turn changes",
    );
  });

  it("opens workspace files in the right pane and updates their line target", () => {
    const first = openWorkbenchTab(
      createWorkbenchState(),
      scope,
      { kind: "file", location, path: "src/app.ts", line: 5 },
      {},
      1,
      () => "file",
    );
    const second = openWorkbenchTab(
      first.state,
      scope,
      { kind: "file", location, path: "src/app.ts", line: 18 },
      {},
      2,
      () => "duplicate",
    );

    expect(first.result).toMatchObject({ created: true, pane: "right" });
    expect(second.result).toMatchObject({ created: false, tabID: "file", pane: "right" });
    expect(second.state.scopes[workbenchScopeKey(scope)]?.right.tabs).toEqual([
      {
        id: "file",
        kind: "file",
        pinned: false,
        resource: { profileID: scope.profileID, location, path: "src/app.ts", line: 18 },
      },
    ]);
  });

  it("keeps one pinned files browser per location while preserving move and file tabs", () => {
    const first = openWorkbenchTab(
      createWorkbenchState(),
      scope,
      { kind: "workspace-files", location },
      { pane: "bottom" },
      1,
      () => "browser",
    );
    const moved = mutateWorkbench(first.state, scope, {
      type: "move",
      from: "bottom",
      to: "right",
      tabID: "browser",
    });
    const reopened = openWorkbenchTab(
      moved,
      scope,
      { kind: "workspace-files", location },
      { pane: "bottom" },
      2,
      () => "duplicate",
    );
    const file = openWorkbenchTab(
      reopened.state,
      scope,
      { kind: "file", location, path: "src/main.ts" },
      { pane: "right" },
      3,
      () => "file",
    );
    expect(reopened.result).toMatchObject({ created: false, pane: "right", tabID: "browser" });
    expect(file.state.scopes[workbenchScopeKey(scope)]?.right.tabs.map((tab) => tab.id)).toEqual([
      "browser",
      "file",
    ]);
    expect(file.state.scopes[workbenchScopeKey(scope)]?.right.tabs[0]?.pinned).toBe(true);
    expect(workbenchTabTitle(first.state.scopes[workbenchScopeKey(scope)]!.bottom.tabs[0]!)).toBe(
      "Files",
    );
  });

  it("moves a tab and leaves the empty source pane open as a launcher", () => {
    const opened = openWorkbenchTab(
      createWorkbenchState(),
      scope,
      { kind: "terminal", location, ptyID: "pty-1", transport: "persistent" },
      {},
      1,
      () => "tab-1",
    );
    const moved = mutateWorkbench(opened.state, scope, {
      type: "move",
      from: "bottom",
      to: "right",
      tabID: "tab-1",
    });
    const context = moved.scopes[workbenchScopeKey(scope)]!;

    expect(context.bottom).toMatchObject({ tabs: [], activeTabID: null, requestedOpen: true });
    expect(context.right).toMatchObject({ activeTabID: "tab-1", requestedOpen: true });
  });

  it("selects the nearest tab after closing the active tab", () => {
    const first = openWorkbenchTab(
      createWorkbenchState(),
      scope,
      { kind: "file-diff", location, path: "a.ts", mode: "working" },
      {},
      1,
      () => "a",
    );
    const second = openWorkbenchTab(
      first.state,
      scope,
      { kind: "file-diff", location, path: "b.ts", mode: "working" },
      {},
      2,
      () => "b",
    );
    const third = openWorkbenchTab(
      second.state,
      scope,
      { kind: "file-diff", location, path: "c.ts", mode: "working" },
      {},
      3,
      () => "c",
    );
    const closed = mutateWorkbench(third.state, scope, {
      type: "close",
      pane: "right",
      tabID: "b",
    });

    expect(closed.scopes[workbenchScopeKey(scope)]?.right.activeTabID).toBe("c");
  });

  it.each(["right", "bottom"] as const)("closes the %s pane when its final tab closes", (pane) => {
    const opened = openWorkbenchTab(
      createWorkbenchState(),
      scope,
      pane === "bottom"
        ? { kind: "terminal", location, ptyID: "pty-1", transport: "persistent" }
        : { kind: "changes", location, mode: "working" },
      { pane },
      1,
      () => "tab",
    );
    const closed = mutateWorkbench(opened.state, scope, {
      type: "close",
      pane,
      tabID: "tab",
    });

    expect(closed.scopes[workbenchScopeKey(scope)]?.[pane]).toEqual({
      tabs: [],
      activeTabID: null,
      requestedOpen: false,
    });
  });
});
