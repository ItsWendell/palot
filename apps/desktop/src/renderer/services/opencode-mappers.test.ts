import type { ModelInfo, ProviderInfo, SessionInfo, SessionMessageInfo } from "@opencode/client";
import { describe, expect, it } from "vitest";
import { mapMessage, mapModel, mapProvider, mapSession } from "./opencode-mappers";

describe("OpenCode session mapping", () => {
  it("preserves default, full, and custom session rules without sharing mutable rules", () => {
    const base: SessionInfo = {
      id: "session-permissions",
      projectID: "project-1",
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      time: { created: 1, updated: 2 },
      location: { directory: "/repo" },
    };
    expect(mapSession(base).permissions).toBeUndefined();
    for (const permissions of [
      [],
      [{ action: "*", resource: "*", effect: "allow" as const }],
      [{ action: "shell", resource: "git *", effect: "ask" as const }],
    ]) {
      const mapped = mapSession({ ...base, permissions });
      expect(mapped.permissions).toEqual(permissions);
      expect(mapped.permissions).not.toBe(permissions);
      if (permissions[0]) expect(mapped.permissions?.[0]).not.toBe(permissions[0]);
      // Usage/title updates must not invalidate the thread/composer's permission comparison.
      expect(
        mapSession({ ...base, permissions, time: { ...base.time, updated: 3 } }).permissions,
      ).toBe(mapped.permissions);
    }
  });

  it("preserves mapped identity for structurally shared catalog entries", () => {
    const session = {
      id: "session-stable",
      projectID: "project-1",
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      time: { created: 1, updated: 2 },
      location: { directory: "/repo" },
    } as SessionInfo;

    expect(mapSession(session)).toBe(mapSession(session));
    expect(mapSession({ ...session })).not.toBe(mapSession(session));
  });

  it("preserves staged revert state and file changes", () => {
    const session = {
      id: "session-1",
      projectID: "project-1",
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      time: { created: 1, updated: 2 },
      location: { directory: "/repo" },
      revert: {
        messageID: "message-1",
        snapshot: "snapshot-1",
        files: [
          {
            file: "src/app.ts",
            additions: 1,
            deletions: 1,
            status: "modified",
            patch: "@@",
          },
        ],
      },
    } as SessionInfo;

    expect(mapSession(session).revert).toMatchObject({
      messageID: "message-1",
      snapshot: "snapshot-1",
      files: [{ file: "src/app.ts", additions: 1, deletions: 1 }],
    });
  });
});

describe("OpenCode message mapping", () => {
  it.each(["inline", "uri"] as const)(
    "preserves durable image bytes for %s sources after reload",
    (type) => {
      const message: SessionMessageInfo = {
        id: "screenshot",
        type: "user",
        time: { created: 1 },
        text: "See screenshot",
        files: [
          {
            data: "AAAA",
            mime: "image/png",
            name: "screenshot.png",
            source: type === "inline" ? { type } : { type, uri: "file:///deleted/screenshot.png" },
          },
        ],
      };
      expect(mapMessage(JSON.parse(JSON.stringify(message))).files?.[0]?.previewDataUrl).toBe(
        "data:image/png;base64,AAAA",
      );
    },
  );

  it.each([
    ["image/svg+xml", "AAAA"],
    ["text/html", "AAAA"],
    ["image/png", ""],
    ["image/png", "data:image/png;base64,AAAA"],
    ["image/png", "https://example.com/a.png"],
    ["image/png", "A==="],
    ["image/png", "AAA"],
    ["image/png", "AA A"],
    ["image/png", "A".repeat(Math.ceil((20 * 1024 * 1024) / 3) * 4)],
  ])("omits unsafe or oversized image previews (%s)", (mime, data) => {
    const message: SessionMessageInfo = {
      id: "attachment",
      type: "user",
      time: { created: 1 },
      text: "",
      files: [{ mime, data, source: { type: "inline" } }],
    };
    expect(mapMessage(message).files?.[0]?.previewDataUrl).toBeUndefined();
  });

  it("projects user attachments and skill mentions", () => {
    const message: SessionMessageInfo = {
      id: "message-user",
      type: "user",
      time: { created: 10 },
      text: "Review @file with /skill",
      files: [
        {
          data: "",
          mime: "text/plain",
          name: "file.ts",
          source: { type: "uri", uri: "file:///workspace/file.ts" },
          mention: { start: 7, end: 12, text: "@file" },
        },
        {
          data: "ZGF0YQ==",
          mime: "image/png",
          source: { type: "inline" },
        },
      ],
      skills: [
        {
          id: "review",
          name: "Review",
          text: "Review the selected file carefully.",
          mention: { start: 18, end: 24, text: "/skill" },
        },
      ],
    };

    expect(mapMessage(message)).toMatchObject({
      id: "message-user",
      text: "Review @file with /skill",
      files: [
        {
          uri: "opencode-inline:attachment-1",
          name: "Attachment 1",
          mime: "image/png",
          size: null,
        },
      ],
      fileReferences: [
        {
          uri: "file:///workspace/file.ts",
          name: "file.ts",
          mention: { start: 7, end: 12, text: "@file" },
        },
      ],
      skillReferences: [
        {
          id: "review",
          mention: { start: 18, end: 24, text: "/skill" },
          text: "Review the selected file carefully.",
        },
      ],
    });
  });

  it("projects assistant text, reasoning, and tool content", () => {
    const message: SessionMessageInfo = {
      id: "message-assistant",
      type: "assistant",
      time: { created: 20, completed: 30 },
      agent: "build",
      model: { id: "model", providerID: "provider" },
      finish: "tool-calls",
      rawFinish: "tool_calls",
      tokens: { input: 1, output: 2, reasoning: 3, cache: { read: 4, write: 5 } },
      providerState: { responseID: "response" },
      content: [
        { type: "text", text: "Starting", state: { presentation: "preamble" } },
        {
          type: "reasoning",
          text: "Thinking",
          time: { created: 21, completed: 22 },
          state: { presentation: "thought" },
        },
        {
          type: "tool",
          id: "tool",
          name: "read",
          time: { created: 23, ran: 24 },
          state: { status: "running", input: { path: "file.ts" }, metadata: {} },
        },
      ],
    };

    expect(mapMessage(message)).toMatchObject({
      agent: "build",
      model: { id: "model", providerID: "provider" },
      completedAt: 30,
      finish: "tool-calls",
      rawFinish: "tool_calls",
      providerState: { responseID: "response" },
      content: [
        { type: "text", text: "Starting", presentation: "preamble" },
        {
          type: "reasoning",
          text: "Thinking",
          presentation: "thought",
          time: { created: 21, completed: 22 },
        },
        {
          type: "tool",
          id: "tool",
          name: "read",
          time: { created: 23, ran: 24 },
          state: { status: "running", input: { path: "file.ts" }, metadata: {} },
        },
      ],
    });
  });

  it("projects completed and failed compaction messages", () => {
    const completed: SessionMessageInfo = {
      id: "compaction-completed",
      type: "compaction",
      status: "completed",
      reason: "auto",
      model: { id: "claude-sonnet-4", providerID: "anthropic" },
      providerState: { checkpoint: "state-1" },
      summary: "Summary",
      recent: "Recent",
      time: { created: 40 },
    };
    const failed: SessionMessageInfo = {
      id: "compaction-failed",
      type: "compaction",
      status: "failed",
      reason: "manual",
      error: { type: "error", message: "Failed" },
      time: { created: 50 },
    };

    expect(mapMessage(completed)).toMatchObject({
      completedAt: 40,
      model: { id: "claude-sonnet-4", providerID: "anthropic" },
      providerState: { checkpoint: "state-1" },
      content: [
        {
          type: "compaction",
          status: "completed",
          reason: "auto",
          text: "Summary",
          recent: "Recent",
        },
      ],
    });
    expect(mapMessage(failed)).toMatchObject({
      completedAt: 50,
      content: [
        {
          type: "compaction",
          status: "failed",
          reason: "manual",
          text: "",
        },
      ],
    });
  });

  it.each(["completed", "failed"] as const)(
    "keeps %s compaction request usage out of message context tokens",
    (status) => {
      const usage = { input: 1200, output: 100, reasoning: 20, cache: { read: 800, write: 40 } };
      const mapped = mapMessage({
        id: "compaction-usage",
        type: "compaction",
        status,
        reason: "manual",
        time: { created: 50 },
        summary: "Summary",
        recent: "",
        error: { type: "error", message: "Failed" },
        cost: 0,
        tokens: usage,
      });

      expect(mapped.tokens).toBeNull();
      expect(mapped.content[0]).toMatchObject({ cost: 0, tokens: usage });
      if (status === "failed") expect(mapped.content[0]?.error).toBe("Failed");
    },
  );
});

describe("OpenCode model mapping", () => {
  it("preserves provider request-shaping compatibility flags", () => {
    const model = {
      id: "provider/model",
      modelID: "model",
      providerID: "provider",
      name: "Model",
      variants: [],
      limit: { context: 100, output: 10 },
      time: { released: 1 },
      capabilities: { tools: true, input: ["text"], output: ["text"] },
      compatibility: { requireAssistantAfterTool: true, requireReasoning: true },
      cost: { input: 0, output: 0 },
      enabled: true,
      status: "active",
    } as unknown as ModelInfo;

    expect(mapModel(model).compatibility).toEqual({
      requireAssistantAfterTool: true,
      requireReasoning: true,
    });
  });

  it("preserves canonical provider identity for models and providers", () => {
    const model = {
      id: "company-openai/gpt-5",
      modelID: "gpt-5",
      providerID: "company-openai",
      canonical: "openai",
      name: "GPT-5",
      variants: [],
      limit: { context: 100, output: 10 },
      time: { released: 1 },
      capabilities: { tools: true, input: ["text"], output: ["text"] },
      compatibility: {},
      cost: [],
      enabled: true,
      status: "active",
    } as unknown as ModelInfo;
    const provider = {
      id: "company-openai",
      canonical: "openai",
      name: "Company OpenAI",
      activation: "enabled",
      package: "@ai-sdk/openai",
    } as ProviderInfo;

    expect(mapModel(model)).toMatchObject({
      providerID: "company-openai",
      canonicalProviderID: "openai",
    });
    expect(mapProvider(provider)).toMatchObject({ id: "company-openai", canonicalID: "openai" });
  });
});
