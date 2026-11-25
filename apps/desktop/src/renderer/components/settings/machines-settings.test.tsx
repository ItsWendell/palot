import type { MachineInfo, OpenCodeClient } from "@opencode/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  resetOpenCodeClientForTest,
  setOpenCodeClientForTest,
} from "../../services/opencode-client";
import { ServerMachines } from "./machines-settings";

afterEach(() => {
  cleanup();
  resetOpenCodeClientForTest();
});

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

function fakeServer(initial: MachineInfo[]) {
  let machines = initial;
  const machine = {
    list: vi.fn(async () => machines),
    add: vi.fn(async (input: { name: string; reach: unknown[] }) => {
      if (!machines.some((entry) => entry.id === input.name))
        machines = [...machines, { id: input.name, online: false, paired: false }];
      return {
        name: input.name,
        join: "ocjoin_eyJ2IjoxfQ",
        expires: Date.now() + 5 * 60_000,
        reach: input.reach,
      };
    }),
    remove: vi.fn(async ({ name }: { name: string }) => {
      machines = machines.filter((entry) => entry.id !== name);
    }),
  };
  setOpenCodeClientForTest({
    experimental: { machine },
    server: {
      info: vi.fn(async () => ({ urls: ["http://127.0.0.1:4096", "http://10.0.0.4:4096"] })),
    },
  } as unknown as OpenCodeClient);
  return {
    machine,
    connect(name: string) {
      machines = machines.map((entry) =>
        entry.id === name
          ? { ...entry, paired: true, online: true, os: "linux", arch: "x64" }
          : entry,
      );
    },
  };
}

const server = { connectionID: "c1", name: "Studio" };

describe("Machines settings", () => {
  it("adds a machine, shows its join string and flips to connected once it joins", async () => {
    const user = userEvent.setup();
    const fake = fakeServer([]);
    render(<ServerMachines server={server} title="Machines" />, { wrapper });
    await screen.findByText(/No machines yet/);

    await user.click(screen.getByRole("button", { name: "Add machine to Studio" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Machine name"), "Dev Box");
    await user.click(within(dialog).getByRole("button", { name: "Add machine" }));
    expect(within(dialog).getByText(/Use 2 to 63 lowercase letters/)).toBeTruthy();
    expect(fake.machine.add).not.toHaveBeenCalled();

    await user.clear(within(dialog).getByLabelText("Machine name"));
    await user.type(within(dialog).getByLabelText("Machine name"), "devbox");
    await user.click(within(dialog).getByRole("button", { name: "Add machine" }));
    expect(fake.machine.add).toHaveBeenCalledWith({
      name: "devbox",
      reach: [
        { type: "url", url: "ws://10.0.0.4:4096/api/experimental/machine/link" },
        { type: "url", url: "ws://127.0.0.1:4096/api/experimental/machine/link" },
      ],
    });
    await within(dialog).findByText("Join string");
    expect(within(dialog).getByText(/ships no worker command yet/)).toBeTruthy();
    expect(within(dialog).getByText("Waiting for devbox to connect…")).toBeTruthy();

    fake.connect("devbox");
    await waitFor(() => expect(within(dialog).getByText("devbox is connected")).toBeTruthy(), {
      timeout: 5_000,
    });
    await user.click(within(dialog).getByRole("button", { name: "Done" }));
    await screen.findByText("linux · x64");
    expect(screen.getByText("Connected")).toBeTruthy();
  });

  it("removes a machine only after the in-place confirm", async () => {
    const user = userEvent.setup();
    const fake = fakeServer([{ id: "gpu", online: false, paired: true }]);
    render(<ServerMachines server={server} title="Machines" />, { wrapper });
    await screen.findByText("Offline");

    await user.click(screen.getByRole("button", { name: "Remove gpu" }));
    expect(fake.machine.remove).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Confirm remove gpu" }));
    expect(fake.machine.remove).toHaveBeenCalledWith({ name: "gpu" });
    await screen.findByText(/No machines yet/);
  });
});
