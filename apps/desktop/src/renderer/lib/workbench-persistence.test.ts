import { describe, expect, it } from "vitest";
import { parseWorkbenchState } from "./workbench-persistence";

describe("workbench persistence", () => {
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
});
