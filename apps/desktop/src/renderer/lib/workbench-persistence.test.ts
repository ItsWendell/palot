import { describe, expect, it } from "vitest";
import { parseWorkbenchState } from "./workbench-persistence";
import {
  createWorkbenchState,
  MAX_WORKBENCH_SCOPES,
  mutateWorkbench,
  openWorkbenchTab,
  workbenchScopeKey,
} from "./workbench-tabs";
import { updateBtwTab } from "./btw";

describe("workbench persistence", () => {
  it("round-trips side questions and answers independently and forgets closed tabs", () => {
    const scope = { profileID: "profile", sessionID: "session" };
    let state = createWorkbenchState();
    for (const questionID of ["one", "two"]) {
      state = openWorkbenchTab(
        state,
        scope,
        { kind: "btw", location: { directory: "/repo" }, questionID, question: "Same question?" },
        {},
        1,
        () => questionID,
      ).state;
    }
    state = updateBtwTab(state, scope, "one", (tab) => ({
      ...tab,
      resource: { ...tab.resource, answer: "First answer" },
    }));
    const reloaded = parseWorkbenchState(JSON.parse(JSON.stringify(state)));
    expect(reloaded).toEqual(state);
    expect(reloaded.scopes[workbenchScopeKey(scope)]?.right.tabs).toHaveLength(2);
    const closed = mutateWorkbench(reloaded, scope, { type: "close", pane: "right", tabID: "one" });
    expect(
      parseWorkbenchState(JSON.parse(JSON.stringify(closed))).scopes[workbenchScopeKey(scope)]
        ?.right.tabs,
    ).toMatchObject([{ id: "two", resource: { question: "Same question?" } }]);
  });

  it("retains side answers until closed even after browsing more than the recent scope limit", () => {
    const owner = { profileID: "profile", sessionID: "owner" };
    let state = openWorkbenchTab(
      createWorkbenchState(),
      owner,
      { kind: "btw", location: { directory: "/repo" }, questionID: "one", question: "Keep me?" },
      {},
      1,
    ).state;
    for (let i = 0; i < MAX_WORKBENCH_SCOPES + 2; i++) {
      state = openWorkbenchTab(
        state,
        { profileID: "profile", sessionID: `other-${i}` },
        { kind: "context", location: { directory: "/repo" } },
        {},
        i + 2,
      ).state;
    }
    expect(state.scopes[workbenchScopeKey(owner)]?.right.tabs[0]?.kind).toBe("btw");
    expect(parseWorkbenchState(state).scopes[workbenchScopeKey(owner)]?.right.tabs[0]?.kind).toBe(
      "btw",
    );
  });

  it("rejects saved side questions belonging to another scope", () => {
    const scope = { profileID: "profile", sessionID: "session" };
    const state = openWorkbenchTab(createWorkbenchState(), scope, {
      kind: "btw",
      location: { directory: "/repo" },
      questionID: "one",
      question: "Owner?",
    }).state;
    const context = state.scopes[workbenchScopeKey(scope)]!;
    expect(
      parseWorkbenchState({ ...state, scopes: { "other\u0000session": context } }).scopes[
        "other\u0000session"
      ]?.right.tabs,
    ).toEqual([]);
  });
  it("drops corrupt tabs and repairs active identity", () => {
    const parsed = parseWorkbenchState({
      version: 1,
      scopes: {
        "profile\u0000session": {
          updatedAt: 3,
          right: {
            requestedOpen: true,
            activeTabID: "missing",
            tabs: [
              {
                id: "changes",
                kind: "changes",
                pinned: true,
                resource: { profileID: "profile", location: { directory: "/repo" } },
              },
              { id: "bad", kind: "unknown", pinned: false, resource: {} },
            ],
          },
          bottom: { requestedOpen: true, activeTabID: null, tabs: [] },
        },
      },
    });

    expect(parsed.scopes["profile\u0000session"]?.right.tabs).toHaveLength(1);
    expect(parsed.scopes["profile\u0000session"]?.right.tabs[0]).toMatchObject({
      kind: "changes",
      resource: { mode: "working" },
    });
    expect(parsed.scopes["profile\u0000session"]?.right.activeTabID).toBe("changes");
    expect(parsed.scopes["profile\u0000session"]?.bottom.requestedOpen).toBe(false);
  });

  it("recovers from invalid input", () => {
    expect(parseWorkbenchState("broken")).toEqual({ version: 1, scopes: {} });
  });

  it("persists valid context tabs and removes duplicate session resources", () => {
    const context = {
      id: "context-right",
      kind: "context",
      pinned: true,
      resource: {
        profileID: "profile",
        sessionID: "session",
        location: { directory: "/repo" },
      },
    };
    const parsed = parseWorkbenchState({
      version: 1,
      scopes: {
        "profile\u0000session": {
          updatedAt: 4,
          right: { requestedOpen: true, activeTabID: context.id, tabs: [context] },
          bottom: {
            requestedOpen: true,
            activeTabID: "context-bottom",
            tabs: [{ ...context, id: "context-bottom", pinned: false }],
          },
        },
      },
    });

    expect(parsed.scopes["profile\u0000session"]?.right.tabs).toEqual([context]);
    expect(parsed.scopes["profile\u0000session"]?.bottom).toEqual({
      tabs: [],
      activeTabID: null,
      requestedOpen: false,
    });
  });

  it("persists workspace file tabs and their line target", () => {
    const parsed = parseWorkbenchState({
      version: 1,
      scopes: {
        "profile\u0000session": {
          updatedAt: 5,
          right: {
            requestedOpen: true,
            activeTabID: "file",
            tabs: [
              {
                id: "file",
                kind: "file",
                pinned: false,
                resource: {
                  profileID: "profile",
                  location: { directory: "/repo" },
                  path: "src/app.ts",
                  line: 42,
                },
              },
            ],
          },
          bottom: { requestedOpen: false, activeTabID: null, tabs: [] },
        },
      },
    });

    expect(parsed.scopes["profile\u0000session"]?.right.tabs[0]).toMatchObject({
      kind: "file",
      resource: { path: "src/app.ts", line: 42 },
    });
  });

  it("restores one files browser per workspace across panes", () => {
    const tab = {
      id: "files",
      kind: "workspace-files",
      pinned: true,
      resource: { profileID: "profile", location: { directory: "/repo", workspaceID: "ws" } },
    };
    const parsed = parseWorkbenchState({
      version: 1,
      scopes: {
        "profile\u0000session": {
          updatedAt: 5,
          right: { requestedOpen: true, activeTabID: "files", tabs: [tab] },
          bottom: { requestedOpen: true, activeTabID: "copy", tabs: [{ ...tab, id: "copy" }] },
        },
      },
    });
    expect(parsed.scopes["profile\u0000session"]?.right.tabs).toEqual([tab]);
    expect(parsed.scopes["profile\u0000session"]?.bottom.tabs).toEqual([]);
  });

  it("collapses persisted working and branch reviews into one changes tab", () => {
    const parsed = parseWorkbenchState({
      version: 1,
      scopes: {
        "profile\u0000session": {
          updatedAt: 6,
          right: {
            requestedOpen: true,
            activeTabID: "branch",
            tabs: [
              {
                id: "working",
                kind: "changes",
                pinned: true,
                resource: {
                  profileID: "profile",
                  location: { directory: "/repo" },
                  mode: "working",
                },
              },
              {
                id: "branch",
                kind: "changes",
                pinned: true,
                resource: {
                  profileID: "profile",
                  location: { directory: "/repo" },
                  mode: "branch",
                },
              },
            ],
          },
          bottom: { requestedOpen: false, activeTabID: null, tabs: [] },
        },
      },
    });

    expect(parsed.scopes["profile\u0000session"]?.right).toMatchObject({
      activeTabID: "branch",
      tabs: [
        expect.objectContaining({
          id: "branch",
          resource: expect.objectContaining({ mode: "branch" }),
        }),
      ],
    });
  });

  it("restores distinct turn diffs and rejects turns without a user message", () => {
    const resource = {
      profileID: "profile",
      location: { directory: "/repo" },
      sessionID: "session",
      userMessageID: "user-1",
    };
    const parsed = parseWorkbenchState({
      version: 1,
      scopes: {
        "profile\u0000session": {
          updatedAt: 7,
          right: {
            requestedOpen: true,
            activeTabID: "turn-1",
            tabs: [
              { id: "turn-1", kind: "turn-diff", pinned: false, resource },
              {
                id: "bad",
                kind: "turn-diff",
                pinned: false,
                resource: { ...resource, userMessageID: "" },
              },
            ],
          },
          bottom: {
            requestedOpen: true,
            activeTabID: "turn-2",
            tabs: [
              {
                id: "turn-2",
                kind: "turn-diff",
                pinned: false,
                resource: { ...resource, userMessageID: "user-2" },
              },
              { id: "duplicate", kind: "turn-diff", pinned: false, resource },
            ],
          },
        },
      },
    });
    expect(parsed.scopes["profile\u0000session"]?.right.tabs.map((tab) => tab.id)).toEqual([
      "turn-1",
    ]);
    expect(parsed.scopes["profile\u0000session"]?.bottom.tabs.map((tab) => tab.id)).toEqual([
      "turn-2",
    ]);
  });
});
