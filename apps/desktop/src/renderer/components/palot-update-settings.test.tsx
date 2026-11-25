import { QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, renderHook, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  PalotUpdateApi,
  PalotUpdateRelease,
  PalotUpdateStatus,
} from "../../shared/palot-update-contract";
import { usePalotUpdateAnnouncements } from "../hooks/use-palot-update";
import { createRendererQueryClient } from "../lib/query-client";
import { palot } from "../services/palot";
import { PalotUpdateSettings } from "./palot-update-settings";
import { toast } from "./ui/toast";

vi.mock("../services/palot", () => ({ palot: { openExternalUrl: vi.fn(async () => true) } }));

const RELEASE = {
  version: "0.24.0",
  url: "https://github.com/ItsWendell/palot/releases/tag/v0.24.0",
};

/** An in-memory stand-in for the main-process checker. */
function fakeUpdates(options: { supported?: boolean; latest?: typeof RELEASE | null } = {}) {
  const state: PalotUpdateStatus = {
    supported: options.supported ?? true,
    enabled: false,
    currentVersion: "0.23.0",
    checkedAt: null,
    available: null,
    dismissedVersion: null,
  };
  const latest = options.latest === undefined ? RELEASE : options.latest;
  const api = {
    status: vi.fn(async () => ({ ...state })),
    setEnabled: vi.fn(async (enabled: boolean) => {
      state.enabled = enabled;
      return { ...state };
    }),
    check: vi.fn(async () => {
      state.checkedAt = Date.UTC(2026, 10, 10, 12);
      state.available = latest;
      return { ...state };
    }),
    dismiss: vi.fn(async (version: string) => {
      state.dismissedVersion = version;
      return { ...state };
    }),
    takeAnnouncement: vi.fn(async (): Promise<PalotUpdateRelease | null> => null),
  } satisfies PalotUpdateApi;
  window.palot = { palotUpdate: api } as unknown as typeof window.palot;
  return api;
}

function isDisabled(element: HTMLElement): boolean {
  return (
    element.getAttribute("aria-disabled") === "true" ||
    element.hasAttribute("data-disabled") ||
    (element as HTMLButtonElement).disabled === true
  );
}

/** The switch once main's status has loaded. */
async function readyToggle(): Promise<HTMLElement> {
  const toggle = await screen.findByRole("switch", { name: "Check for Palot updates" });
  await waitFor(() => expect(isDisabled(toggle)).toBe(false));
  return toggle;
}

function renderSettings() {
  return render(
    <QueryClientProvider client={createRendererQueryClient()}>
      <PalotUpdateSettings />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, "palot");
});

describe("PalotUpdateSettings", () => {
  it("is off by default and explains the request without making it", async () => {
    const api = fakeUpdates();
    renderSettings();
    const toggle = await readyToggle();
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(isDisabled(screen.getByRole("button", { name: "Check now" }))).toBe(true);
    expect(screen.getByText(/asks GitHub for the latest release/)).toBeTruthy();
    expect(api.check).not.toHaveBeenCalled();
  });

  it("checks when enabled, shows the notice, opens release notes, and remembers a dismissal", async () => {
    const user = userEvent.setup();
    const api = fakeUpdates();
    const view = renderSettings();
    const toggle = await readyToggle();
    await user.click(toggle);

    expect(api.setEnabled).toHaveBeenCalledWith(true);
    expect(api.check).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("Palot 0.24.0 is available")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("Palot 0.24.0 is available");

    await user.click(screen.getByRole("button", { name: "Release notes" }));
    expect(palot.openExternalUrl).toHaveBeenCalledWith(RELEASE.url);

    await user.click(screen.getByRole("button", { name: "Dismiss for this version" }));
    expect(api.dismiss).toHaveBeenCalledWith("0.24.0");
    await waitFor(() => expect(screen.queryByText("Palot 0.24.0 is available")).toBeNull());

    // A fresh visit reads the saved dismissal from main.
    view.unmount();
    renderSettings();
    await screen.findByText(/Last checked/);
    expect(screen.queryByText("Palot 0.24.0 is available")).toBeNull();
  });

  it("says when Palot is up to date", async () => {
    const user = userEvent.setup();
    fakeUpdates({ latest: null });
    renderSettings();
    const toggle = await readyToggle();
    await user.click(toggle);
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("You're up to date."));
  });

  it("shows a plain error when the request fails", async () => {
    const user = userEvent.setup();
    const api = fakeUpdates();
    api.check.mockRejectedValueOnce(
      new Error(
        "Error invoking remote method 'palot:palot-update:check': Error: Could not check for Palot updates: GitHub returned HTTP 403.",
      ),
    );
    renderSettings();
    const toggle = await readyToggle();
    await user.click(toggle);
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Could not check for Palot updates: GitHub returned HTTP 403.",
    );
  });

  it("does not offer checks on Nightly and Dev builds", async () => {
    fakeUpdates({ supported: false });
    renderSettings();
    expect(await screen.findByText(/Update checks cover stable releases/)).toBeTruthy();
    expect(isDisabled(screen.getByRole("switch", { name: "Check for Palot updates" }))).toBe(true);
    expect(screen.queryByRole("button", { name: "Check now" })).toBeNull();
  });
});

describe("usePalotUpdateAnnouncements", () => {
  it("shows a toast for a version main hands out", async () => {
    const api = fakeUpdates();
    api.takeAnnouncement.mockResolvedValueOnce(RELEASE);
    const add = vi.spyOn(toast, "add");
    renderHook(() => usePalotUpdateAnnouncements());
    await waitFor(() =>
      expect(add).toHaveBeenCalledWith(
        expect.objectContaining({ type: "info", title: "Palot 0.24.0 is available" }),
      ),
    );
    expect(add).toHaveBeenCalledTimes(1);
  });
});
