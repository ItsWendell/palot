import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runtimeAtom } from "../../atoms/workspace";
import type { WorkbenchTab } from "../../lib/workbench-tabs";
import { CommandActions } from "./command-actions";
import { CommandTab } from "./command-tab";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  output: vi.fn(),
  remove: vi.fn(),
}));
vi.mock("../../services/opencode-client", () => ({ openCodeClient: () => ({ shell: mocks }) }));
vi.mock("../../hooks/use-clipboard-copy", () => ({
  useClipboardCopy: () => ({ copy: vi.fn(), copiedKey: null }),
}));
const resource = {
  profileID: "profile",
  shellID: "shell",
  sessionID: "session",
  command: "build",
  location: { directory: "/repo", workspaceID: "workspace" },
};
const runtime = { profileID: "profile", connectionID: "connection", connected: true };
function mount(full = false) {
  const store = createStore();
  store.set(runtimeAtom, runtime as never);
  const onRemoved = vi.fn();
  const tab: Extract<WorkbenchTab, { kind: "command" }> = {
    id: "tab",
    kind: "command",
    pinned: true,
    resource,
  };
  const view = render(
    <Provider store={store}>
      {full ? (
        <CommandTab tab={tab} />
      ) : (
        <CommandActions resource={resource} connectionID="connection" onRemoved={onRemoved} />
      )}
    </Provider>,
  );
  return { store, onRemoved, tab, ...view };
}
async function choose(name: string) {
  fireEvent.click(screen.getByRole("button", { name: "Command actions" }));
  fireEvent.click(await screen.findByRole("menuitem", { name }));
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.remove.mockResolvedValue(undefined);
  mocks.get.mockResolvedValue({ data: { command: "build", cwd: "/repo", status: "running" } });
  mocks.output.mockResolvedValue({ data: { output: "loaded output", cursor: 13, size: 13 } });
  vi.stubGlobal("confirm", vi.fn().mockReturnValue(true));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("CommandActions", () => {
  it.each([{ connected: false }, { profileID: "other" }, { connectionID: "other" }])(
    "disables actions for an unavailable or different server: %j",
    (change) => {
      const { store } = mount();
      act(() => store.set(runtimeAtom, { ...runtime, ...change } as never));
      const button = screen.getByRole("button", { name: "Command actions" });
      expect(button.hasAttribute("disabled")).toBe(true);
      fireEvent.click(button);
      expect(screen.queryByRole("menuitem")).toBeNull();
      expect(mocks.remove).not.toHaveBeenCalled();
    },
  );

  it("warns that removal kills and deletes output, and cancellation makes no request", async () => {
    vi.mocked(window.confirm).mockReturnValue(false);
    const { onRemoved } = mount();
    await choose("Stop and remove command");
    expect(window.confirm).toHaveBeenCalledWith(
      expect.stringContaining("permanently deletes its stored output"),
    );
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(onRemoved).not.toHaveBeenCalled();
  });

  it("keeps failed actions usable and maps confirmed removal", async () => {
    mocks.remove.mockRejectedValueOnce(new Error("Cannot remove right now"));
    const { onRemoved } = mount();
    await choose("Stop and remove command");
    expect((await screen.findByRole("alert")).textContent).toContain("Cannot remove right now");
    expect(onRemoved).not.toHaveBeenCalled();
    await choose("Stop and remove command");
    await waitFor(() => expect(onRemoved).toHaveBeenCalledOnce());
    expect(mocks.remove).toHaveBeenLastCalledWith(
      { id: "shell", location: { directory: "/repo" } },
      { signal: expect.any(AbortSignal) },
    );
  });

  it("aborts an action on connection changes and ignores its late success", async () => {
    let finish!: () => void;
    mocks.remove.mockReturnValue(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    const { store, onRemoved } = mount();
    await choose("Stop and remove command");
    const signal = mocks.remove.mock.calls[0]?.[1].signal as AbortSignal;
    act(() => store.set(runtimeAtom, { ...runtime, connectionID: "other" } as never));
    expect(signal.aborted).toBe(true);
    await act(async () => finish());
    expect(onRemoved).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Command actions" }).hasAttribute("disabled")).toBe(
      true,
    );
  });

  it("keeps loaded output after removal, aborts pending reads, and never polls again", async () => {
    let finish!: (value: unknown) => void;
    mocks.output
      .mockResolvedValueOnce({ data: { output: "loaded output", cursor: 13, size: 13 } })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
    const view = mount(true);
    await screen.findByText("loaded output");
    await waitFor(() => expect(mocks.output).toHaveBeenCalledTimes(2), { timeout: 2000 });
    const signal = mocks.output.mock.calls[1]?.[1].signal as AbortSignal;
    await choose("Stop and remove command");
    await screen.findByText("Command removed. Only the output already loaded here remains.");
    expect(signal.aborted).toBe(true);
    await act(async () => finish({ data: { output: "late output", cursor: 24, size: 24 } }));
    expect(screen.queryByText(/late output/)).toBeNull();
    expect(screen.getByText("loaded output")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Command actions" })).toBeNull();
    view.rerender(
      <Provider store={view.store}>
        <CommandTab tab={view.tab} active={false} />
      </Provider>,
    );
    view.rerender(
      <Provider store={view.store}>
        <CommandTab tab={view.tab} active />
      </Provider>,
    );
    expect(screen.getByText("loaded output")).toBeTruthy();
    expect(
      screen.getByText("Command removed. Only the output already loaded here remains."),
    ).toBeTruthy();
    vi.useFakeTimers();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(mocks.output).toHaveBeenCalledTimes(2);
    expect(mocks.get).toHaveBeenCalledTimes(2);
  });
});
