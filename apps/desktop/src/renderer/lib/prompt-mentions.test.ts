import { describe, expect, it } from "vitest";
import { absoluteFileUri, promptMentionParts } from "./prompt-mentions";

describe("prompt mentions", () => {
  it("encodes absolute POSIX and Windows reference directories as file URIs", () => {
    expect(absoluteFileUri("/refs/my docs")).toBe("file:///refs/my%20docs");
    expect(absoluteFileUri("C:\\refs\\docs")).toBe("file:///C:/refs/docs");
    expect(() => absoluteFileUri("refs/docs")).toThrow("absolute");
  });

  it("projects references as file parts and subagents as agent parts", () => {
    const mention = { start: 0, end: 5, text: "@docs" };
    expect(
      promptMentionParts({
        directoryReferences: [{ name: "docs", path: "/refs/docs", mention }],
        agentReferences: [{ name: "explore", mention: { start: 6, end: 14, text: "@explore" } }],
      }),
    ).toEqual({
      files: [{ uri: "file:///refs/docs", name: "docs", mention }],
      agents: [{ name: "explore", mention: { start: 6, end: 14, text: "@explore" } }],
    });
  });
});
