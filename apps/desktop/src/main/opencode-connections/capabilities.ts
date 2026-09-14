import type {
  OpenCodeProfile,
  OpenCodeRuntimeCapabilities,
  OpenCodeRuntimeSource,
  OpenCodeRuntimeTopology,
} from "../../shared";

export interface OpenCodeRuntimeClassification {
  source: OpenCodeRuntimeSource;
  topology: OpenCodeRuntimeTopology;
  capabilities: OpenCodeRuntimeCapabilities;
}

export function classifyOpenCodeProfile(profile: OpenCodeProfile): OpenCodeRuntimeClassification {
  if (profile.kind === "remote" || profile.kind === "ssh") {
    return {
      source: "network-server",
      topology: "remote-machine",
      capabilities: {
        serverFilesystem: true,
        localPathActions: false,
        localFileAttachments: false,
        worktreeCreate: true,
        pty: "persistent",
        scheduledAutomations: false,
        manualAutomations: true,
        integrationCallback: "code",
        pairing: "import-only",
      },
    };
  }
  return {
    source: "shared-service",
    topology: "same-machine",
    capabilities: {
      serverFilesystem: true,
      localPathActions: true,
      localFileAttachments: true,
      worktreeCreate: true,
      pty: "persistent",
      scheduledAutomations: true,
      manualAutomations: true,
      integrationCallback: "local",
      pairing: "show",
    },
  };
}
