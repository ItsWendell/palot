import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OpenCodeProfile, OpenCodeRuntimeStatus } from "../../shared";
import { runtimeAtom } from "../atoms/workspace";
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

function setup(profile: OpenCodeProfile, connected = true) {
  overview.getSnapshot.mockReturnValue([{ profile: local }, { profile: remote }]);
  const store = createStore();
  const runtime = { profileID: profile.id, connected } as OpenCodeRuntimeStatus;
  store.set(runtimeAtom, runtime);
  const view = render(
    <QueryClientProvider client={new QueryClient()}>
      <Provider store={store}>
        <ConnectionDestination />
      </Provider>
    </QueryClientProvider>,
  );
  return { ...view, store, runtime };
}

afterEach(cleanup);

describe("composer connection destination", () => {
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
