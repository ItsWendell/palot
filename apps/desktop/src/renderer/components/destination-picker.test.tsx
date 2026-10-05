import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createStore, Provider } from "jotai";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OpenCodeRuntimeStatus, PalotProject } from "../../shared";
import { discoveredProfileIDsAtom, includedProfileIDsAtom } from "../atoms/connections";
import { runtimeAtom } from "../atoms/workspace";
import type { ConnectionOverview } from "../lib/connection-overview";
import { DestinationPicker } from "./destination-picker";

const overview = vi.hoisted(() => ({ getSnapshot: vi.fn(), subscribe: () => () => {} }));
vi.mock("../lib/connection-overview", () => ({ connectionOverview: () => overview }));
const project: PalotProject = {
  id: "same",
  canonical: "/repo/same",
  name: "Shared project",
  sandboxes: [],
  vcs: null,
  updatedAt: 1,
};
const local = {
  profile: { id: "local", kind: "local", name: "This device" },
  projects: [project],
  runtime: { connected: true },
} as ConnectionOverview;
const remote = {
  profile: { id: "remote", kind: "remote", name: "Build server", urls: ["https://build.example"] },
  projects: [{ ...project, canonical: "/srv/same" }],
  runtime: { connected: false },
} as ConnectionOverview;

function setup(entries = [local, remote], profileID = "local", projects?: PalotProject[]) {
  overview.getSnapshot.mockReturnValue(entries);
  const store = createStore();
  store.set(discoveredProfileIDsAtom, ["local", "remote"]);
  store.set(includedProfileIDsAtom, ["local", "remote"]);
  store.set(runtimeAtom, {
    profileID: "local",
    connectionID: "local-connection",
    connected: true,
  } as OpenCodeRuntimeStatus);
  const onChange = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <Provider store={store}>
        <DestinationPicker
          value={{ profileID, projectID: "same" }}
          projects={projects}
          onChange={onChange}
        />
      </Provider>
    </QueryClientProvider>,
  );
  return { onChange, store };
}

afterEach(cleanup);
describe("destination picker", () => {
  it("searches name, path, and server and selects colliding IDs atomically", async () => {
    const { onChange } = setup();
    await userEvent.click(screen.getByRole("combobox", { name: "Task destination" }));
    expect(screen.getAllByRole("option")).toHaveLength(2);
    expect(screen.getByText("/repo/same")).toBeTruthy();
    expect(screen.getByText("/srv/same")).toBeTruthy();
    await userEvent.type(
      screen.getByRole("combobox", { name: "Search destinations" }),
      "build.example",
    );
    await userEvent.keyboard("{Enter}");
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ profileID: "remote", projectID: "same" });
  });
  it("does not select or enable a disabled owner", async () => {
    const { onChange, store } = setup();
    act(() => store.set(includedProfileIDsAtom, ["local"]));
    await userEvent.click(screen.getByRole("combobox", { name: "Task destination" }));
    const option = screen.getByRole("option", { name: /\/srv\/same/ });
    expect(option.getAttribute("aria-disabled")).toBe("true");
    await userEvent.click(option);
    expect(onChange).not.toHaveBeenCalled();
    expect(store.get(includedProfileIDsAtom)).toEqual(["local"]);
  });
  it("retains an offline selection instead of displaying the local collision", () => {
    setup([local, remote], "remote");
    expect(screen.getByRole("combobox", { name: "Task destination" }).textContent).toContain(
      "Build serverOffline",
    );
  });
  it("uses the focused catalog during cold overview hydration", async () => {
    setup([{ ...local, projects: [] }, remote], "local", [project]);
    await userEvent.click(screen.getByRole("combobox", { name: "Task destination" }));
    expect(screen.getByRole("option", { name: /\/repo\/same/ })).toBeTruthy();
  });
  it("keeps server-only choice for an empty project inventory", async () => {
    const { onChange } = setup([local, { ...remote, projects: [] }]);
    await userEvent.click(screen.getByRole("combobox", { name: "Task destination" }));
    await userEvent.click(screen.getByRole("option", { name: /Choose server/ }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ profileID: "remote", projectID: null });
  });
});
