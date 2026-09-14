// @vitest-environment node

import { describe, expect, it } from "vitest";
import { classifyOpenCodeProfile } from "./capabilities";

describe("classifyOpenCodeProfile", () => {
  it("never grants local capabilities to an SSH tunnel, even for a loopback target", () => {
    expect(
      classifyOpenCodeProfile({
        id: "ssh",
        kind: "ssh",
        name: "SSH",
        ssh: { target: "user@127.0.0.1" },
      }),
    ).toMatchObject({
      source: "network-server",
      topology: "remote-machine",
      capabilities: {
        localPathActions: false,
        localFileAttachments: false,
        worktreeCreate: true,
        pty: "persistent",
        scheduledAutomations: false,
        manualAutomations: true,
        integrationCallback: "code",
        pairing: "import-only",
      },
    });
  });

  it("keeps local desktop features enabled for the shared service", () => {
    expect(
      classifyOpenCodeProfile({ id: "local-default", kind: "local", name: "Local OpenCode" }),
    ).toMatchObject({
      source: "shared-service",
      topology: "same-machine",
      capabilities: {
        localPathActions: true,
        localFileAttachments: true,
        scheduledAutomations: true,
        pairing: "show",
      },
    });
  });

  it("disables client-local paths and scheduling for remote servers", () => {
    expect(
      classifyOpenCodeProfile({
        id: "remote",
        kind: "remote",
        name: "Remote",
        urls: ["http://server:4096"],
        credentialID: null,
        allowPlainHttp: true,
        lastSuccessfulUrl: null,
        lastConnectedAt: null,
      }),
    ).toMatchObject({
      source: "network-server",
      topology: "remote-machine",
      capabilities: {
        localPathActions: false,
        localFileAttachments: false,
        worktreeCreate: true,
        pty: "persistent",
        scheduledAutomations: false,
        manualAutomations: true,
      },
    });
  });
});
