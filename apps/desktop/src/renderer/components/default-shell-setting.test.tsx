import type { ConfigGetOutput, OpenCodeClient } from "@opencode/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider, createStore } from "jotai";
import { afterEach, expect, it, vi } from "vitest";
import { runtimeAtom } from "../atoms/workspace";
import { createRendererQueryClient } from "../lib/query-client";
import { resetOpenCodeClientForTest, setOpenCodeClientForTest } from "../services/opencode-client";
import { DefaultShellSetting } from "./default-shell-setting";

afterEach(() => {
  cleanup();
  resetOpenCodeClientForTest();
  vi.restoreAllMocks();
});

function renderShell(config: { get: () => Promise<ConfigGetOutput> }) {
  const shells = vi.fn(async () => [
    { name: "zsh", path: "/bin/zsh", acceptable: true },
    { name: "fish", path: "/usr/bin/fish", acceptable: true },
    { name: "nu", path: "/usr/bin/nu", acceptable: false },
  ]);
  const update = vi.fn(async () => undefined);
  const get = vi.fn(config.get);
  setOpenCodeClientForTest({ config: { get, shells, update } } as unknown as OpenCodeClient);
  const store = createStore();
  store.set(runtimeAtom, {
    connectionID: "connection-1",
    profileID: "local-default",
    phase: "connected",
    connected: true,
    contractVersion: "2.0.26",
    version: "2.0.26",
    binaryPath: null,
    pid: null,
    managed: false,
    lastConnectedAt: 1,
    error: null,
    versionMismatch: null,
  });
  render(
    <QueryClientProvider client={createRendererQueryClient()}>
      <Provider store={store}>
        <DefaultShellSetting />
      </Provider>
    </QueryClientProvider>,
  );
  return { get, shells, update, user: userEvent.setup() };
}

it("shows the global shell, lists server shells, and saves a choice", async () => {
  // Project config later in the list must not count as the global default.
  const entries = [
    { type: "document", path: "~/.config/opencode/opencode.json", info: { shell: "zsh" } },
    { type: "directory", path: "/repo" },
    { type: "document", path: "/repo/opencode.json", info: { shell: "nu" } },
  ] as ConfigGetOutput;
  const { get, update, user } = renderShell({ get: async () => entries });
  const trigger = await screen.findByRole("combobox", { name: "Default shell" });
  await waitFor(() => expect(trigger.textContent).toContain("zsh"));

  await user.click(trigger);
  expect((await screen.findByRole("option", { name: /nu/ })).textContent).toContain(
    "Terminal only",
  );
  await user.click(screen.getByRole("option", { name: "fish" }));

  expect(update).toHaveBeenCalledWith({ shell: "fish" }, expect.anything());
  await waitFor(() => expect(get).toHaveBeenCalledTimes(2));

  await user.click(trigger);
  await user.click(await screen.findByRole("option", { name: "Auto" }));
  expect(update).toHaveBeenLastCalledWith({ shell: null }, expect.anything());
});

it("reports load failures with a retry", async () => {
  let fail = true;
  const { get, user } = renderShell({
    get: async () => {
      if (fail) throw new Error("Config unavailable");
      return [] as ConfigGetOutput;
    },
  });
  expect((await screen.findByRole("alert")).textContent).toBe("Config unavailable");
  fail = false;
  await user.click(screen.getByRole("button", { name: "Retry" }));
  const trigger = await screen.findByRole("combobox", { name: "Default shell" });
  expect(trigger.textContent).toContain("Auto");
  expect(get).toHaveBeenCalledTimes(2);
});
