import { createStore } from "jotai";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { errorAtom, phaseAtom, runtimeAtom, workspaceRecoveryAtom } from "../atoms/workspace";
import { renderWithRouter } from "../test-utils/render-with-router";
import { Workspace } from "./workspace";
import { palot } from "../services/palot";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Workspace version mismatch", () => {
  it("requires confirmation before replacing the shared service", async () => {
    const store = createStore();
    const run = vi.fn().mockResolvedValue(undefined);
    store.set(workspaceRecoveryAtom, { run });
    store.set(phaseAtom, "error");
    store.set(errorAtom, "OpenCode versions do not match");
    store.set(runtimeAtom, {
      connectionID: "connection",
      profileID: "local-default",
      source: "shared-service",
      contractVersion: "0.0.0-beta-19425",
      phase: "error",
      connected: false,
      binaryPath: null,
      version: "0.0.0-beta-17794",
      pid: 42,
      managed: false,
      lastConnectedAt: null,
      error: "OpenCode versions do not match",
      versionMismatch: {
        detectedVersion: "0.0.0-beta-17794",
        expectedVersion: "0.0.0-beta-19425",
        canContinue: true,
      },
    });

    const mismatchRuntime = store.get(runtimeAtom)!;
    renderWithRouter(<Workspace content={null} />, store);

    expect(screen.getByRole("heading", { name: "OpenCode version mismatch" })).toBeTruthy();
    expect(
      screen.getByText(
        /Palot was tested with OpenCode 0.0.0-beta-19425, but the running service is 0.0.0-beta-17794\./,
      ),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Continue with existing service" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Use selected runtime" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Use selected runtime" }));
    expect(screen.getByText(/prepared next-start runtime/)).toBeTruthy();
    expect(screen.getByText(/may interrupt other OpenCode clients/)).toBeTruthy();
    expect(run).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(run).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Use selected runtime" }));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Replace service" })));
    expect(run).toHaveBeenCalledWith({ versionMismatch: "replace" });
    act(() => {
      store.set(phaseAtom, "error");
      store.set(runtimeAtom, { ...mismatchRuntime, source: "network-server" });
    });
    expect(screen.queryByRole("button", { name: "Use selected runtime" })).toBeNull();
    expect(screen.queryByRole("button", { name: "OpenCode release settings" })).toBeNull();
    expect(screen.getByRole("button", { name: "Continue with existing service" })).toBeTruthy();
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "Continue with existing service" })),
    );
    expect(run).toHaveBeenLastCalledWith({
      versionMismatch: "continue",
      approvedVersion: "0.0.0-beta-17794",
    });
  });

  it("starts through workspace recovery after confirmation and keeps retry read-only", async () => {
    const store = createStore();
    const run = vi.fn().mockResolvedValue(undefined);
    store.set(workspaceRecoveryAtom, { run });
    store.set(phaseAtom, "error");
    store.set(errorAtom, "No shared service is available");
    store.set(runtimeAtom, {
      connectionID: "local",
      profileID: "local-default",
      contractVersion: "test",
      phase: "error",
      connected: false,
      binaryPath: null,
      version: null,
      pid: null,
      managed: false,
      lastConnectedAt: null,
      error: "Unavailable",
      versionMismatch: null,
      canStartLocalService: true,
    });
    vi.spyOn(palot, "runtimeStatus").mockResolvedValue(store.get(runtimeAtom)!);
    const releaseStatus = vi.spyOn(palot, "openCodeReleaseStatus").mockResolvedValue({
      channel: "stable",
      bundledVersion: "2.0.2",
      preparedVersion: null,
      checkedAt: null,
      offer: null,
    });
    const checkRelease = vi.spyOn(palot, "checkOpenCodeRelease");
    const inspectInstallations = vi.spyOn(palot, "inspectOpenCodeInstallations").mockResolvedValue({
      preference: "installed",
      selectedID: null,
      installations: [],
    });
    renderWithRouter(<Workspace content={null} />, store);
    expect(releaseStatus).not.toHaveBeenCalled();
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "OpenCode release settings" })),
    );
    expect(screen.getByRole("combobox", { name: "Preferred channel" })).toBeTruthy();
    expect(releaseStatus).toHaveBeenCalled();
    expect(inspectInstallations).toHaveBeenCalledOnce();
    expect(checkRelease).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Try again" })));
    expect(run).toHaveBeenLastCalledWith(undefined);
    run.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Start OpenCode" }));
    expect(
      screen.getByRole("alertdialog", { name: "Start or recover shared OpenCode?" }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(run).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Start OpenCode" }));
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "Start or recover" })),
    );
    expect(run).toHaveBeenCalledExactlyOnceWith({ startLocalService: true });
    act(() =>
      store.set(runtimeAtom, {
        ...store.get(runtimeAtom)!,
        profileID: "remote",
        canStartLocalService: false,
      }),
    );
    expect(screen.queryByRole("button", { name: "Start OpenCode" })).toBeNull();
  });
});
