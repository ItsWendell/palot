import { expect, it } from "vitest";
import { parseWorkbenchRecoveryState } from "./workbench-recovery-persistence";
import {
  createWorkbenchState,
  mutateWorkbench,
  openWorkbenchTab,
  workbenchScopeKey,
} from "./workbench-tabs";

it("round-trips recoverable history and repairs corrupt or cross-owner descriptors", () => {
  const scope = { profileID: "profile", sessionID: "task" };
  const key = workbenchScopeKey(scope);
  const opened = openWorkbenchTab(
    createWorkbenchState(),
    scope,
    { kind: "context", location: { directory: "/repo" } },
    { pane: "bottom" },
    1,
    () => "context",
  );
  const closed = mutateWorkbench(
    opened.state,
    scope,
    { type: "close", pane: "bottom", tabID: "context" },
    2,
  );
  expect(parseWorkbenchRecoveryState(JSON.parse(JSON.stringify(closed)))).toEqual(closed);
  const entry = closed.scopes[key]!.recentlyClosed![0]!;
  const corrupted = JSON.parse(JSON.stringify(closed));
  corrupted.scopes[key].recentlyClosed = [
    { ...entry, index: -1 },
    {
      ...entry,
      tab: { ...entry.tab, resource: { ...entry.tab.resource, profileID: "foreign-profile" } },
    },
    {
      ...entry,
      tab: { ...entry.tab, resource: { ...entry.tab.resource, sessionID: "foreign-task" } },
    },
    {
      ...entry,
      tab: {
        id: "browser",
        kind: "browser",
        pinned: false,
        resource: { ...scope, location: { directory: "/repo" }, browserTabID: "deleted" },
      },
    },
    entry,
    { ...entry, tab: { ...entry.tab, id: "duplicate" } },
    { tab: { kind: "unknown" }, closedAt: 1, index: 0, pane: "right" },
  ];
  expect(parseWorkbenchRecoveryState(corrupted).scopes[key]?.recentlyClosed).toEqual([entry]);
});
