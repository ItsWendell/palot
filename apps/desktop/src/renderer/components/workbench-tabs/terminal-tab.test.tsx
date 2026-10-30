import { createStore, Provider } from "jotai";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { runtimeAtom, selectedSessionIDAtom } from "../../atoms/workspace";
import { composerDraftAtomFamily } from "../../atoms/ui";
import { composerScope } from "../../lib/composer-scope";
import { terminalQuote } from "./terminal-quote";
import { terminalPasteAtom } from "../../atoms/terminal-paste";
import { resetShortcutBindings, setShortcutBinding } from "../../lib/keyboard-shortcuts";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PalotEventBatch } from "../../../shared";
import type { WorkbenchTab } from "../../lib/workbench-tabs";
import { palot } from "../../services/palot";
import * as workbenchTerminal from "../../services/workbench-terminal";
import { TerminalTab } from "./terminal-tab";

const ghostty = vi.hoisted(() => ({
  data: null as ((data: string) => void) | null,
  resize: null as ((size: { cols: number; rows: number }) => void) | null,
  writes: [] as string[],
  disposed: 0,
  selection: "",
  selectionChange: null as (() => void) | null,
  bracketedPaste: false,
  pasteChecks: 0,
  pastes: [] as string[],
}));

vi.mock("../../atoms/workspace", async () => ({
  runtimeAtom: (await import("jotai")).atom(null),
  selectedSessionIDAtom: (await import("jotai")).atom(null),
}));

vi.mock("../../lib/font-loading", () => ({
  prepareCodeFont: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("ghostty-web", () => ({
  Ghostty: { load: vi.fn().mockResolvedValue({}) },
  Terminal: class {
    cols = 80;
    rows = 24;
    loadAddon() {}
    open() {}
    focus() {}
    hasBracketedPaste() {
      ghostty.pasteChecks += 1;
      return ghostty.bracketedPaste;
    }
    paste(data: string) {
      ghostty.pastes.push(data);
    }
    setOption() {}
    write(data: string) {
      ghostty.writes.push(data);
    }
    onData(callback: (data: string) => void) {
      ghostty.data = callback;
      return { dispose() {} };
    }
    onResize(callback: (size: { cols: number; rows: number }) => void) {
      ghostty.resize = callback;
      return { dispose() {} };
    }
    onSelectionChange(callback: () => void) {
      ghostty.selectionChange = callback;
      return {
        dispose() {
          ghostty.selectionChange = null;
        },
      };
    }
    getSelection() {
      return ghostty.selection;
    }
    clearSelection() {
      ghostty.selection = "";
      ghostty.selectionChange?.();
    }
    dispose() {
      ghostty.disposed += 1;
    }
  },
  FitAddon: class {
    fit() {}
    observeResize() {}
    dispose() {}
  },
}));

const tab: Extract<WorkbenchTab, { kind: "terminal" }> = {
  id: "terminal-tab",
  kind: "terminal",
  pinned: false,
  resource: {
    profileID: "profile-1",
    location: { directory: "/repo" },
    ptyID: "pty-1",
    sessionID: "session-1",
    transport: "persistent",
  },
};

afterEach(() => {
  cleanup();
  ghostty.data = null;
  ghostty.resize = null;
  ghostty.writes.length = 0;
  ghostty.disposed = 0;
  ghostty.selection = "";
  ghostty.selectionChange = null;
  ghostty.bracketedPaste = false;
  ghostty.pasteChecks = 0;
  ghostty.pastes.length = 0;
  resetShortcutBindings();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("TerminalTab", () => {
  it("waits for safe shell paste, consumes exactly once, and never adds Enter", async () => {
    const store = createStore();
    store.set(runtimeAtom, {
      connected: true,
      profileID: "profile-1",
      connectionID: "paste-owner",
    } as never);
    store.set(terminalPasteAtom, new Map([[tab.id, "echo first\necho second\n"]]));
    vi.spyOn(palot, "resizePty").mockResolvedValue();
    vi.spyOn(workbenchTerminal, "recoverWorkbenchTerminal").mockImplementation(
      (_resource, _connection, options) => {
        options.onStatus("connected");
        return { connectionID: () => "paste-socket", reconnect() {}, exit() {}, stop() {} };
      },
    );
    const view = render(
      <Provider store={store}>
        <TerminalTab tab={{ ...tab, resource: { ...tab.resource, transport: "legacy" } }} />
      </Provider>,
    );
    await waitFor(() =>
      expect(view.getByText("Waiting for safe shell paste support…")).toBeTruthy(),
    );
    await waitFor(() => expect(ghostty.selectionChange).not.toBeNull());
    await waitFor(() => expect(ghostty.pasteChecks).toBeGreaterThan(0));
    expect(ghostty.pastes).toEqual([]);
    ghostty.bracketedPaste = true;
    await waitFor(() => expect(ghostty.pastes).toEqual(["echo first\necho second"]));
    expect(store.get(terminalPasteAtom).has(tab.id)).toBe(false);
    expect(ghostty.pastes).toHaveLength(1);
  });
  it("quotes from the terminal shortcut before shell input and follows effective bindings", async () => {
    const store = createStore();
    store.set(runtimeAtom, {
      profileID: "profile-1",
      connectionID: "owner",
      connected: false,
    } as never);
    store.set(selectedSessionIDAtom, "shortcut-task");
    const view = render(
      <Provider store={store}>
        <TerminalTab tab={{ ...tab, resource: { ...tab.resource, ptyID: "quote-shortcut" } }} />
      </Provider>,
    );
    await waitFor(() => expect(ghostty.selectionChange).not.toBeNull());
    const terminal = view.container.querySelector<HTMLElement>("[data-workbench-terminal]")!;
    const shortcut = () =>
      new KeyboardEvent("keydown", {
        key: "L",
        code: "KeyL",
        ctrlKey: true,
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      });
    const empty = shortcut();
    fireEvent(terminal, empty);
    expect(empty.defaultPrevented).toBe(false);
    act(() => {
      ghostty.selection = "from keyboard";
      ghostty.selectionChange?.();
    });
    const selected = shortcut();
    fireEvent(terminal, selected);
    expect(selected.defaultPrevented).toBe(true);
    const draft = composerDraftAtomFamily(composerScope("profile-1", "session:shortcut-task"));
    expect(store.get(draft).text).toBe(terminalQuote("from keyboard"));
    act(() => {
      setShortcutBinding("terminal.quote", ["Mod", "Shift", "J"]);
      ghostty.selection = "after rebind";
      ghostty.selectionChange?.();
    });
    const old = shortcut();
    fireEvent(terminal, old);
    expect(old.defaultPrevented).toBe(false);
    expect(
      view.getByRole("button", { name: "Quote in composer" }).getAttribute("aria-keyshortcuts"),
    ).toBe("Control+Shift+J");
    const rebound = new KeyboardEvent("keydown", {
      key: "J",
      code: "KeyJ",
      ctrlKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    fireEvent(terminal, rebound);
    expect(rebound.defaultPrevented).toBe(true);
    expect(store.get(draft).text).toBe(
      `${terminalQuote("from keyboard")}${terminalQuote("after rebind")}`,
    );
  });

  it("offers selected output as a quote in the active task, not the terminal's originating task", async () => {
    const store = createStore();
    store.set(runtimeAtom, {
      profileID: "profile-1",
      connectionID: "owner",
      connected: false,
    } as never);
    store.set(selectedSessionIDAtom, "active-task");
    const view = render(
      <Provider store={store}>
        <TerminalTab tab={{ ...tab, resource: { ...tab.resource, ptyID: "quote-selection" } }} />
      </Provider>,
    );
    await waitFor(() => expect(ghostty.selectionChange).not.toBeNull());
    expect(view.queryByRole("button", { name: "Quote in composer" })).toBeNull();
    act(() => {
      ghostty.selection = "  command failed\nexit 1";
      ghostty.selectionChange?.();
    });
    fireEvent.click(view.getByRole("button", { name: "Quote in composer" }));
    expect(
      store.get(composerDraftAtomFamily(composerScope("profile-1", "session:active-task"))).text,
    ).toBe(terminalQuote("  command failed\nexit 1"));
    expect(
      store.get(composerDraftAtomFamily(composerScope("profile-1", "session:session-1"))).text,
    ).toBe("");
    expect(ghostty.selection).toBe("");
    expect(view.queryByRole("button", { name: "Quote in composer" })).toBeNull();
    act(() => {
      ghostty.selection = "other output";
      ghostty.selectionChange?.();
      store.set(runtimeAtom, {
        profileID: "other-profile",
        connectionID: "other",
        connected: false,
      } as never);
    });
    expect(view.queryByRole("button", { name: "Quote in composer" })).toBeNull();
    view.unmount();
    expect(ghostty.selectionChange).toBeNull();
  });

  it.each([
    ["replacement", "success"],
    ["replacement", "failure"],
    ["disconnect-and-return", "success"],
    ["disconnect-and-return", "failure"],
    ["unmount", "success"],
    ["unmount", "failure"],
    ["same-owner", "success"],
    ["same-owner", "failure"],
  ] as const)(
    "scopes pending End terminal %s/%s to its originating controller",
    async (transition, outcome) => {
      const store = createStore();
      const owner = { connected: true, profileID: "profile-1", connectionID: "owner" };
      store.set(runtimeAtom, owner as never);
      const events: Array<Parameters<typeof palot.onPtyEvent>[0]> = [];
      const controllers: Array<ReturnType<typeof workbenchTerminal.recoverWorkbenchTerminal>> = [];
      const recover = workbenchTerminal.recoverWorkbenchTerminal;
      vi.spyOn(workbenchTerminal, "recoverWorkbenchTerminal").mockImplementation((...args) => {
        const controller = recover(...args);
        vi.spyOn(controller, "exit");
        controllers.push(controller);
        return controller;
      });
      vi.spyOn(palot, "connectPty")
        .mockResolvedValueOnce("owner-socket")
        .mockResolvedValueOnce("replacement-socket");
      vi.spyOn(palot, "startPty").mockResolvedValue();
      vi.spyOn(palot, "resizePty").mockResolvedValue();
      vi.spyOn(palot, "onPtyEvent").mockImplementation((listener) => {
        events.push(listener);
        return () => {};
      });
      const detach = vi.spyOn(palot, "disconnectPty").mockResolvedValue();
      const removals: Array<{ resolve(): void; reject(error: Error): void }> = [];
      const remove = vi.spyOn(palot, "removePty").mockImplementation(
        () =>
          new Promise<void>((resolve, reject) => {
            removals.push({ resolve, reject });
          }),
      );
      vi.stubGlobal("confirm", vi.fn().mockReturnValue(true));
      const descriptor = {
        ...tab,
        resource: {
          ...tab.resource,
          ptyID: `end-${transition}-${outcome}`,
          transport: "legacy" as const,
        },
      };
      const view = render(
        <Provider store={store}>
          <TerminalTab tab={descriptor} />
        </Provider>,
      );
      await waitFor(() => expect(palot.startPty).toHaveBeenCalledWith("owner-socket"));
      act(() => events[0]!({ connectionID: "owner-socket", type: "open" }));
      fireEvent.click(view.getByRole("button", { name: "End terminal" }));
      expect(remove).toHaveBeenCalledWith(
        descriptor.resource.location,
        descriptor.resource.ptyID,
        "legacy",
        "owner",
      );
      expect(view.getByRole("button", { name: "End terminal" }).hasAttribute("disabled")).toBe(
        true,
      );
      if (transition === "unmount") {
        view.unmount();
      } else if (transition !== "same-owner") {
        if (transition === "disconnect-and-return") {
          act(() => store.set(runtimeAtom, { ...owner, connected: false } as never));
        }
        act(() =>
          store.set(runtimeAtom, {
            ...owner,
            connectionID: transition === "replacement" ? "replacement" : "owner",
          } as never),
        );
        await waitFor(() => expect(palot.startPty).toHaveBeenCalledWith("replacement-socket"));
        act(() => events[1]!({ connectionID: "replacement-socket", type: "open" }));
        expect(view.getByRole("button", { name: "End terminal" }).hasAttribute("disabled")).toBe(
          false,
        );
        // An old finally callback must not clear this replacement's pending action either.
        fireEvent.click(view.getByRole("button", { name: "End terminal" }));
      }
      await act(async () => {
        if (outcome === "success") removals[0]!.resolve();
        else removals[0]!.reject(new Error("Old-owner removal failed"));
      });
      if (transition === "same-owner") {
        if (outcome === "success") {
          expect(controllers[0]!.exit).toHaveBeenCalledOnce();
          expect(view.getByText("exited")).toBeTruthy();
        } else {
          expect(controllers[0]!.exit).not.toHaveBeenCalled();
          expect(view.getByRole("button", { name: "Reconnect terminal" })).toBeTruthy();
          expect(view.getByRole("button", { name: "End terminal" }).hasAttribute("disabled")).toBe(
            false,
          );
        }
      } else {
        for (const controller of controllers) expect(controller.exit).not.toHaveBeenCalled();
        if (transition !== "unmount") {
          expect(detach).not.toHaveBeenCalledWith("replacement-socket");
          expect(view.queryByRole("button", { name: "Reconnect terminal" })).toBeNull();
          expect(view.queryByText("exited")).toBeNull();
          expect(view.getByRole("button", { name: "End terminal" }).hasAttribute("disabled")).toBe(
            true,
          );
          await act(async () => removals[1]!.resolve());
          expect(controllers[1]!.exit).toHaveBeenCalledOnce();
          expect(view.getByText("exited")).toBeTruthy();
        }
      }
    },
  );

  it("discards a delayed old-owner snapshot rather than caching or attaching it on another connection", async () => {
    const store = createStore();
    store.set(runtimeAtom, {
      connected: true,
      profileID: "profile-1",
      connectionID: "owner",
    } as never);
    let resolve!: (value: Awaited<ReturnType<typeof palot.snapshotPty>>) => void;
    const snapshot = vi
      .spyOn(palot, "snapshotPty")
      .mockImplementationOnce(
        () =>
          new Promise((done) => {
            resolve = done;
          }),
      )
      .mockResolvedValue({ buffer: "fresh output", cursor: 2, cols: 80, rows: 24 });
    const connect = vi.spyOn(palot, "connectPty").mockResolvedValue("attachment");
    vi.spyOn(palot, "startPty").mockResolvedValue();
    vi.spyOn(palot, "resizePty").mockResolvedValue();
    vi.spyOn(palot, "disconnectPty").mockResolvedValue();
    vi.spyOn(palot, "subscribe").mockReturnValue(() => {});
    vi.spyOn(palot, "onPtyEvent").mockReturnValue(() => {});
    render(
      <Provider store={store}>
        <TerminalTab tab={{ ...tab, resource: { ...tab.resource, ptyID: "delayed-snapshot" } }} />
      </Provider>,
    );
    await waitFor(() => expect(snapshot).toHaveBeenCalledWith("delayed-snapshot", "owner"));
    act(() =>
      store.set(runtimeAtom, {
        connected: true,
        profileID: "other-profile",
        connectionID: "other",
      } as never),
    );
    await act(async () => resolve({ buffer: "stale output", cursor: 1, cols: 80, rows: 24 }));
    expect(connect).not.toHaveBeenCalled();
    act(() =>
      store.set(runtimeAtom, {
        connected: true,
        profileID: "profile-1",
        connectionID: "replacement",
      } as never),
    );
    await waitFor(() => expect(palot.startPty).toHaveBeenCalledWith("attachment"));
    expect(snapshot).toHaveBeenLastCalledWith("delayed-snapshot", "replacement");
    expect(connect).toHaveBeenLastCalledWith(
      expect.objectContaining({ ptyID: "delayed-snapshot" }),
      "replacement",
    );
    expect(ghostty.writes).toContain("fresh output");
    expect(ghostty.writes).not.toContain("stale output");
  });

  it("detaches a late attachment from the original server without starting or removing it", async () => {
    const store = createStore();
    store.set(runtimeAtom, {
      connected: true,
      profileID: "profile-1",
      connectionID: "owner",
    } as never);
    let resolve!: (value: string) => void;
    const connect = vi.spyOn(palot, "connectPty").mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const start = vi.spyOn(palot, "startPty").mockResolvedValue();
    const detach = vi.spyOn(palot, "disconnectPty").mockResolvedValue();
    const remove = vi.spyOn(palot, "removePty").mockResolvedValue();
    vi.spyOn(palot, "resizePty").mockResolvedValue();
    render(
      <Provider store={store}>
        <TerminalTab
          tab={{
            ...tab,
            resource: { ...tab.resource, ptyID: "delayed-attach", transport: "legacy" },
          }}
        />
      </Provider>,
    );
    await waitFor(() =>
      expect(connect).toHaveBeenCalledWith(
        expect.objectContaining({ ptyID: "delayed-attach" }),
        "owner",
      ),
    );
    act(() =>
      store.set(runtimeAtom, {
        connected: true,
        profileID: "other-profile",
        connectionID: "other",
      } as never),
    );
    await act(async () => resolve("old-owner-attachment"));
    expect(detach).toHaveBeenCalledWith("old-owner-attachment");
    expect(start).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });
  it("automatically retries a failed remote attachment without recreating the view or ending its terminal", async () => {
    const store = createStore();
    store.set(runtimeAtom, {
      connected: true,
      profileID: "profile-1",
      topology: "remote-machine",
      connectionID: "test",
    } as never);
    vi.spyOn(palot, "connectPty")
      .mockRejectedValueOnce(new Error("Tunnel interrupted"))
      .mockResolvedValueOnce("retry-connection");
    vi.spyOn(palot, "startPty").mockResolvedValue();
    vi.spyOn(palot, "getPty").mockResolvedValue({
      id: "remote-retry",
      title: "Terminal",
      status: "running",
      transport: "legacy",
    });
    vi.spyOn(palot, "resizePty").mockResolvedValue();
    vi.spyOn(palot, "disconnectPty").mockResolvedValue();
    vi.spyOn(palot, "onPtyEvent").mockReturnValue(() => undefined);
    vi.spyOn(palot, "createPty");
    vi.spyOn(palot, "removePty");
    const view = render(
      <Provider store={store}>
        <TerminalTab
          tab={{
            ...tab,
            resource: { ...tab.resource, transport: "legacy", ptyID: "remote-retry" },
          }}
        />
      </Provider>,
    );
    await waitFor(() => expect(palot.startPty).toHaveBeenCalledWith("retry-connection"));
    expect(ghostty.disposed).toBe(0);
    expect(palot.connectPty).toHaveBeenLastCalledWith(
      expect.objectContaining({ ptyID: "remote-retry", transport: "legacy" }),
      "test",
    );
    expect(palot.createPty).not.toHaveBeenCalled();
    expect(palot.removePty).not.toHaveBeenCalled();
    view.unmount();
    expect(palot.disconnectPty).toHaveBeenCalledWith("retry-connection");
  });
  it("retains the rendered output through runtime disconnection and reattaches from the latest cursor", async () => {
    const store = createStore();
    store.set(runtimeAtom, {
      connected: true,
      profileID: "profile-1",
      connectionID: "owner",
    } as never);
    const events: Array<Parameters<typeof palot.onPtyEvent>[0]> = [];
    vi.spyOn(palot, "snapshotPty").mockResolvedValue({
      buffer: "retained output",
      cursor: 15,
      cols: 80,
      rows: 24,
    });
    const connect = vi
      .spyOn(palot, "connectPty")
      .mockResolvedValueOnce("before")
      .mockResolvedValueOnce("after");
    vi.spyOn(palot, "startPty").mockResolvedValue();
    vi.spyOn(palot, "resizePty").mockResolvedValue();
    vi.spyOn(palot, "subscribe").mockReturnValue(() => {});
    vi.spyOn(palot, "onPtyEvent").mockImplementation((listener) => {
      events.push(listener);
      return () => {};
    });
    const detach = vi.spyOn(palot, "disconnectPty").mockResolvedValue();
    const create = vi.spyOn(palot, "createPty");
    const remove = vi.spyOn(palot, "removePty");
    const view = render(
      <Provider store={store}>
        <TerminalTab tab={{ ...tab, resource: { ...tab.resource, ptyID: "retain-view" } }} />
      </Provider>,
    );
    await waitFor(() => expect(palot.startPty).toHaveBeenCalledWith("before"));
    act(() => events[0]!({ connectionID: "before", type: "data", data: "!" }));
    act(() =>
      store.set(runtimeAtom, {
        connected: false,
        profileID: "profile-1",
        connectionID: "owner",
      } as never),
    );
    expect(detach).toHaveBeenCalledWith("before");
    expect(ghostty.disposed).toBe(0);
    expect(ghostty.writes).toEqual(["retained output", "!"]);
    act(() =>
      store.set(runtimeAtom, {
        connected: true,
        profileID: "profile-1",
        connectionID: "replacement",
      } as never),
    );
    await waitFor(() => expect(palot.startPty).toHaveBeenCalledWith("after"));
    expect(connect).toHaveBeenLastCalledWith(
      expect.objectContaining({ cursor: 16, ptyID: "retain-view" }),
      "replacement",
    );
    expect(ghostty.disposed).toBe(0);
    expect(ghostty.writes).toEqual(["retained output", "!"]);
    expect(create).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    view.unmount();
    expect(ghostty.disposed).toBe(1);
  });
  it("observes without writes or resizing until Take control, and only detaches on unmount", async () => {
    const store = createStore();
    store.set(runtimeAtom, {
      connected: true,
      profileID: "profile-1",
      connectionID: "test",
    } as never);
    const ptyEvents: Array<Parameters<typeof palot.onPtyEvent>[0]> = [];
    vi.spyOn(palot, "snapshotPty").mockResolvedValue({
      buffer: "output",
      cursor: 6,
      cols: 80,
      rows: 24,
    });
    vi.spyOn(palot, "connectPty")
      .mockResolvedValueOnce("observer")
      .mockResolvedValueOnce("controller")
      .mockResolvedValueOnce("reconnected-observer");
    vi.spyOn(palot, "startPty").mockResolvedValue();
    vi.spyOn(palot, "writePty").mockResolvedValue();
    vi.spyOn(palot, "resizePty").mockResolvedValue();
    vi.spyOn(palot, "removePty").mockResolvedValue();
    vi.spyOn(palot, "disconnectPty").mockResolvedValue();
    vi.spyOn(palot, "subscribe").mockReturnValue(() => undefined);
    vi.spyOn(palot, "onPtyEvent").mockImplementation((cb) => {
      ptyEvents.push(cb);
      return () => undefined;
    });
    const view = render(
      <Provider store={store}>
        <TerminalTab
          tab={{ ...tab, resource: { ...tab.resource, ptyID: "read-only-pty", readOnly: true } }}
        />
      </Provider>,
    );
    await waitFor(() => expect(palot.startPty).toHaveBeenCalledWith("observer"));
    expect(palot.connectPty).toHaveBeenCalledWith(
      expect.objectContaining({ readOnly: true }),
      "test",
    );
    act(() => {
      ghostty.data?.("bad\n");
      ghostty.resize?.({ cols: 100, rows: 30 });
    });
    expect(palot.writePty).not.toHaveBeenCalled();
    expect(palot.resizePty).not.toHaveBeenCalled();
    act(() => ptyEvents[0]?.({ connectionID: "observer", type: "open" }));
    fireEvent.click(view.getByRole("button", { name: "Take control" }));
    await waitFor(() => expect(palot.startPty).toHaveBeenCalledWith("controller"));
    expect(palot.disconnectPty).toHaveBeenCalledWith("observer");
    expect(palot.connectPty).toHaveBeenLastCalledWith(
      expect.not.objectContaining({ readOnly: true }),
      "test",
    );
    act(() => ghostty.data?.("pwd\n"));
    expect(palot.writePty).toHaveBeenCalledWith(
      expect.objectContaining({ connectionID: "controller", data: "pwd\n" }),
    );
    const confirm = vi.fn().mockReturnValue(false);
    vi.stubGlobal("confirm", confirm);
    fireEvent.click(view.getByRole("button", { name: "End terminal" }));
    expect(confirm).toHaveBeenCalledOnce();
    expect(palot.removePty).not.toHaveBeenCalled();
    act(() =>
      store.set(runtimeAtom, {
        connected: true,
        profileID: "profile-1",
        connectionID: "replacement",
      } as never),
    );
    await waitFor(() => expect(palot.startPty).toHaveBeenCalledWith("reconnected-observer"));
    expect(palot.connectPty).toHaveBeenLastCalledWith(
      expect.objectContaining({ readOnly: true }),
      "replacement",
    );
    act(() => store.set(runtimeAtom, { connected: false, profileID: "profile-1" } as never));
    expect(view.getByRole("button", { name: "End terminal" }).hasAttribute("disabled")).toBe(true);
    expect(palot.disconnectPty).toHaveBeenCalledWith("controller");
    act(() => store.set(runtimeAtom, { connected: true, profileID: "other-profile" } as never));
    expect(view.getByRole("button", { name: "End terminal" }).hasAttribute("disabled")).toBe(true);
    expect(palot.connectPty).toHaveBeenCalledTimes(3);
    view.unmount();
    expect(palot.removePty).not.toHaveBeenCalled();
    expect(palot.disconnectPty).toHaveBeenCalledWith("controller");
  });
  it("restores output, writes and resizes, reconnects from the latest cursor, and cleans up", async () => {
    const ptyEvents: Array<(event: Parameters<Parameters<typeof palot.onPtyEvent>[0]>[0]) => void> =
      [];
    const openCodeEvents: Array<(batch: PalotEventBatch) => void> = [];
    vi.spyOn(palot, "snapshotPty").mockResolvedValue({
      buffer: "restored\n",
      cursor: 9,
      cols: 80,
      rows: 24,
    });
    vi.spyOn(palot, "connectPty")
      .mockResolvedValueOnce("connection-1")
      .mockResolvedValueOnce("connection-2");
    vi.spyOn(palot, "startPty").mockResolvedValue(undefined);
    vi.spyOn(palot, "writePty").mockResolvedValue(undefined);
    vi.spyOn(palot, "resizePty").mockResolvedValue(undefined);
    vi.spyOn(palot, "disconnectPty").mockResolvedValue(undefined);
    vi.spyOn(palot, "getPty").mockResolvedValue({
      id: "pty-1",
      title: "Terminal",
      status: "running",
      transport: "persistent",
    });
    vi.spyOn(palot, "onPtyEvent").mockImplementation((callback) => {
      ptyEvents.push(callback);
      return () => undefined;
    });
    vi.spyOn(palot, "subscribe").mockImplementation((callback) => {
      openCodeEvents.push(callback);
      return () => undefined;
    });

    const store = createStore();
    store.set(runtimeAtom, {
      connected: true,
      profileID: "profile-1",
      connectionID: "test",
    } as never);
    const view = render(
      <Provider store={store}>
        <TerminalTab tab={tab} />
      </Provider>,
    );

    await waitFor(() => expect(palot.connectPty).toHaveBeenCalledOnce());
    expect(palot.connectPty).toHaveBeenCalledWith(
      {
        ptyID: "pty-1",
        location: { directory: "/repo" },
        cursor: 9,
        transport: "persistent",
      },
      "test",
    );
    expect(ghostty.writes).toEqual(["restored\n"]);

    act(() => ptyEvents[0]?.({ connectionID: "connection-1", type: "open" }));
    act(() => ptyEvents[0]?.({ connectionID: "connection-1", type: "data", data: "new" }));
    act(() => ghostty.data?.("pwd\n"));
    expect(palot.writePty).toHaveBeenCalledWith({
      connectionID: "connection-1",
      data: "pwd\n",
      cols: 80,
      rows: 24,
    });

    act(() => ghostty.resize?.({ cols: 100, rows: 30 }));
    await waitFor(() =>
      expect(palot.writePty).toHaveBeenCalledWith({
        connectionID: "connection-1",
        data: "",
        cols: 100,
        rows: 30,
        control: true,
      }),
    );

    act(() => ptyEvents[0]?.({ connectionID: "connection-1", type: "close", code: 1006 }));
    await waitFor(() => expect(palot.connectPty).toHaveBeenCalledTimes(2), { timeout: 1_000 });
    expect(palot.connectPty).toHaveBeenLastCalledWith(
      {
        ptyID: "pty-1",
        location: { directory: "/repo" },
        cursor: 12,
        transport: "persistent",
      },
      "test",
    );
    expect(palot.startPty).toHaveBeenLastCalledWith("connection-2");

    const removedBatch = {
      connectionID: "test",
      contractVersion: "test",
      streamEpoch: 1,
      batchSequence: 1,
      receivedAt: 1,
      sentAt: 1,
      events: [
        {
          id: "event-1",
          created: 1,
          createdAt: 1,
          receiveSequence: 1,
          type: "persistent-pty.removed" as const,
          data: { sessionID: "session-1", ptyID: "pty-1" },
        },
      ],
    };
    act(() => openCodeEvents[0]?.({ ...removedBatch, connectionID: "other-server" }));
    expect(palot.disconnectPty).not.toHaveBeenCalledWith("connection-2");
    act(() => openCodeEvents[0]?.(removedBatch));
    await waitFor(() => expect(palot.disconnectPty).toHaveBeenCalledWith("connection-2"));

    view.unmount();
    expect(ghostty.disposed).toBe(1);
  });
});
