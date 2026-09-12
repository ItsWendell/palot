import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runtimeAtom } from "../../atoms/workspace";
import type { WorkbenchTab } from "../../lib/workbench-tabs";
import { CommandTab } from "./command-tab";

const mocks = vi.hoisted(() => ({ get: vi.fn(), output: vi.fn(), copy: vi.fn() }));
vi.mock("../../services/opencode-client", () => ({ openCodeClient: () => ({ shell: mocks }) }));
vi.mock("../../hooks/use-clipboard-copy", () => ({
  useClipboardCopy: () => ({ copy: mocks.copy, copiedKey: null }),
}));

const tab: Extract<WorkbenchTab, { kind: "command" }> = {
  id: "command-1",
  kind: "command",
  pinned: true,
  resource: {
    profileID: "profile-1",
    location: { directory: "/repo", workspaceID: "workspace-1" },
    shellID: "shell-1",
    sessionID: "session-1",
    command: "build",
  },
};
const runtime = {
  connectionID: "connection-1",
  profileID: "profile-1",
  contractVersion: "0.0.0-beta-19425",
  phase: "connected" as const,
  connected: true,
  binaryPath: null,
  version: "0.0.0-beta-19425",
  pid: 1,
  managed: false,
  lastConnectedAt: 1,
  error: null,
  versionMismatch: null,
};
const shell = (status = "exited") => ({
  data: {
    command: "build",
    cwd: "/repo/subdir",
    status,
    exit: status === "exited" ? 0 : undefined,
  },
});
const page = (output: string, cursor: number, size = cursor) => ({
  data: { output, cursor, size, truncated: cursor < size },
});
function mount() {
  const store = createStore();
  store.set(runtimeAtom, runtime);
  const view = render(
    <Provider store={store}>
      <CommandTab tab={tab} />
    </Provider>,
  );
  return { store, ...view };
}
async function settle(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetAllMocks();
  mocks.get.mockResolvedValue(shell());
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("CommandTab", () => {
  it("formats ANSI split across output pages and copies clean text", async () => {
    const first = "\u001b[1;3";
    const second = "mformatted\u001b[0m\n";
    const firstCursor = new TextEncoder().encode(first).length;
    const finalCursor = new TextEncoder().encode(first + second).length;
    mocks.get.mockResolvedValueOnce(shell("running")).mockResolvedValueOnce(shell());
    mocks.output
      .mockResolvedValueOnce(page(first, firstCursor))
      .mockResolvedValueOnce(page(second, finalCursor));
    mount();
    await settle();
    expect(screen.queryByText(/\[1;3/)).toBeNull();
    await settle(1_000);
    const formatted = screen.getByText("formatted");
    expect(formatted.style.fontWeight).toBe("700");
    expect(formatted.style.fontStyle).toBe("italic");
    expect(mocks.output.mock.calls[1]?.[0].cursor).toBe(firstCursor);
    fireEvent.click(screen.getByRole("button", { name: "Copy visible output" }));
    expect(mocks.copy).toHaveBeenCalledWith("formatted\n");
  });

  it("drains final output using server byte cursors, then stops polling", async () => {
    mocks.output.mockResolvedValueOnce(page("é", 2, 7)).mockResolvedValueOnce(page(" done", 7));
    mount();
    await settle();
    expect(screen.getByText("é")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("Loading output");
    await settle(50);
    expect(screen.getByText("é done")).toBeTruthy();
    expect(mocks.output.mock.calls[1]?.[0]).toEqual({
      id: "shell-1",
      location: { directory: "/repo", workspace: "workspace-1" },
      cursor: 2,
      limit: 65536,
    });
    expect(screen.getByRole("status").textContent).toBe("exited · Exit 0");
    expect(screen.getByText("/repo/subdir")).toBeTruthy();
    await settle(10_000);
    expect(mocks.output).toHaveBeenCalledTimes(2);
  });

  it("retains logs on failure and retries from the last successful cursor", async () => {
    mocks.get.mockResolvedValue(shell("running"));
    mocks.output
      .mockResolvedValueOnce(page("first", 5))
      .mockRejectedValueOnce(new Error("Offline"))
      .mockResolvedValueOnce(page(" second", 12));
    mount();
    await settle(1_000);
    expect(screen.getByRole("alert").textContent).toContain("Offline");
    expect(screen.getByText("first")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await settle();
    expect(screen.getByText("first second")).toBeTruthy();
    expect(mocks.output.mock.calls[2]?.[0].cursor).toBe(5);
  });

  it("aborts and hides old output on profile changes, ignoring late replies", async () => {
    let resolve!: (value: ReturnType<typeof page>) => void;
    mocks.output.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const { store } = mount();
    await settle();
    const signal = mocks.output.mock.calls[0]?.[1].signal as AbortSignal;
    act(() => store.set(runtimeAtom, { ...runtime, profileID: "profile-2" }));
    expect(signal.aborted).toBe(true);
    await act(async () => resolve(page("private old output", 18)));
    expect(screen.queryByText("private old output")).toBeNull();
    await settle(5_000);
    expect(mocks.output).toHaveBeenCalledTimes(1);
  });

  it("replaces output on session changes and aborts when inactive without killing the command", async () => {
    mocks.output.mockResolvedValue(page("old output", 10));
    const { store, rerender } = mount();
    await settle();
    mocks.output.mockResolvedValue(page("new output", 10));
    rerender(
      <Provider store={store}>
        <CommandTab tab={{ ...tab, resource: { ...tab.resource, sessionID: "session-2" } }} />
      </Provider>,
    );
    expect(screen.queryByText("old output")).toBeNull();
    await settle();
    expect(screen.getByText("new output")).toBeTruthy();
    const signal = mocks.output.mock.calls[1]?.[1].signal as AbortSignal;
    rerender(
      <Provider store={store}>
        <CommandTab tab={tab} active={false} />
      </Provider>,
    );
    expect(signal.aborted).toBe(true);
    await settle(5_000);
    expect(mocks.get).toHaveBeenCalledTimes(2);
  });

  it("bounds retained output, copies that buffer, and lets readers pause following", async () => {
    mocks.output.mockResolvedValueOnce(page("older" + "x".repeat(65531), 65536, 262150));
    for (let index = 2; index <= 4; index++)
      mocks.output.mockResolvedValueOnce(page("x".repeat(65536), index * 65536, 262150));
    mocks.output.mockResolvedValueOnce(page("latest", 262150));
    mount();
    await settle(200);
    expect(screen.getByText(/Showing the latest output only/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Copy visible output" }));
    const copied = mocks.copy.mock.calls[0]?.[0] as string;
    expect(copied.length).toBe(262144);
    expect(copied).not.toContain("older");
    expect(copied.endsWith("latest")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Pause following output" }));
    expect(screen.getByRole("button", { name: "Follow output" })).toBeTruthy();
  });
});
