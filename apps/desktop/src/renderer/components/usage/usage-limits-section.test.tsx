import { OpenCode, type UsageLimitsInfo } from "@opencode/client";
import { createStore } from "jotai";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runtimeAtom } from "../../atoms/workspace";
import { palot } from "../../services/palot";
import {
  resetOpenCodeClientForTest,
  setOpenCodeClientForTest,
} from "../../services/opencode-client";
import { renderWithRouter } from "../../test-utils/render-with-router";
import { UsageLimitsSection } from "./usage-limits-section";

afterEach(() => {
  cleanup();
  resetOpenCodeClientForTest();
  vi.restoreAllMocks();
});

function setup(response: () => Response | Promise<Response>, version = "2.2.0") {
  const fetch = vi.fn(async (_request: RequestInfo | URL) => response());
  setOpenCodeClientForTest(OpenCode.make({ baseUrl: "https://example.test", fetch }));
  const store = createStore();
  store.set(runtimeAtom, {
    connectionID: "one",
    profileID: "profile",
    contractVersion: "test",
    phase: "connected",
    connected: true,
    binaryPath: null,
    version,
    pid: 1,
    managed: true,
    lastConnectedAt: 1,
    error: null,
    versionMismatch: null,
  });
  return { ...renderWithRouter(<UsageLimitsSection directory="/repo" />, store), fetch };
}

describe("UsageLimitsSection", () => {
  it("shows remaining Go allowances, scoped budgets and an external management link", async () => {
    const resetsAt = Date.now() + 2 * 3_600_000 + 15 * 60_000;
    const data: UsageLimitsInfo = {
      workspace: { id: "workspace", name: "Palot team", usageURL: "https://console.example/usage" },
      go: {
        rolling: { percent: 35, limited: false, resetsAt },
        weekly: { percent: 50, limited: false, resetsAt: Date.now() + 3 * 86_400_000 },
        monthly: { percent: 100, limited: true, resetsAt: Date.now() + 10 * 86_400_000 },
      },
      budgets: [
        {
          id: "budget",
          spent: 25,
          limit: 100,
          scope: "combined",
          per: "set",
          coverage: "models",
          models: [],
          vendors: ["Anthropic"],
          picked: false,
          shared: true,
          resetsAt,
        },
      ],
    };
    const external = vi.spyOn(palot, "openExternalUrl").mockResolvedValue(true);
    const { fetch } = setup(() => Response.json({ location: { directory: "/repo" }, data }));
    expect(await screen.findByText("Palot team")).toBeTruthy();
    const rolling = screen.getByRole("article", { name: "Go · 5-hour" });
    expect(within(rolling).getByText("65% left")).toBeTruthy();
    expect(within(rolling).getByRole("progressbar").getAttribute("aria-valuenow")).toBe("65");
    expect(within(rolling).getByText("Resets in 2h 14m")).toBeTruthy();
    expect(screen.getByRole("article", { name: "Monthly" }).textContent).toContain("Limited");
    expect(screen.getByText("$25.00 of $100.00")).toBeTruthy();
    expect(screen.getByText("Anthropic")).toBeTruthy();
    expect(screen.getByText("Shared by the workspace")).toBeTruthy();
    await userEvent.click(screen.getByRole("link", { name: "Manage usage ↗" }));
    expect(external).toHaveBeenCalledExactlyOnceWith(data.workspace.usageURL);
    await userEvent.click(screen.getByRole("button", { name: "Refresh limits" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  });

  it("shows loading and signed-out states independently of activity stats", async () => {
    let resolve!: (value: Response) => void;
    setup(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    expect(screen.getByRole("status", { name: "Loading limits" })).toBeTruthy();
    resolve(Response.json({ location: { directory: "/repo" }, data: null }));
    expect(
      await screen.findByText("Sign in to OpenCode Console on this server to see plan limits."),
    ).toBeTruthy();
  });

  it("shows old-server unavailability without presenting an error", () => {
    const { fetch } = setup(() => Response.json({}), "2.0.7");
    expect(screen.getByText("Limits need OpenCode 2.2.0 or newer on this server.")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("offers retry for real errors", async () => {
    const { fetch } = setup(() => new Response("Failed", { status: 500 }));
    expect(await screen.findByText("Could not load limits")).toBeTruthy();
    await waitFor(() =>
      expect(
        screen.getByRole("alert", { name: "Could not load limits" }).parentElement?.style
          .pointerEvents,
      ).toBe("auto"),
    );
    await userEvent.click(screen.getByRole("button", { name: "Retry limits" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  });
});
