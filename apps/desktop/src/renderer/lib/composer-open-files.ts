/**
 * `@` suggestions for files the person already has open in the task's workbench. The active file
 * leads, then other open files; workspace search results follow without repeating them. Only
 * tabs owned by the same connection profile and location are considered.
 */

import type { LocationRef } from "@opencode/client";
import { locationKey } from "./opencode-query";
import type { WorkbenchContextState, WorkbenchPaneState, WorkbenchTab } from "./workbench-tabs";

export const MAX_OPEN_FILE_SUGGESTIONS = 10;

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

/**
 * Open files matching the typed query come first, then search results that are not already
 * listed. Matching is a case-insensitive substring, like the server search's simplest case.
 */
export function mentionFileSuggestions(
  openFiles: readonly string[],
  searchResults: readonly string[],
  query: string,
): { path: string; open: boolean }[] {
  const needle = query.toLowerCase();
  const open = openFiles
    .filter((path) => path.toLowerCase().includes(needle))
    .slice(0, MAX_OPEN_FILE_SUGGESTIONS);
  const seen = new Set(open);
  return [
    ...open.map((path) => ({ path, open: true })),
    ...searchResults.flatMap((path) => {
      if (seen.has(path)) return [];
      seen.add(path);
      return [{ path, open: false }];
    }),
  ];
}
