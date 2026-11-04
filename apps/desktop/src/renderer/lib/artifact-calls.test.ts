import { describe, expect, it } from "vitest";
import type { ArtifactInfo } from "@opencode/client";
import type { JsonValue, PalotMessageContent } from "../../shared";
import {
  artifactDestination,
  artifactKind,
  matchArtifact,
  projectArtifactCalls,
} from "./artifact-calls";

const ID = "art_019a3b2c4d5eAbCdEfGhIjKlMn";
const OTHER = "art_019a3b2c4d5fZyXwVuTsRqPoNm";
const THIRD = "art_019a3b2c4d60QwErTyUiOpAsDf";
const view = (id: string) => `/api/experimental/artifacts/${id}/view/`;

function tool(
  name: string,
  input: Record<string, JsonValue>,
  state: Record<string, JsonValue> = {},
): PalotMessageContent {
  return {
    type: "tool",
    id: `${name}-1`,
    name,
    state: { status: "completed", input, ...state },
  };
}

function text(value: string): JsonValue {
  return [{ type: "text", text: value }];
}

describe("artifact tool calls", () => {
  it("reads a Code Mode publish from the artifact the program returned", () => {
    const info = {
      id: ID,
      provider: "local",
      sessionID: "ses_1",
      title: "Flamegraph report",
      entry: "index.html",
      url: view(ID),
      time: { created: 10, updated: 20 },
    };
    const part = tool(
      "execute",
      { code: "return await tools.opencode.artifact_create({...})" },
      {
        content: text(JSON.stringify(info, null, 2)),
        metadata: {
          toolCalls: [
            {
              tool: "opencode.artifact_create",
              status: "completed",
              input: { title: "Flamegraph report", files: { "index.html": "<h1>v1</h1>" } },
            },
          ],
        },
      },
    );

    expect(projectArtifactCalls(part, 0)).toEqual({
      only: true,
      calls: [
        {
          key: "execute-1:0",
          operation: "create",
          status: "complete",
          id: ID,
          title: "Flamegraph report",
          url: view(ID),
          entry: "index.html",
          provider: "local",
          updatedAt: 20,
          error: null,
          settledAt: null,
        },
      ],
    });
    expect(projectArtifactCalls(part, 0)).toBe(projectArtifactCalls(part, 0));
  });

  it("pairs several calls with returned records and keeps other tools' rows", () => {
    const part = tool(
      "execute",
      { code: "..." },
      {
        content: text(
          JSON.stringify({
            notes: { info: { id: OTHER, title: "Notes", url: view(OTHER), entry: "index.md" } },
            updated: { id: ID, title: "Report v2", url: view(ID), time: { updated: 30 } },
          }),
        ),
        metadata: {
          toolCalls: [
            { tool: "read", status: "completed", input: { path: "a.ts" } },
            { tool: "opencode.artifact_read", status: "completed", input: { id: OTHER } },
            {
              tool: "opencode.artifact_update",
              status: "completed",
              input: { id: ID, files: { "index.html": "<h1>v2</h1>" } },
            },
          ],
        },
      },
    );
    const projected = projectArtifactCalls(part, 0)!;

    expect(projected.only).toBe(false);
    expect(projected.calls).toMatchObject([
      { key: "execute-1:1", operation: "read", id: OTHER, title: "Notes", entry: "index.md" },
      { key: "execute-1:2", operation: "update", id: ID, title: "Report v2", updatedAt: 30 },
    ]);
  });

  it("keeps the input title and entry when the program returned nothing usable", () => {
    const projected = projectArtifactCalls(
      tool(
        "execute",
        { code: "await tools.opencode.artifact_create({...}); return 'done'" },
        {
          content: text("done"),
          metadata: {
            toolCalls: [
              {
                tool: "opencode.artifact_create",
                status: "completed",
                input: { title: "  Notes  ", files: { "notes.md": "# Notes" } },
              },
            ],
          },
        },
      ),
      0,
    );

    expect(projected?.calls[0]).toMatchObject({
      id: null,
      title: "Notes",
      url: null,
      entry: "notes.md",
    });
  });

  it("marks a call that never settled as failed with the program's error", () => {
    const projected = projectArtifactCalls(
      tool(
        "execute",
        { code: "..." },
        {
          status: "error",
          error: { message: "Artifacts are disabled; set experimental.artifacts in config" },
          metadata: {
            error: true,
            toolCalls: [{ tool: "opencode.artifact_create", status: "running", input: {} }],
          },
        },
      ),
      0,
    );
    expect(projected?.calls[0]).toMatchObject({
      status: "error",
      error: "Artifacts are disabled; set experimental.artifacts in config",
    });

    const running = projectArtifactCalls(
      tool(
        "execute",
        { code: "..." },
        {
          status: "running",
          metadata: {
            toolCalls: [{ tool: "opencode.artifact_update", status: "running", input: { id: ID } }],
          },
        },
      ),
      0,
    );
    expect(running?.calls[0]).toMatchObject({ status: "running", id: ID });
  });

  it("parses the direct tools' summary lines when Code Mode is off", () => {
    expect(
      projectArtifactCalls(
        tool(
          "opencode_artifact_create",
          { title: "Report", files: { "index.html": "" }, provider: "local" },
          { content: text(`Published Report (with notes) (${ID} via local): ${view(ID)}`) },
        ),
        0,
      )?.calls[0],
    ).toMatchObject({
      operation: "create",
      id: ID,
      title: "Report (with notes)",
      provider: "local",
      url: view(ID),
      entry: "index.html",
    });
    expect(
      projectArtifactCalls(
        tool(
          "opencode_artifact_update",
          { id: ID, files: {} },
          { content: text(`Updated Report (${ID}): https://cf.example.test/${ID}/`) },
        ),
        0,
      )?.calls[0],
    ).toMatchObject({ operation: "update", url: `https://cf.example.test/${ID}/` });
    expect(
      projectArtifactCalls(
        tool("opencode_artifact_delete", { id: ID }, { content: text(`Deleted ${ID}`) }),
        0,
      )?.calls[0],
    ).toMatchObject({ operation: "delete", id: ID });
    expect(
      projectArtifactCalls(
        tool(
          "opencode_artifact_create",
          { title: "Report", files: {} },
          { status: "error", error: { message: "Artifact must include at least one file" } },
        ),
        0,
      )?.calls[0],
    ).toMatchObject({ status: "error", error: "Artifact must include at least one file" });
  });

  it("ignores unrelated tools and execute programs without artifact calls", () => {
    expect(projectArtifactCalls(tool("read", { path: "a" }), 0)).toBeNull();
    expect(
      projectArtifactCalls(
        tool(
          "execute",
          { code: "return 1" },
          {
            metadata: { toolCalls: [{ tool: "artifact_create_mirror", status: "completed" }] },
          },
        ),
        0,
      ),
    ).toBeNull();
  });
});

describe("artifact presentation", () => {
  const listed = (id: string, title: string, updated: number) =>
    ({
      id,
      sessionID: "ses_1",
      title,
      provider: "local",
      entry: "index.html",
      url: view(id),
      time: { created: 1, updated },
    }) as ArtifactInfo;

  it("finds the current record by ID, or the task's newest one with the published title", () => {
    const list = [
      { ...listed(THIRD, "Report", 40), sessionID: "ses_other" },
      listed(OTHER, "Report", 30),
      { ...listed(ID, "Report", 20), sessionID: "ses_other" },
    ];
    // An update from another task moves the artifact there; its ID still finds it.
    const find = (call: Parameters<typeof matchArtifact>[0]) =>
      matchArtifact(call, list, "ses_1")?.id;
    expect(find({ id: ID, title: "Old", operation: "update" })).toBe(ID);
    expect(find({ id: null, title: "Report", operation: "create" })).toBe(OTHER);
    expect(find({ id: null, title: "Report", operation: "read" })).toBeUndefined();
    expect(matchArtifact({ id: ID, title: null, operation: "create" }, [], "ses_1")).toBe(
      undefined,
    );
  });

  it("names the entry's kind", () => {
    expect(artifactKind("index.html")).toBe("HTML");
    expect(artifactKind("docs/README.md")).toBe("Markdown");
    expect(artifactKind("chart.svg")).toBe("SVG");
    expect(artifactKind("Makefile")).toBe("Artifact");
    expect(artifactKind(null)).toBe("Artifact");
  });

  it("opens only OpenCode's view route or a provider's plain web page", () => {
    expect(artifactDestination(view(ID))).toEqual({ kind: "hosted" });
    expect(artifactDestination(`https://cf.example.test/${ID}/`)).toEqual({
      kind: "web",
      url: `https://cf.example.test/${ID}/`,
    });
    expect(artifactDestination("/api/session")).toBeNull();
    expect(artifactDestination("javascript:alert(1)")).toBeNull();
    expect(artifactDestination("https://user:secret@cf.example.test/")).toBeNull();
    expect(artifactDestination(`file:///tmp/${ID}/index.html`)).toBeNull();
    expect(artifactDestination(null)).toBeNull();
  });
});
