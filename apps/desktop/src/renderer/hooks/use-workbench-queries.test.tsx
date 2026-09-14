import { QueryClientProvider } from "@tanstack/react-query";
import { act, render, waitFor } from "@testing-library/react";
import { Provider, createStore } from "jotai";
import { afterEach, expect, it, vi } from "vitest";
import { runtimeAtom } from "../atoms/workspace";
import { createRendererQueryClient } from "../lib/query-client";
import { palot } from "../services/palot";
import { useLocationDiffs } from "./use-location-diffs";
import { useWorkspaceFile } from "./use-workspace-file";

afterEach(() => vi.restoreAllMocks());

it("keeps hidden workbench queries idle and fetches the explicit owner when shown", async () => {
  const store = createStore();
  store.set(runtimeAtom, {
    connectionID: "remote",
    profileID: "remote-profile",
    contractVersion: "2.0.3",
    phase: "connected",
    connected: true,
    binaryPath: null,
    version: "2.0.3",
    pid: 1,
    managed: false,
    lastConnectedAt: 1,
    error: null,
    versionMismatch: null,
  });
  const client = createRendererQueryClient();
  const file = vi
    .spyOn(palot, "readWorkspaceFile")
    .mockResolvedValue({ type: "text", content: "file" } as never);
  const diffs = vi.spyOn(palot, "listDiffs").mockResolvedValue([]);
  function Probe({ active }: { active: boolean }) {
    useWorkspaceFile({ directory: "/repo" }, "file.ts", active);
    useLocationDiffs({ directory: "/repo" }, active);
    return null;
  }
  const view = (active: boolean) => (
    <QueryClientProvider client={client}>
      <Provider store={store}>
        <Probe active={active} />
      </Provider>
    </QueryClientProvider>
  );
  const result = render(view(false));
  await act(async () => {
    await client.invalidateQueries();
  });
  expect(file).not.toHaveBeenCalled();
  expect(diffs).not.toHaveBeenCalled();
  result.rerender(view(true));
  await waitFor(() => expect(file).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(diffs).toHaveBeenCalledTimes(1));
  expect(file.mock.calls[0]?.[2]).toBe("remote");
  expect(diffs.mock.calls[0]?.[2]).toBe("remote");
  result.rerender(view(false));
  await act(async () => {
    await client.invalidateQueries();
  });
  expect(file).toHaveBeenCalledTimes(1);
  expect(diffs).toHaveBeenCalledTimes(1);
  result.unmount();
  client.clear();
});
