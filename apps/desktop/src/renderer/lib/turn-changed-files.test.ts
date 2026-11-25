import { describe, expect, it } from "vitest";
import type { JsonValue, PalotMessage } from "../../shared";
import { turnChangedFiles } from "./turn-changed-files";

function step(data: JsonValue, type = "assistant"): Pick<PalotMessage, "type" | "data"> {
  return { type, data };
}

describe("turnChangedFiles", () => {
  it("unions the steps' snapshot files in first-seen order", () => {
    expect(
      turnChangedFiles([
        step({ text: "Fix it" }, "user"),
        step({ snapshot: { start: "s1", end: "s2", files: ["src/b.ts", "src/a.ts"] } }),
        step({ snapshot: { start: "s2", end: "s3", files: ["src/a.ts", "README.md"] } }),
        step({ snapshot: { start: "s3", end: "s4", files: ["src/b.ts"] } }),
      ]),
    ).toEqual(["src/b.ts", "src/a.ts", "README.md"]);
  });

  it("returns nothing when no step recorded snapshot files", () => {
    expect(turnChangedFiles([])).toEqual([]);
    expect(
      turnChangedFiles([
        step({}),
        step({ snapshot: { start: "s1" } }),
        step({ snapshot: { start: "s1", end: "s1", files: [] } }),
      ]),
    ).toEqual([]);
  });

  it("ignores malformed data and non-assistant messages", () => {
    expect(
      turnChangedFiles([
        step(null),
        step("snapshot"),
        step([{ snapshot: { files: ["array.ts"] } }]),
        step({ snapshot: null }),
        step({ snapshot: { files: "src/a.ts" } }),
        step({ snapshot: { files: [1, null, "", { path: "x" }, "kept.ts"] } }),
        step({ snapshot: { files: ["user.ts"] } }, "user"),
      ]),
    ).toEqual(["kept.ts"]);
  });
});
