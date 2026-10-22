import { QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Provider, createStore } from "jotai";
import { afterEach, expect, it, vi } from "vitest";
import { runtimeAtom } from "../../atoms/workspace";
import { createRendererQueryClient } from "../../lib/query-client";
import type { WorkbenchTab } from "../../lib/workbench-tabs";
import { palot } from "../../services/palot";
import { FileTab } from "./file-tab";

const openTab = vi.fn();

vi.mock("../../atoms/workspace", async () => ({ runtimeAtom: (await import("jotai")).atom(null) }));
vi.mock("../../atoms/workbench", () => ({ useWorkbenchCommands: () => ({ openTab }) }));
vi.mock("../../services/opencode-resources", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../services/opencode-resources")>()),
  sessionFileLocation: vi.fn(async () => ({ location: { directory: "/repo" }, subpath: "" })),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  openTab.mockReset();
});

it("resolves links in a previewed document against the document's folder", async () => {
  const files: Record<string, string> = {
    "docs/guide/README.md": "See [other](../other.md).",
    "docs/other.md": "# Other",
  };
  vi.spyOn(palot, "readWorkspaceFile").mockImplementation(async (input) => {
    const text = files[input.path];
    if (text === undefined) throw { _tag: "FileNotFoundError", path: input.path, message: "" };
    return new TextEncoder().encode(text);
  });
  const store = createStore();
  store.set(runtimeAtom, {
    connectionID: "connection",
    profileID: "profile",
    contractVersion: "2.0.31",
    phase: "connected",
    connected: true,
    binaryPath: null,
    version: "2.0.31",
    pid: 1,
    managed: false,
    lastConnectedAt: 1,
    error: null,
    versionMismatch: null,
  });
  const tab: Extract<WorkbenchTab, { kind: "file" }> = {
    id: "doc",
    kind: "file",
    pinned: false,
    resource: {
      profileID: "profile",
      location: { directory: "/repo" },
      path: "docs/guide/README.md",
    },
  };
  render(
    <QueryClientProvider client={createRendererQueryClient()}>
      <Provider store={store}>
        <FileTab tab={tab} scope={{ profileID: "profile", sessionID: "session" }} pane="right" />
      </Provider>
    </QueryClientProvider>,
  );

  const link = await screen.findByRole("link", { name: "Open ../other.md" });
  expect(link.getAttribute("href")).toBe("file:///repo/docs/other.md");
  fireEvent.click(link);
  await waitFor(() =>
    expect(openTab).toHaveBeenCalledWith(
      { kind: "file", location: { directory: "/repo" }, path: "docs/other.md" },
      { pane: "right" },
    ),
  );
});
