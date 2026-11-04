import type { OpenCodeClient } from "@opencode/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OpenCodeRuntimeStatus } from "../../shared";
import {
  MAX_REMEMBERED_BRANCHES,
  rememberBranch,
  rememberedBranch,
  resetBranchMemoryForTest,
} from "../lib/branch-memory";
import { markShutdownLocationStale } from "../lib/opencode-query-events";
import { openCodeKeys } from "../lib/opencode-query";
import { createRendererQueryClient } from "../lib/query-client";
import {
  registerOpenCodeRuntime,
  resetOpenCodeClientForTest,
  setOpenCodeClientForTest,
} from "../services/opencode-client";
import { inboxBranchOwnerKey, useInboxBranches, type InboxBranchOwner } from "./use-inbox-branches";

afterEach(() => {
  resetOpenCodeClientForTest();
  resetBranchMemoryForTest();
  window.localStorage.clear();
});

function setup(loaded: string[]) {
  registerOpenCodeRuntime({ connectionID: "one", profileID: "profile" } as OpenCodeRuntimeStatus);
  const list = vi.fn(async () => loaded.map((directory) => ({ directory })));
  const get = vi.fn(async ({ location }: { location: { directory: string } }) => ({
    data: { branch: { current: `branch${location.directory}`, default: "main" } },
  }));
  setOpenCodeClientForTest({
    debug: { location: { list } },
    vcs: { get },
  } as unknown as OpenCodeClient);
  return { list, get };
}

const owner = (directory: string): InboxBranchOwner => ({
  connectionID: "one",
  location: { directory },
});

function Rows({ owners }: { owners: InboxBranchOwner[] }) {
  const branches = useInboxBranches(owners);
  return (
    <ul>
      {owners.map((row) => {
        const branch = branches.get(inboxBranchOwnerKey(row));
        return (
          <li key={row.location.directory}>
            {row.location.directory}:{branch?.vcs.currentBranch ?? "folder"}
            {branch?.lastSeen ? " (last seen)" : ""}
          </li>
        );
      })}
    </ul>
  );
}

describe("Inbox branch labels", () => {
  it("reads only loaded directories and shows the last seen branch elsewhere", async () => {
    const { get, list } = setup(["/loaded"]);
    rememberBranch("profile", "/evicted", "feature/old");
    const queryClient = createRendererQueryClient();
    const view = render(
      <QueryClientProvider client={queryClient}>
        <Rows owners={[owner("/loaded"), owner("/evicted"), owner("/unknown")]} />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(view.getByText("/loaded:branch/loaded")).toBeTruthy());
    expect(view.getByText("/evicted:feature/old (last seen)")).toBeTruthy();
    expect(view.getByText("/unknown:folder")).toBeTruthy();
    expect(list).toHaveBeenCalledOnce();
    expect(get).toHaveBeenCalledOnce();
    expect(get).toHaveBeenCalledWith(
      { location: { directory: "/loaded" } },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );

    // Connection-wide refreshes re-read the location list, never row branches.
    await act(() => queryClient.invalidateQueries({ queryKey: openCodeKeys.all("one") }));
    expect(list).toHaveBeenCalledTimes(2);
    expect(get).toHaveBeenCalledOnce();

    // Eviction keeps the label as last seen and reads nothing.
    act(() => markShutdownLocationStale(queryClient, "one", "/loaded"));
    await waitFor(() => expect(view.getByText("/loaded:branch/loaded (last seen)")).toBeTruthy());
    expect(get).toHaveBeenCalledOnce();

    // Booting it again reads the branch once more.
    act(() => {
      queryClient.setQueryData(openCodeKeys.loadedLocations("one"), ["/loaded"]);
    });
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(view.getByText("/loaded:branch/loaded")).toBeTruthy());

    // A branch event updates the label without a read.
    act(() => rememberBranch("profile", "/evicted", "feature/new"));
    expect(view.getByText("/evicted:feature/new (last seen)")).toBeTruthy();
    view.unmount();
    queryClient.clear();
  });

  it("persists a bounded set of the most recently seen branches", async () => {
    for (let index = 0; index <= MAX_REMEMBERED_BRANCHES; index += 1)
      rememberBranch("profile", `/repo-${index}`, `branch-${index}`, index + 1);
    resetBranchMemoryForTest();
    expect(rememberedBranch("profile", "/repo-0")).toBeUndefined();
    expect(rememberedBranch("profile", `/repo-${MAX_REMEMBERED_BRANCHES}`)).toEqual({
      branch: `branch-${MAX_REMEMBERED_BRANCHES}`,
      seenAt: MAX_REMEMBERED_BRANCHES + 1,
    });
    expect(rememberedBranch("other-profile", "/repo-1")).toBeUndefined();
  });
});
