import type { PermissionRequest } from "@opencode/client";
import { describe, expect, it } from "vitest";
import type { PalotMessage } from "../../shared";
import { permissionPreview } from "./permission-presentation";

const request: PermissionRequest = {
  id: "p",
  sessionID: "s",
  action: "edit",
  resources: ["a.ts"],
  source: { type: "tool", messageID: "m", id: "t" },
};
describe("permission previews", () => {
  it("resolves the exact tool source and lets request metadata override tool metadata", () => {
    const messages: PalotMessage[] = [
      {
        id: "m",
        type: "assistant",
        createdAt: 1,
        completedAt: null,
        text: null,
        agent: null,
        model: null,
        tokens: null,
        finish: null,
        data: {},
        content: [
          { type: "tool", id: "wrong", state: { input: { command: "wrong" } } },
          {
            type: "tool",
            id: "t",
            state: {
              status: "running",
              input: { path: "src/a.ts" },
              metadata: { diff: "tool diff" },
            },
          },
        ],
      },
    ];
    expect(
      permissionPreview({ ...request, metadata: { diff: "request diff" } }, messages),
    ).toMatchObject({ file: "src/a.ts", patch: "request diff" });
  });
  it("degrades safely without source history and bounds untrusted previews", () => {
    expect(permissionPreview({ ...request, action: "shell" }, []).text).toBe("a.ts");
    const result = permissionPreview({ ...request, metadata: { diff: "x".repeat(30_000) } }, []);
    expect(result.text).toHaveLength(24_000);
    expect(result.truncated).toBe(true);
    expect(result.patch).toBeUndefined();
  });
});
