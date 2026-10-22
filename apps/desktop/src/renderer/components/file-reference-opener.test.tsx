import { QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createRendererQueryClient } from "../lib/query-client";
import { palot } from "../services/palot";
import { useFileReferenceOpener } from "./file-reference-opener";
import { toast } from "./ui/toast";

vi.mock("../services/opencode-resources", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/opencode-resources")>()),
  sessionFileLocation: vi.fn(async () => ({
    location: { directory: "/repo/app" },
    subpath: "app",
  })),
}));

const notFound = (path: string) => ({ _tag: "FileNotFoundError", path, message: "missing" });

let files: string[] = [];
let found: string[] = [];

beforeEach(() => {
  files = [];
  found = [];
  vi.spyOn(palot, "readWorkspaceFile").mockImplementation(async (input) => {
    if (files.includes(`${input.directory}/${input.path}`)) return new Uint8Array([1]);
    throw notFound(input.path);
  });
  vi.spyOn(palot, "findWorkspaceFiles").mockImplementation(async () =>
    found.map((path) => ({ path, type: "file" as const })),
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function mount(localPathActions = true, openHtml?: (absolutePath: string) => Promise<boolean>) {
  const openTab = vi.fn();
  function Harness() {
    const { open, picker } = useFileReferenceOpener({
      sessionID: "session",
      location: { directory: "/repo/app" },
      connectionID: "connection",
      localPathActions,
      getMessages: () => [],
      openTab,
      ...(openHtml ? { openHtml } : {}),
    });
    return (
      <>
        {picker}
        <button
          type="button"
          onClick={(event) => open({ path: "index.ts", line: 4, endLine: 6 }, event)}
        >
          index.ts
        </button>
        <button type="button" onClick={(event) => open({ path: "lib/util.ts" }, event)}>
          util.ts
        </button>
        <button type="button" onClick={(event) => open({ path: "out/report.html" }, event)}>
          report.html
        </button>
      </>
    );
  }
  const view = render(
    <QueryClientProvider client={createRendererQueryClient()}>
      <Harness />
    </QueryClientProvider>,
  );
  return { openTab, unmount: view.unmount };
}

it("opens a repo-root file from a subdirectory task", async () => {
  files = ["/repo/lib/util.ts"];
  const { openTab } = mount();
  fireEvent.click(screen.getByRole("button", { name: "util.ts" }));
  await waitFor(() =>
    expect(openTab).toHaveBeenCalledWith({
      kind: "file",
      location: { directory: "/repo" },
      path: "lib/util.ts",
    }),
  );
});

it("shows HTML rendered when the browser loads it, and as a file tab otherwise", async () => {
  files = ["/repo/app/out/report.html"];
  const openHtml = vi.fn<(absolutePath: string) => Promise<boolean>>().mockResolvedValue(true);
  const { openTab } = mount(true, openHtml);
  fireEvent.click(screen.getByRole("button", { name: "report.html" }));
  await waitFor(() => expect(openHtml).toHaveBeenCalledWith("/repo/app/out/report.html"));
  expect(openTab).not.toHaveBeenCalled();

  openHtml.mockResolvedValue(false);
  fireEvent.click(screen.getByRole("button", { name: "report.html" }));
  await waitFor(() =>
    expect(openTab).toHaveBeenCalledWith({
      kind: "file",
      location: { directory: "/repo/app" },
      path: "out/report.html",
    }),
  );
});

it("asks which file to open when several match", async () => {
  files = ["/repo/app/src/index.ts", "/repo/app/test/index.ts"];
  found = ["app/src/index.ts", "app/test/index.ts", "app/src/index.tsx"];
  const { openTab } = mount();
  fireEvent.click(screen.getByRole("button", { name: "index.ts" }));

  const choice = await screen.findByRole("menuitem", { name: "app/test/index.ts" });
  expect(screen.getAllByRole("menuitem")).toHaveLength(2);
  fireEvent.click(choice);
  await waitFor(() =>
    expect(openTab).toHaveBeenCalledWith({
      kind: "file",
      location: { directory: "/repo/app" },
      path: "test/index.ts",
      line: 4,
      endLine: 6,
    }),
  );
});

it("reports a missing file without opening a tab", async () => {
  const add = vi.spyOn(toast, "add");
  const external = vi.spyOn(palot, "externalOpen").mockResolvedValue({ openedTargetID: "finder" });
  const { openTab } = mount();
  fireEvent.click(screen.getByRole("button", { name: "util.ts" }));

  await waitFor(() => expect(add).toHaveBeenCalled());
  const options = add.mock.calls[0]![0] as {
    title: string;
    actionProps?: { onClick(): void };
  };
  expect(options.title).toBe("File not found");
  expect(openTab).not.toHaveBeenCalled();
  options.actionProps!.onClick();
  expect(external).toHaveBeenCalledWith(
    { resource: { kind: "file", path: "/repo/app/lib/util.ts", sessionID: "session" } },
    "connection",
  );
});

it("offers no external action on a remote server", async () => {
  const add = vi.spyOn(toast, "add");
  mount(false);
  fireEvent.click(screen.getByRole("button", { name: "util.ts" }));
  await waitFor(() => expect(add).toHaveBeenCalled());
  expect(add.mock.calls[0]![0]).not.toHaveProperty("actionProps");
});

it("drops a slower click when another file is opened", async () => {
  files = ["/repo/app/lib/util.ts"];
  let release: () => void = () => {};
  vi.mocked(palot.readWorkspaceFile).mockImplementation(async (input) => {
    if (input.path === "index.ts") {
      await new Promise<void>((resolve) => (release = resolve));
      return new Uint8Array([1]);
    }
    if (files.includes(`${input.directory}/${input.path}`)) return new Uint8Array([1]);
    throw notFound(input.path);
  });
  const { openTab } = mount();
  fireEvent.click(screen.getByRole("button", { name: "index.ts" }));
  fireEvent.click(screen.getByRole("button", { name: "util.ts" }));
  await waitFor(() => expect(openTab).toHaveBeenCalledTimes(1));
  release();
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(openTab).toHaveBeenCalledTimes(1);
  expect(openTab).toHaveBeenCalledWith(expect.objectContaining({ path: "lib/util.ts" }));
});

/** Makes the picker's re-read of `test/index.ts` wait until released. */
function holdPickerRead() {
  let release: () => void = () => {};
  const read = vi.mocked(palot.readWorkspaceFile).getMockImplementation()!;
  vi.mocked(palot.readWorkspaceFile).mockImplementation(async (input, ...rest) => {
    if (input.path === "test/index.ts") {
      await new Promise<void>((resolve) => (release = resolve));
    }
    return read(input, ...rest);
  });
  return () => release();
}

async function choosePickerEntry() {
  fireEvent.click(screen.getByRole("button", { name: "index.ts" }));
  fireEvent.click(await screen.findByRole("menuitem", { name: "app/test/index.ts" }));
}

it("drops a picker choice when another file is opened first", async () => {
  files = ["/repo/app/src/index.ts", "/repo/app/test/index.ts", "/repo/app/lib/util.ts"];
  found = ["app/src/index.ts", "app/test/index.ts"];
  const release = holdPickerRead();
  const { openTab } = mount();
  await choosePickerEntry();
  fireEvent.click(screen.getByRole("button", { name: "util.ts" }));
  await waitFor(() => expect(openTab).toHaveBeenCalledTimes(1));
  release();
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(openTab).toHaveBeenCalledTimes(1);
  expect(openTab).toHaveBeenCalledWith(expect.objectContaining({ path: "lib/util.ts" }));
});

it("drops a picker choice when the task view goes away", async () => {
  files = ["/repo/app/src/index.ts", "/repo/app/test/index.ts"];
  found = ["app/src/index.ts", "app/test/index.ts"];
  const release = holdPickerRead();
  const { openTab, unmount } = mount();
  await choosePickerEntry();
  await waitFor(() =>
    expect(palot.readWorkspaceFile).toHaveBeenCalledWith(
      expect.objectContaining({ path: "test/index.ts" }),
      expect.anything(),
      "connection",
    ),
  );
  unmount();
  release();
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(openTab).not.toHaveBeenCalled();
});
