import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenCodeInstallationStatus } from "../../shared/opencode-installation-contract";
import type { OpenCodeReleaseStatus } from "../../shared/opencode-release-contract";
import { palot } from "../services/palot";
import { OpenCodeInstallationSettings } from "./open-code-installation-settings";
import { LocalOpenCodeRuntimeSettings } from "./open-code-release-settings";

vi.mock("../services/palot", () => ({
  palot: {
    inspectOpenCodeInstallations: vi.fn(),
    openCodeInstallationStatus: vi.fn(),
    setOpenCodeRuntimePreference: vi.fn(),
    selectOpenCodeInstallation: vi.fn(),
    upgradeOpenCodeInstallation: vi.fn(),
    openCodeReleaseStatus: vi.fn(),
    checkOpenCodeRelease: vi.fn(),
    setOpenCodeReleaseChannel: vi.fn(),
    prepareOpenCodeRelease: vi.fn(),
    resetOpenCodeRelease: vi.fn(),
    connectOpenCode: vi.fn(),
    restartLocalOpenCodeService: vi.fn(),
  },
}));

const installation = {
  id: "npm-installation",
  version: "2.0.2",
  path: "/home/test/.npm/bin/opencode2",
  compatible: true,
};
const initial: OpenCodeInstallationStatus = {
  preference: "installed",
  selectedID: installation.id,
  installations: [installation],
};
const release: OpenCodeReleaseStatus = {
  channel: "stable",
  bundledVersion: "2.0.2",
  preparedVersion: null,
  checkedAt: null,
  offer: null,
};
const offered: OpenCodeReleaseStatus = {
  ...release,
  checkedAt: 1000,
  offer: {
    channel: "stable",
    version: "2.0.3",
    tested: false,
    requiresConfirmation: false,
    size: 1024,
  },
};

beforeEach(() => {
  vi.mocked(palot.inspectOpenCodeInstallations).mockResolvedValue(initial);
  vi.mocked(palot.openCodeInstallationStatus).mockResolvedValue(initial);
  vi.mocked(palot.openCodeReleaseStatus).mockResolvedValue(release);
  vi.mocked(palot.checkOpenCodeRelease).mockResolvedValue(offered);
  vi.mocked(palot.upgradeOpenCodeInstallation).mockResolvedValue({
    ...initial,
    installations: [{ ...installation, version: "2.0.3" }],
  });
});

it("keeps an explicitly approved installed beta eligible for the next update", async () => {
  vi.mocked(palot.inspectOpenCodeInstallations).mockResolvedValue({
    ...initial,
    installations: [
      { ...installation, version: "0.0.0-beta-19599", compatible: false, approved: true },
    ],
  });
  vi.mocked(palot.openCodeReleaseStatus).mockResolvedValue(offered);
  render(<OpenCodeInstallationSettings />);
  expect(
    await screen.findByRole("button", { name: "Update installed OpenCode to 2.0.3" }),
  ).toBeTruthy();
  expect(screen.queryByText("No compatible selected installation is available.")).toBeNull();
});
afterEach(() => {
  cleanup();
  expect(palot.connectOpenCode).not.toHaveBeenCalled();
  expect(palot.restartLocalOpenCodeService).not.toHaveBeenCalled();
  expect(palot.prepareOpenCodeRelease).not.toHaveBeenCalled();
  vi.resetAllMocks();
});

describe("OpenCodeInstallationSettings", () => {
  it("recovers from a failed local inspection only when refresh is requested", async () => {
    const user = userEvent.setup();
    vi.mocked(palot.inspectOpenCodeInstallations).mockRejectedValueOnce(
      new Error("SECRET=scan-output"),
    );
    render(<OpenCodeInstallationSettings />);
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.queryByText(/SECRET/)).toBeNull();
    expect(palot.inspectOpenCodeInstallations).toHaveBeenCalledOnce();
    await user.click(screen.getByRole("button", { name: "Refresh installations" }));
    expect(await screen.findByRole("combobox", { name: "Runtime source" })).toBeTruthy();
    expect(palot.inspectOpenCodeInstallations).toHaveBeenCalledTimes(2);
    expect(palot.checkOpenCodeRelease).not.toHaveBeenCalled();
    expect(palot.upgradeOpenCodeInstallation).not.toHaveBeenCalled();
  });
  it("prefers installed OpenCode and inspects locally without checking, downloading or upgrading", async () => {
    render(<OpenCodeInstallationSettings />);
    expect((await screen.findByRole("combobox", { name: "Runtime source" })).textContent).toContain(
      "Installed OpenCode (recommended)",
    );
    expect(screen.getByText(installation.version)).toBeTruthy();
    expect(screen.getByText(installation.path)).toBeTruthy();
    expect(palot.inspectOpenCodeInstallations).toHaveBeenCalledOnce();
    expect(palot.openCodeReleaseStatus).toHaveBeenCalledOnce();
    expect(palot.checkOpenCodeRelease).not.toHaveBeenCalled();
    expect(palot.upgradeOpenCodeInstallation).not.toHaveBeenCalled();
    expect(palot.setOpenCodeRuntimePreference).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    "offers explicit setup for missing or unsupported installations (%s)",
    async (unsupported) => {
      vi.mocked(palot.inspectOpenCodeInstallations).mockResolvedValue({
        ...initial,
        installations: unsupported ? [{ ...installation, compatible: false }] : [],
      });
      vi.mocked(palot.openCodeReleaseStatus).mockResolvedValue(offered);
      const user = userEvent.setup();
      render(<OpenCodeInstallationSettings />);
      expect(
        await screen.findByText(/download a fallback in OpenCode release settings/),
      ).toBeTruthy();
      expect(
        screen
          .getByRole("link", { name: "Official OpenCode installation instructions" })
          .getAttribute("href"),
      ).toBe("https://opencode.ai/v2/docs/");
      expect(screen.queryByRole("button", { name: /Update installed/ })).toBeNull();
      await user.click(screen.getByRole("button", { name: "Refresh installations" }));
      expect(palot.inspectOpenCodeInstallations).toHaveBeenCalledTimes(2);
      expect(palot.upgradeOpenCodeInstallation).not.toHaveBeenCalled();
    },
  );

  it.each(["auto", "npm", "bun", "pnpm", "yarn", "curl"] as const)(
    "requires explicit confirmation and passes the %s method without a stable risk override",
    async (method) => {
      const user = userEvent.setup();
      render(<OpenCodeInstallationSettings />);
      await user.click(await screen.findByRole("button", { name: "Check for updates" }));
      await user.click(screen.getByRole("button", { name: "Update installed OpenCode to 2.0.3" }));
      const dialog = screen.getByRole("alertdialog");
      expect(dialog.textContent).toContain(installation.path);
      expect(dialog.textContent).toContain("from 2.0.2 to 2.0.3");
      expect(dialog.textContent).toContain("not specific to an installation prefix");
      expect(dialog.textContent).not.toContain("Compatibility is not guaranteed");
      expect(palot.upgradeOpenCodeInstallation).not.toHaveBeenCalled();
      if (method !== "auto") {
        await user.click(screen.getByRole("combobox", { name: "Install method" }));
        await user.click(screen.getByRole("option", { name: method }));
      }
      await user.click(screen.getByRole("button", { name: "Confirm installed update" }));
      expect(palot.upgradeOpenCodeInstallation).toHaveBeenCalledExactlyOnceWith({
        id: installation.id,
        currentVersion: installation.version,
        version: "2.0.3",
        method,
      });
      expect(await screen.findByText(/Installed OpenCode update completed/)).toBeTruthy();
    },
  );

  it("shows an up-to-date status instead of offering a same-version update", async () => {
    vi.mocked(palot.openCodeReleaseStatus).mockResolvedValue({
      ...offered,
      offer: { ...offered.offer!, version: installation.version },
    });
    render(<OpenCodeInstallationSettings />);
    expect(await screen.findByText("Installed OpenCode is up to date")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Update installed OpenCode/ })).toBeNull();
    expect(palot.upgradeOpenCodeInstallation).not.toHaveBeenCalled();
  });

  it("sends the installed version shown in the dialog even after a sibling refresh", async () => {
    const user = userEvent.setup();
    vi.mocked(palot.openCodeReleaseStatus).mockResolvedValue(offered);
    render(<OpenCodeInstallationSettings />);
    await user.click(
      await screen.findByRole("button", { name: "Update installed OpenCode to 2.0.3" }),
    );
    vi.mocked(palot.openCodeInstallationStatus).mockResolvedValue({
      ...initial,
      installations: [{ ...installation, version: "2.0.4" }],
    });
    await act(async () => window.dispatchEvent(new Event("palot:opencode-release-changed")));
    expect(screen.getByRole("alertdialog").textContent).toContain("from 2.0.2 to 2.0.3");
    await user.click(screen.getByRole("button", { name: "Confirm installed update" }));
    expect(palot.upgradeOpenCodeInstallation).toHaveBeenCalledExactlyOnceWith({
      id: installation.id,
      currentVersion: installation.version,
      version: "2.0.3",
      method: "auto",
    });
  });

  it("cancels beta upgrades and scopes risk consent to the offered version", async () => {
    const user = userEvent.setup();
    vi.mocked(palot.openCodeReleaseStatus).mockResolvedValue({
      ...offered,
      channel: "beta",
      offer: {
        ...offered.offer!,
        channel: "beta",
        version: "2.1.0-beta.1",
        requiresConfirmation: true,
      },
    });
    render(<OpenCodeInstallationSettings />);
    await user.click(
      await screen.findByRole("button", { name: "Update installed OpenCode to 2.1.0-beta.1" }),
    );
    expect(screen.getByRole("alertdialog").textContent).toContain(
      "Compatibility is not guaranteed",
    );
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(palot.upgradeOpenCodeInstallation).not.toHaveBeenCalled();
    await user.click(
      screen.getByRole("button", { name: "Update installed OpenCode to 2.1.0-beta.1" }),
    );
    await user.click(screen.getByRole("button", { name: "Confirm installed update" }));
    expect(palot.upgradeOpenCodeInstallation).toHaveBeenCalledExactlyOnceWith({
      id: installation.id,
      currentVersion: installation.version,
      version: "2.1.0-beta.1",
      method: "auto",
      allowUntested: true,
    });
  });

  it.each(["success", "failure", "tab-away"] as const)(
    "keeps source selection focus during async save (%s) without downloading",
    async (outcome) => {
      const user = userEvent.setup();
      const pending = Promise.withResolvers<OpenCodeInstallationStatus>();
      vi.mocked(palot.setOpenCodeRuntimePreference).mockReturnValue(pending.promise);
      render(
        <>
          <OpenCodeInstallationSettings />
          <button type="button">Other settings</button>
        </>,
      );
      const source = await screen.findByRole("combobox", { name: "Runtime source" });
      source.focus();
      await user.keyboard("{Enter}{End}{Enter}");
      expect(palot.setOpenCodeRuntimePreference).toHaveBeenCalledExactlyOnceWith("palot");
      expect(source.getAttribute("aria-readonly")).toBe("true");
      expect((source as HTMLButtonElement).disabled).toBe(false);
      await waitFor(() => expect(document.activeElement).toBe(source));
      if (outcome === "tab-away") {
        await user.tab(); // Official documentation remains available while saving.
        await user.tab();
      }
      await act(async () => {
        if (outcome === "failure") pending.reject(new Error("sensitive process output"));
        else pending.resolve({ ...initial, preference: "palot" });
      });
      expect(source.getAttribute("aria-readonly")).toBeNull();
      expect(document.activeElement).toBe(
        outcome === "tab-away" ? screen.getByRole("button", { name: "Other settings" }) : source,
      );
      expect(screen.queryByText(/sensitive process output/)).toBeNull();
      expect(source.textContent).toContain(
        outcome === "failure" ? "Installed OpenCode (recommended)" : "Palot runtime",
      );
      expect(palot.upgradeOpenCodeInstallation).not.toHaveBeenCalled();
    },
  );

  it("selects another known installation without upgrading or restarting", async () => {
    const second = {
      ...installation,
      id: "bun-installation",
      path: "/home/test/.bun/bin/opencode2",
    };
    const multiple = { ...initial, installations: [installation, second] };
    vi.mocked(palot.inspectOpenCodeInstallations).mockResolvedValue(multiple);
    const pending = Promise.withResolvers<OpenCodeInstallationStatus>();
    vi.mocked(palot.selectOpenCodeInstallation).mockReturnValue(pending.promise);
    const user = userEvent.setup();
    render(<OpenCodeInstallationSettings />);
    const picker = await screen.findByRole("combobox", { name: "Installed OpenCode" });
    picker.focus();
    await user.keyboard("{Enter}{End}{Enter}");
    expect(palot.selectOpenCodeInstallation).toHaveBeenCalledExactlyOnceWith(second.id);
    expect(picker.getAttribute("aria-readonly")).toBe("true");
    await waitFor(() => expect(document.activeElement).toBe(picker));
    await act(async () => pending.resolve({ ...multiple, selectedID: second.id }));
    expect(picker.textContent).toContain(second.path);
    expect(palot.upgradeOpenCodeInstallation).not.toHaveBeenCalled();
  });

  it("refreshes sibling release checks and channel changes with cached local getters only", async () => {
    const user = userEvent.setup();
    render(<LocalOpenCodeRuntimeSettings />);
    await screen.findByRole("combobox", { name: "Runtime source" });
    vi.mocked(palot.openCodeReleaseStatus).mockResolvedValue(offered);
    await act(async () => window.dispatchEvent(new Event("palot:opencode-release-changed")));
    expect(
      await screen.findByRole("button", { name: "Update installed OpenCode to 2.0.3" }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Download Palot fallback 2.0.3" })).toBeTruthy();
    vi.mocked(palot.openCodeReleaseStatus).mockResolvedValue({ ...release, channel: "beta" });
    await act(async () => window.dispatchEvent(new Event("palot:opencode-release-changed")));
    expect(screen.queryByRole("button", { name: "Update installed OpenCode to 2.0.3" })).toBeNull();
    expect(screen.getByRole("combobox", { name: "Preferred channel" }).textContent).toContain(
      "Beta",
    );
    expect(screen.getByText(/shared preferred channel: Beta/)).toBeTruthy();
    expect(palot.inspectOpenCodeInstallations).toHaveBeenCalledOnce();
    expect(palot.openCodeInstallationStatus).toHaveBeenCalledTimes(2);
    expect(palot.checkOpenCodeRelease).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Refresh installations" }));
    expect(palot.inspectOpenCodeInstallations).toHaveBeenCalledTimes(2);
  });

  it("does not expose raw upgrade errors or retry without fresh consent", async () => {
    const user = userEvent.setup();
    vi.mocked(palot.openCodeReleaseStatus).mockResolvedValue(offered);
    vi.mocked(palot.upgradeOpenCodeInstallation).mockRejectedValue(
      new Error("SECRET=process-output"),
    );
    render(<OpenCodeInstallationSettings />);
    await user.click(
      await screen.findByRole("button", { name: "Update installed OpenCode to 2.0.3" }),
    );
    await user.click(screen.getByRole("button", { name: "Confirm installed update" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.queryByText(/SECRET/)).toBeNull();
    await user.click(screen.getByRole("button", { name: "Update installed OpenCode to 2.0.3" }));
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    expect(palot.upgradeOpenCodeInstallation).toHaveBeenCalledOnce();
  });
});
