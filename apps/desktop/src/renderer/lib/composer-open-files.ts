/**
 * Files the person already has open in the task's workbench, for `@`: the active file leads,
 * then other open files. Only tabs owned by the same connection profile and location count.
 */

import type { LocationRef } from "@opencode/client";
import { locationKey } from "./opencode-query";
import type { WorkbenchContextState, WorkbenchPaneState, WorkbenchTab } from "./workbench-tabs";

type FileTab = Extract<WorkbenchTab, { kind: "file" }>;

function ownedFile(tab: WorkbenchTab | undefined, profileID: string, location: string) {
  return tab?.kind === "file" &&
    tab.resource.profileID === profileID &&
    locationKey(tab.resource.location) === location &&
    tab.resource.path.length > 0
    ? (tab as FileTab)
    : null;
}

function activeTab(pane: WorkbenchPaneState): WorkbenchTab | undefined {
  return pane.tabs.find((tab) => tab.id === pane.activeTabID);
}

/** Open workbench file paths for one profile and location, active file first. */
export function openWorkbenchFiles(
  context: WorkbenchContextState,
  profileID: string | null | undefined,
  location: LocationRef,
): string[] {
  if (!profileID) return [];
  const key = locationKey(location);
  const panes = [context.right, context.bottom];
  // A visible pane's active tab is what the person is looking at; a hidden pane's is a fallback.
  const active =
    panes
      .filter((pane) => pane.requestedOpen)
      .map((pane) => ownedFile(activeTab(pane), profileID, key))
      .find(Boolean) ??
    panes.map((pane) => ownedFile(activeTab(pane), profileID, key)).find(Boolean) ??
    null;
  const paths = panes.flatMap((pane) =>
    pane.tabs.flatMap((tab) => {
      const file = ownedFile(tab, profileID, key);
      return file ? [file.resource.path] : [];
    }),
  );
  return [...new Set(active ? [active.resource.path, ...paths] : paths)];
}
