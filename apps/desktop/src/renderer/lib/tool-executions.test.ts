import { describe, expect, it } from "vitest";
import type { JsonValue, PalotMessageContent } from "../../shared";
import {
  createStreamingPatchInputState,
  getStreamingPatchLine,
  getStreamingPatchLineCount,
  streamPatchInput,
} from "./streaming-patch-input";
import {
  classifyShellCommand,
  parsePatchTargetFiles,
  projectToolExecution,
  readableToolName,
} from "./tool-executions";

function tool(
  name: string,
  input: Record<string, JsonValue>,
  content: string,
  metadata: Record<string, JsonValue> = {},
): PalotMessageContent {
  return {
    type: "tool",
    id: `${name}-1`,
    name,
    state: {
      status: "completed",
      input,
      content: [{ type: "text", text: content }],
      metadata,
    },
  };
}

describe("projectToolExecution", () => {
  it("reuses a projection for the same immutable tool part and index", () => {
    const part = tool("shell", { command: "printf test" }, "test");

    expect(projectToolExecution(part, 3)).toBe(projectToolExecution(part, 3));
    expect(projectToolExecution(part, 4)).not.toBe(projectToolExecution(part, 3));
    expect(projectToolExecution({ ...part }, 3)).not.toBe(projectToolExecution(part, 3));
  });

  it("normalizes OpenCode's complete status", () => {
    const part: PalotMessageContent = {
      type: "tool",
      id: "read-1",
      name: "read",
      state: { status: "complete", input: { path: "src/a.ts" } },
    };

    expect(projectToolExecution(part, 0).status).toBe("complete");
  });

  it("parses native grep output into file and line matches", () => {
    const view = projectToolExecution(
      tool(
        "grep",
        { pattern: "ToolRow", path: "apps/desktop/src" },
        "Found 2 matches\napps/desktop/src/thread.tsx:\n  Line 10: function ToolRow()\n  Line 24: <ToolRow />",
        { matches: 2, truncated: false },
      ),
      0,
    );

    expect(view).toMatchObject({
      kind: "search",
      engine: "grep",
      query: "ToolRow",
      count: 2,
      matches: [
        { file: "apps/desktop/src/thread.tsx", line: 10, text: "function ToolRow()" },
        { file: "apps/desktop/src/thread.tsx", line: 24, text: "<ToolRow />" },
      ],
    });
  });

  it("parses glob output as file results", () => {
    const view = projectToolExecution(
      tool("glob", { pattern: "**/*.tsx" }, "src/a.tsx\nsrc/b.tsx", { count: 2 }),
      0,
    );

    expect(view).toMatchObject({
      kind: "search",
      engine: "glob",
      count: 2,
      files: ["src/a.tsx", "src/b.tsx"],
    });
  });

  it("projects built-in directory listings", () => {
    expect(
      projectToolExecution(tool("list", { path: "src/components" }, "a.tsx\nb.tsx"), 0),
    ).toMatchObject({
      kind: "list",
      path: "src/components",
      entries: ["a.tsx", "b.tsx"],
    });
  });

  it("projects built-in websearch results", () => {
    const view = projectToolExecution(
      tool(
        "websearch",
        { query: "OpenCode V2 release" },
        [
          "## [OpenCode V2](https://opencode.ai/v2)",
          "Published: 2026-08-10T12:00:00.000Z",
          "",
          "The current OpenCode documentation.",
          "",
          "## [GitHub](https://github.com/anomalyco/opencode)",
          "",
          "OpenCode source repository.",
        ].join("\n"),
        { provider: "exa" },
      ),
      0,
    );

    expect(view).toMatchObject({
      kind: "web-search",
      query: "OpenCode V2 release",
      provider: "exa",
      results: [
        {
          url: "https://opencode.ai/v2",
          title: "OpenCode V2",
          content: "The current OpenCode documentation.",
          publishedAt: Date.parse("2026-08-10T12:00:00.000Z"),
        },
        {
          url: "https://github.com/anomalyco/opencode",
          title: "GitHub",
          content: "OpenCode source repository.",
        },
      ],
    });
  });

  it("projects provider-native structured web search results", () => {
    const part = tool("web_search", { action: { query: "current news" } }, "");
    part.providerResultState = {
      type: "web_search_tool_result",
      content: [
        {
          type: "web_search_result",
          url: "https://example.com/news",
          title: "Current news",
          content: "A current result.",
        },
      ],
    };

    expect(projectToolExecution(part, 0)).toMatchObject({
      kind: "web-search",
      query: "current news",
      results: [
        {
          url: "https://example.com/news",
          title: "Current news",
          content: "A current result.",
        },
      ],
    });
  });

  it("projects webfetch URL, format, and output", () => {
    expect(
      projectToolExecution(
        tool(
          "webfetch",
          { url: "https://opencode.ai/v2/docs/", format: "markdown" },
          "# OpenCode V2",
        ),
        0,
      ),
    ).toMatchObject({
      kind: "web-fetch",
      url: "https://opencode.ai/v2/docs/",
      format: "markdown",
      output: "# OpenCode V2",
    });
  });

  it("defaults webfetch output to markdown format", () => {
    expect(
      projectToolExecution(tool("webfetch", { url: "https://example.com" }, "**Example**"), 0),
    ).toMatchObject({
      kind: "web-fetch",
      format: "markdown",
    });
  });

  it("parses read ranges and preserves the numbered content", () => {
    const view = projectToolExecution(
      tool("read", { path: "src/a.ts" }, "Read file src/a.ts, lines 12-13\n12: first\n13: second"),
      0,
    );

    expect(view).toMatchObject({
      kind: "read",
      path: "src/a.ts",
      range: { start: 12, end: 13 },
      lines: [
        { number: 12, text: "first" },
        { number: 13, text: "second" },
      ],
    });
  });

  it("projects supported image read attachments", () => {
    const view = projectToolExecution(
      {
        ...tool("read", { path: "screenshots/palot.png" }, "Image read successfully"),
        state: {
          status: "completed",
          input: { path: "screenshots/palot.png" },
          content: [
            { type: "text", text: "Image read successfully" },
            {
              type: "file",
              uri: "data:image/png;base64,AAAA",
              mime: "image/png",
              name: "palot.png",
            },
            {
              type: "file",
              uri: "https://example.com/tracker.png",
              mime: "image/png",
            },
          ],
        },
      },
      0,
    );

    expect(view).toMatchObject({
      kind: "read",
      images: [
        {
          uri: "data:image/png;base64,AAAA",
          mime: "image/png",
          name: "palot.png",
        },
      ],
    });
  });

  it("normalizes current file diff metadata", () => {
    const view = projectToolExecution(
      tool("edit", { path: "src/a.ts" }, "Edited src/a.ts", {
        files: [
          {
            file: "src/a.ts",
            patch: "@@ -1 +1 @@\n-old\n+new",
            additions: 1,
            deletions: 1,
            status: "modified",
          },
        ],
      }),
      0,
    );

    expect(view).toMatchObject({
      kind: "file-change",
      operation: "edit",
      files: [{ file: "src/a.ts", additions: 1, deletions: 1, status: "modified" }],
    });
  });

  it("normalizes legacy patch metadata", () => {
    const view = projectToolExecution(
      tool("patch", { patchText: "*** Begin Patch\n*** End Patch" }, "Patched", {
        files: [
          {
            filePath: "src/a.ts",
            relativePath: "src/a.ts",
            type: "update",
            before: "old\n",
            after: "new\n",
            additions: 1,
            deletions: 1,
          },
        ],
      }),
      0,
    );

    expect(view).toMatchObject({
      kind: "file-change",
      operation: "patch",
      files: [{ file: "src/a.ts", status: "modified", before: "old\n", after: "new\n" }],
    });
  });

  it("projects patch targets before file metadata is available", () => {
    const part: PalotMessageContent = {
      type: "tool",
      id: "patch-1",
      name: "patch",
      state: {
        status: "running",
        input: {
          patchText: [
            "*** Begin Patch",
            "*** Update File: src/a.ts",
            "@@",
            "-old",
            "+new",
            "*** Add File: src/b.ts",
            "+export {};",
            "*** End Patch",
          ].join("\n"),
        },
        metadata: {},
      },
    };

    expect(projectToolExecution(part, 0)).toMatchObject({
      kind: "file-change",
      operation: "patch",
      status: "running",
      files: [],
      targetFiles: ["src/a.ts", "src/b.ts"],
      inputStreaming: false,
      patchDocument: { tail: "*** End Patch" },
    });
  });

  it("projects the full streamed patch and reuses its document without parsing input again", () => {
    const patchText = "*** Begin Patch\n*** Update File: src/a.ts\n@@\n-old\n+new";
    const inputStream = streamPatchInput(
      createStreamingPatchInputState(),
      JSON.stringify({ patchText }).slice(0, -2),
    );
    const part: PalotMessageContent = {
      type: "tool",
      id: "patch-1",
      name: "patch",
      state: {
        status: "streaming",
        input: { patchText },
        inputStream,
        metadata: {},
      },
    };

    const view = projectToolExecution(part, 0);
    expect(view).toMatchObject({
      kind: "file-change",
      status: "running",
      targetFiles: ["src/a.ts"],
      inputStreaming: true,
      patchDocument: { text: patchText, tail: "+new" },
      rawInput: { patchText },
    });
    if (view.kind !== "file-change") throw new Error("Expected file change");
    expect(view.patchDocument).toBe(inputStream.document);
  });

  it("hydrates full patch input and keeps its document reusable across progress updates", () => {
    const expected = [
      "*** Begin Patch",
      "*** Add File: large.ts",
      ...Array.from({ length: 300 }, (_, index) => `+line ${index}`),
      `+${"x".repeat(4_000)}`,
      "*** End Patch",
    ];
    const patchText = expected.join("\n") + "\n";
    const input = { patchText };
    const part = tool("apply_patch", input, "");
    const view = projectToolExecution(part, 0);
    if (view.kind !== "file-change" || !view.patchDocument) throw new Error("Expected patch");
    expect(view.patchDocument.text).toBe(patchText);
    expect(getStreamingPatchLineCount(view.patchDocument)).toBe(expected.length);
    expect(getStreamingPatchLine(view.patchDocument, 302)).toBe(`+${"x".repeat(4_000)}`);
    expect(view.rawInput).toBe(input);
    expect(view.inputStreaming).toBe(false);

    const progress = projectToolExecution(
      { ...part, state: { status: "running", input, metadata: { title: "Applying" } } },
      0,
    );
    if (progress.kind !== "file-change") throw new Error("Expected file change");
    expect(progress.patchDocument).toBe(view.patchDocument);
    expect(progress.targetFiles).toEqual(["large.ts"]);
  });

  it("uses authoritative final input when it extends the last streamed delta", () => {
    const partial = "*** Begin Patch\n*** Update File: old.ts\n";
    const patchText = `${partial}*** Move to: new.ts\n+done\n*** End Patch`;
    const view = projectToolExecution(
      {
        type: "tool",
        name: "patch",
        state: {
          status: "running",
          input: { patchText },
          inputStream: streamPatchInput(
            createStreamingPatchInputState(),
            JSON.stringify({ patchText: partial }).slice(0, -2),
          ),
        },
      },
      0,
    );
    expect(view).toMatchObject({
      kind: "file-change",
      patchDocument: { text: patchText },
      targetFiles: ["old.ts", "new.ts"],
      inputStreaming: false,
    });
  });

  it("uses only the first shell text part as visible output", () => {
    const part: PalotMessageContent = {
      type: "tool",
      id: "shell-1",
      name: "shell",
      time: { created: 900, ran: 1_000, completed: 2_250 },
      state: {
        status: "completed",
        input: { command: "bun run test" },
        content: [
          { type: "text", text: "62 tests passed" },
          { type: "text", text: "Command exited with code 0." },
        ],
        metadata: { exit: 0, truncated: false },
      },
    };

    expect(projectToolExecution(part, 0)).toMatchObject({
      kind: "shell",
      command: "bun run test",
      output: "62 tests passed",
      terminal: null,
      exitCode: 0,
      durationMs: 1_250,
    });
  });

  it("projects ANSI shell output into styled terminal text", () => {
    const view = projectToolExecution(
      tool(
        "shell",
        { command: "bun run test" },
        "\u001b[1m\u001b[32m✓\u001b[39m passed\u001b[22m\n\u001b[31mfailed\u001b[0m",
      ),
      0,
    );

    expect(view).toMatchObject({
      kind: "shell",
      output: "✓ passed\nfailed",
      terminal: [
        { text: "✓", bold: true, color: "rgb(0, 187, 0)" },
        { text: " passed", bold: true },
        { text: "\n" },
        { text: "failed", color: "rgb(187, 0, 0)" },
      ],
    });
  });

  it("projects ANSI shell output from running progress metadata", () => {
    const view = projectToolExecution(
      {
        type: "tool",
        id: "shell-1",
        name: "shell",
        state: {
          status: "running",
          input: { command: "bun run test" },
          metadata: { output: "\u001b[32mfirst\u001b[0m\nsecond" },
        },
      },
      0,
    );

    expect(view).toMatchObject({
      kind: "shell",
      status: "running",
      output: "first\nsecond",
      terminal: [{ text: "first", color: "rgb(0, 187, 0)" }, { text: "\nsecond" }],
    });
  });

  it("prefers final shell content over streamed metadata", () => {
    const part = tool("shell", { command: "bun run test" }, "first\nsecond\ndone", {
      output: "first\nsecond",
      exit: 0,
    });

    expect(projectToolExecution(part, 0)).toMatchObject({
      kind: "shell",
      output: "first\nsecond\ndone",
    });
  });

  it("retains streamed output and the error for failed shell commands", () => {
    const part: PalotMessageContent = {
      type: "tool",
      id: "shell-1",
      name: "shell",
      state: {
        status: "error",
        input: { command: "bun run test" },
        metadata: { output: "first\nfailed assertion", exit: 1 },
        error: "Command exited with code 1",
      },
    };

    expect(projectToolExecution(part, 0)).toMatchObject({
      kind: "shell",
      status: "error",
      output: "first\nfailed assertion",
      error: "Command exited with code 1",
      exitCode: 1,
    });
  });

  it("removes ANSI before parsing shell commands classified as searches", () => {
    expect(
      projectToolExecution(
        tool(
          "shell",
          { command: "rg ToolExecution src" },
          "\u001b[35msrc/tool.ts\u001b[0m:\u001b[32m12\u001b[0m: ToolExecution",
        ),
        0,
      ),
    ).toMatchObject({
      kind: "search",
      rawOutput: "src/tool.ts:12: ToolExecution",
      matches: [{ file: "src/tool.ts", line: 12, text: "ToolExecution" }],
    });
  });

  it("keeps large ANSI output as plain text to avoid excessive terminal spans", () => {
    const line = "\u001b[32m✓ passed\u001b[0m\n";
    const view = projectToolExecution(
      tool("shell", { command: "bun run test" }, line.repeat(20_000)),
      0,
    );

    expect(view).toMatchObject({
      kind: "shell",
      output: "✓ passed\n".repeat(20_000),
      terminal: null,
    });
  });

  it("projects skill names and directories from native OpenCode states", () => {
    const running: PalotMessageContent = {
      type: "tool",
      id: "skill-1",
      name: "skill",
      state: { status: "running", input: { id: "frontend-design" }, metadata: {} },
    };
    const completed = tool(
      "skill",
      { id: "frontend-design" },
      '<skill_content name="frontend-design">instructions</skill_content>',
      { name: "Frontend Design", dir: "/skills/frontend-design" },
    );
    const structured: PalotMessageContent = {
      type: "tool",
      id: "skill-2",
      name: "skill",
      state: {
        status: "completed",
        input: { name: "diagnosing-bugs" },
        structured: { name: "Diagnosing bugs", directory: "/skills/diagnosing-bugs" },
        content: [{ type: "text", text: "Skill instructions" }],
      },
    };

    expect(projectToolExecution(running, 0)).toMatchObject({
      kind: "skill",
      skill: "frontend-design",
      directory: null,
      status: "running",
    });
    expect(projectToolExecution(completed, 0)).toMatchObject({
      kind: "skill",
      skill: "Frontend Design",
      directory: "/skills/frontend-design",
      status: "complete",
    });
    expect(projectToolExecution(structured, 0)).toMatchObject({
      kind: "skill",
      skill: "Diagnosing bugs",
      directory: "/skills/diagnosing-bugs",
      status: "complete",
    });
  });

  it("projects OpenCode task tools as subagent executions", () => {
    const view = projectToolExecution(
      tool(
        "task",
        {
          description: "Explore tool rendering",
          prompt: "Find the renderer path for tool calls.",
          subagent_type: "explore",
          background: true,
        },
        "The renderer uses ToolExecution.",
        { sessionId: "session-child", background: true },
      ),
      0,
    );

    expect(view).toMatchObject({
      kind: "subagent",
      agent: "explore",
      description: "Explore tool rendering",
      prompt: "Find the renderer path for tool calls.",
      sessionID: "session-child",
      background: true,
      rawOutput: "The renderer uses ToolExecution.",
    });
  });

  it("recognizes a foreground subagent promoted to background observation", () => {
    const view = projectToolExecution(
      tool(
        "subagent",
        { description: "Review changes", agent: "general" },
        "The subagent is working in the background.",
        { sessionID: "session-child", status: "running" },
      ),
      0,
    );

    expect(view).toMatchObject({
      kind: "subagent",
      sessionID: "session-child",
      status: "complete",
      background: true,
    });
  });

  it("supports the subagent tool alias", () => {
    expect(
      projectToolExecution(
        tool("subagent", { description: "Review changes", agent: "general" }, "Looks good."),
        0,
      ),
    ).toMatchObject({
      kind: "subagent",
      agent: "general",
      description: "Review changes",
    });
  });

  it("projects execute scripts and nested tool calls", () => {
    expect(
      projectToolExecution(
        tool("execute", { code: "return await tools.fixtures.add({ a: 1, b: 2 })" }, "3", {
          toolCalls: [
            { tool: "fixtures.add", status: "completed", input: { a: 1, b: 2 } },
            { tool: "bad.tool", status: "error", input: { reason: "test" } },
          ],
        }),
        0,
      ),
    ).toMatchObject({
      kind: "execute",
      code: "return await tools.fixtures.add({ a: 1, b: 2 })",
      output: "3",
      calls: [
        { tool: "fixtures.add", title: "Fixtures add", status: "completed", args: ["a=1", "b=2"] },
        { tool: "bad.tool", title: "Bad tool", status: "error", args: ["reason=test"] },
      ],
    });
  });

  it("accepts normalized output and durable structured execute progress", () => {
    const part: PalotMessageContent = {
      type: "tool",
      id: "execute-1",
      name: "execute",
      state: {
        status: "completed",
        input: { code: "return 3" },
        output: "3",
        structured: {
          toolCalls: [{ tool: "fixtures.add", status: "completed" }],
        },
      },
    };

    expect(projectToolExecution(part, 0)).toMatchObject({
      kind: "execute",
      output: "3",
      calls: [{ tool: "fixtures.add", status: "completed" }],
    });
  });

  it("projects code-bearing MCP tools as code executions", () => {
    expect(
      projectToolExecution(
        tool(
          "cloudflare_search",
          { code: "async () => spec.paths" },
          '{"required":["queryId","timeframe"]}',
        ),
        0,
      ),
    ).toMatchObject({
      kind: "execute",
      name: "cloudflare_search",
      code: "async () => spec.paths",
      calls: [],
      output: '{"required":["queryId","timeframe"]}',
    });
  });

  it("creates readable generic tool names and promotes useful input", () => {
    expect(
      projectToolExecution(
        tool(
          "Linear.searchDocumentation",
          { query: "tool projection fallback", page: 2, includeArchived: false },
          "Result",
        ),
        0,
      ),
    ).toMatchObject({
      kind: "generic",
      title: "Linear search documentation",
      label: "tool projection fallback",
      args: ["page=2", "includeArchived=false"],
    });
  });

  it("projects image tools across generation and edit input shapes", () => {
    expect(
      projectToolExecution(
        tool("image_gen", { prompt: "A small red square", quality: "low" }, "Generated"),
        0,
      ),
    ).toMatchObject({
      kind: "image-generation",
      operation: "generate",
      referenceCount: 0,
    });

    expect(
      projectToolExecution(
        tool(
          "tools.media.generate-image",
          {
            description: "Combine the references",
            input_images: ["one.png", "two.jpg"],
            mask: "mask.png",
          },
          "Edited",
        ),
        0,
      ),
    ).toMatchObject({
      kind: "image-generation",
      operation: "edit",
      referenceCount: 2,
    });
  });
});

describe("readableToolName", () => {
  it("humanizes common MCP and plugin tool identifiers", () => {
    expect(readableToolName("linear_create_issue")).toBe("Linear create issue");
    expect(readableToolName("tools.github.getPullRequest")).toBe("Tools github get pull request");
    expect(readableToolName("mcp-search-url")).toBe("MCP search URL");
  });
});

describe("parsePatchTargetFiles", () => {
  it("extracts apply-patch and git patch targets without duplicates", () => {
    expect(
      parsePatchTargetFiles(
        [
          "*** Update File: src/a.ts",
          "*** Move to: src/moved.ts",
          "*** Update File: src/a.ts",
          "diff --git a/src/b.ts b/src/b.ts",
          "Index: src/c.ts",
        ].join("\n"),
      ),
    ).toEqual(["src/a.ts", "src/moved.ts", "src/b.ts", "src/c.ts"]);
  });
});

describe("classifyShellCommand", () => {
  it("classifies simple ripgrep and ast-grep commands", () => {
    expect(classifyShellCommand('rg "ToolRow" apps/desktop/src')).toMatchObject({
      kind: "search",
      engine: "ripgrep",
      query: "ToolRow",
      scope: "apps/desktop/src",
    });
    expect(classifyShellCommand("rg --glob '*.tsx' ToolRow apps/desktop/src")).toMatchObject({
      kind: "search",
      engine: "ripgrep",
      query: "ToolRow",
      scope: "apps/desktop/src",
    });
    expect(classifyShellCommand("ast-grep --lang ts -p 'console.log($A)' src")).toMatchObject({
      kind: "search",
      engine: "ast-grep",
      query: "console.log($A)",
      scope: "src",
    });
    expect(classifyShellCommand("ast-grep --json -p 'console.log($A)' src")).toMatchObject({
      kind: "search",
      engine: "ast-grep",
      query: "console.log($A)",
      scope: "src",
    });
  });

  it("keeps pipelines and compound commands as shell", () => {
    expect(classifyShellCommand('uv pip install --help | rg "user|prefix"')).toEqual({
      kind: "shell",
    });
    expect(classifyShellCommand('result="$(rg ToolRow src)"')).toEqual({ kind: "shell" });
  });
});
