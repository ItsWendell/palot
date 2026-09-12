import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { ConnectionBadge } from "./connection-badge";

afterEach(cleanup);
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
