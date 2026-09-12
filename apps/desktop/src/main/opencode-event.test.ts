import { describe, expect, it } from "vitest";
import type { PermissionAsked } from "@opencode/client";
import { mapEvent } from "./opencode-runtime";

describe("mapEvent", () => {
  it("preserves the exact official event envelope", () => {
    const event: PermissionAsked = {
      id: "event-1",
      created: 10,
      type: "permission.asked",
      location: { directory: "/repo", workspaceID: "workspace-1" },
      metadata: { source: "server" },
      data: {
        id: "permission-1",
        sessionID: "session-1",
        action: "shell",
        resources: ["bun test"],
      },
    };

    expect(structuredClone(mapEvent(event))).toEqual({
      id: "event-1",
      created: 10,
      createdAt: 10,
      type: "permission.asked",
      location: { directory: "/repo", workspaceID: "workspace-1" },
      metadata: { source: "server" },
      data: {
        id: "permission-1",
        sessionID: "session-1",
        action: "shell",
        resources: ["bun test"],
      },
    });
  });
});
