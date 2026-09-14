import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it } from "vitest";
import { ConnectionBadge } from "./connection-badge";

afterEach(cleanup);
it("keeps the server name out of icon-only rows and exposes safe details on hover and focus", async () => {
  render(
    <ConnectionBadge
      profile={{
        id: "remote",
        kind: "remote",
        name: "Build server",
        urls: ["https://user:secret@host.example:3000/private?token=secret"],
        credentialID: null,
        allowPlainHttp: false,
        lastSuccessfulUrl: null,
        lastConnectedAt: null,
      }}
      connected={false}
      iconOnly
    />,
  );
  const icon = screen.getByRole("img", { name: "Build server · host.example:3000 · Disconnected" });
  expect(screen.queryByText("Build server")).toBeNull();
  await userEvent.hover(icon);
  const label = "Build server · host.example:3000 · Disconnected";
  expect(await screen.findByText(label)).toBeTruthy();
  expect(document.body.innerHTML).not.toContain("secret");
  await userEvent.unhover(icon);
  await waitFor(() => expect(screen.queryByText(label)).toBeNull());
  await userEvent.tab();
  expect(document.activeElement).toBe(icon);
  expect(await screen.findByText(label)).toBeTruthy();
});
it("exposes the full SSH identity and connection state without relying on color", () => {
  render(
    <ConnectionBadge
      profile={{
        id: "ssh",
        kind: "ssh",
        name: "Build server",
        ssh: { target: "builder@host.example", port: 2222 },
      }}
      connected={false}
    />,
  );
  expect(
    screen.getByRole("img", { name: "Build server · builder@host.example:2222 · Disconnected" }),
  ).toBeTruthy();
  expect(screen.getByText("Build server")).toBeTruthy();
});
it("does not expose URL credentials in a remote badge", () => {
  render(
    <ConnectionBadge
      profile={{
        id: "remote",
        kind: "remote",
        name: "Remote",
        urls: ["https://user:secret@host.example:3000/path?token=secret"],
        credentialID: null,
        allowPlainHttp: false,
        lastSuccessfulUrl: null,
        lastConnectedAt: null,
      }}
      connected
    />,
  );
  expect(screen.getByRole("img", { name: "Remote · host.example:3000 · Connected" })).toBeTruthy();
  expect(document.body.textContent).not.toContain("secret");
});
