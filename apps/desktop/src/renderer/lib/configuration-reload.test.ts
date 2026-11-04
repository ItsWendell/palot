import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { palot } from "../services/palot";
import { reloadOpenCodeConfiguration } from "./configuration-reload";
import { markShutdownLocationStale } from "./opencode-query-events";
import { inboxBranchKeys, openCodeKeys } from "./opencode-query";

afterEach(() => vi.restoreAllMocks());

describe("configuration reload", () => {
  it("re-reads mounted catalogs after the reload's evictions, but not Inbox row branches", async () => {
    const location = { directory: "/repo" };
    const client = new QueryClient();
    const catalog = vi.fn(async () => ({ commands: [] }));
    const branch = vi.fn(async () => ({ currentBranch: "main", defaultBranch: null }));
    const reload = vi.spyOn(palot, "reloadConfiguration").mockImplementation(async () => {
      // OpenCode retires the location; the event only marks reads stale.
      markShutdownLocationStale(client, "connection", location.directory);
    });
    const observers = [
      new QueryObserver(client, {
        queryKey: openCodeKeys.composerCatalog("connection", location),
        queryFn: catalog,
        staleTime: Infinity,
      }),
      new QueryObserver(client, {
        queryKey: inboxBranchKeys.location("connection", location),
        queryFn: branch,
        staleTime: Infinity,
      }),
    ].map((observer) => observer.subscribe(() => undefined));
    await vi.waitFor(() => expect(catalog).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(branch).toHaveBeenCalledTimes(1));

    await reloadOpenCodeConfiguration(client, "connection");

    expect(reload).toHaveBeenCalledWith("connection");
    expect(catalog).toHaveBeenCalledTimes(2);
    expect(branch).toHaveBeenCalledTimes(1);
    observers.forEach((unsubscribe) => unsubscribe());
    client.clear();
  });
});
