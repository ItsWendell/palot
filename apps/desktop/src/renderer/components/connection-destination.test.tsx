import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createStore, Provider } from "jotai";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OpenCodeProfile, OpenCodeRuntimeStatus } from "../../shared";
import { runtimeAtom } from "../atoms/workspace";
import { discoveredProfileIDsAtom, includedProfileIDsAtom } from "../atoms/connections";
import { ConnectionDestination } from "./connection-destination";

const overview = vi.hoisted(() => ({ getSnapshot: vi.fn(), subscribe: () => () => {} }));
vi.mock("../lib/connection-overview", () => ({ connectionOverview: () => overview }));

const local: OpenCodeProfile = { id: "local", kind: "local", name: "Local OpenCode" };
const remote: OpenCodeProfile = {
  id: "remote",
  kind: "remote",
  name: "Build server",
  urls: ["https://build.example"],
  credentialID: null,
  allowPlainHttp: false,
  lastSuccessfulUrl: null,
  lastConnectedAt: null,
};

function setup(
  profile: OpenCodeProfile,
  connected = true,
  onProfileChange?: (profileID: string) => void,
) {
  overview.getSnapshot.mockReturnValue([{ profile: local }, { profile: remote }]);
  const store = createStore();
  store.set(discoveredProfileIDsAtom, [local.id, remote.id]);
  store.set(includedProfileIDsAtom, [local.id, remote.id]);
  const runtime = { profileID: profile.id, connected } as OpenCodeRuntimeStatus;
  store.set(runtimeAtom, runtime);
  const view = render(
    <QueryClientProvider client={new QueryClient()}>
      <Provider store={store}>
        <ConnectionDestination onProfileChange={onProfileChange} />
      </Provider>
    </QueryClientProvider>,
  );
  return { ...view, store, runtime };
}

afterEach(cleanup);

describe("composer connection destination", () => {
  it("lets a new draft choose the local server without disconnecting the remote", async () => {
    const onProfileChange = vi.fn();
    setup(remote, true, onProfileChange);
    await userEvent.click(screen.getByRole("combobox", { name: "Server: Build server" }));
    await userEvent.type(screen.getByRole("combobox", { name: "Search servers" }), "Local");
    await userEvent.keyboard("{Enter}");
    expect(onProfileChange).toHaveBeenCalledExactlyOnceWith(local.id);
    expect(screen.queryByPlaceholderText("Search servers…")).toBeNull();
  });

  it("keeps local execution explicit for drafts when multiple servers are available", () => {
    setup(local, true, vi.fn());
    expect(screen.getByRole("combobox", { name: "Server: Local OpenCode" })).toBeTruthy();
  });

  it("does not silently enable a disabled server through the draft picker", async () => {
    const onProfileChange = vi.fn();
    const { store } = setup(local, true, onProfileChange);
    act(() => store.set(includedProfileIDsAtom, [local.id]));
    await userEvent.click(screen.getByRole("combobox", { name: "Server: Local OpenCode" }));
    const option = screen.getByRole("option", { name: /Build server/ });
    expect(option.getAttribute("aria-disabled")).toBe("true");
    await userEvent.click(option);
    expect(onProfileChange).not.toHaveBeenCalled();
  });

  it("hides connected local destinations even with multiple monitored connections", () => {
    const { container } = setup(local);
    expect(container.childElementCount).toBe(0);
  });

  it("shows a read-only remote badge with its server details and no Run on row", () => {
    setup(remote);
    expect(screen.getByText("Build server")).toBeTruthy();
    expect(
      screen
        .getByRole("img", { name: "Build server · build.example · Connected" })
        .getAttribute("title"),
    ).toBe("Build server · build.example · Connected");
    expect(screen.queryByText("Run on")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it.each([local, remote])("warns when $kind is offline and clears on reconnect", (profile) => {
    const { store, runtime } = setup(profile, false);
    expect(screen.getByRole("status").textContent).toBe(`${profile.name} · Offline`);
    act(() => store.set(runtimeAtom, { ...runtime, connected: true }));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("updates the badge when execution switches from remote to local", () => {
    const { store, runtime, container } = setup(remote);
    act(() => store.set(runtimeAtom, { ...runtime, profileID: local.id }));
    expect(container.childElementCount).toBe(0);
  });
});
