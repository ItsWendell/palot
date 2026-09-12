import { describe, expect, it } from "vitest";
import { parseWorkbenchState } from "./workbench-persistence";
import {
  createWorkbenchState,
  mutateWorkbench,
  openWorkbenchTab,
  workbenchScopeKey,
  workbenchTabTitle,
  type WorkbenchScope,
} from "./workbench-tabs";

const scope: WorkbenchScope = { profileID: "profile-1", sessionID: "session-1" };
const location = { directory: "/repo" };

describe("workbench tabs", () => {
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
