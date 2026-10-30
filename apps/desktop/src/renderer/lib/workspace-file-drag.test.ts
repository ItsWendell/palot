import { expect, it } from "vitest";
import { parseWorkspaceFileDrop } from "./workspace-file-drag";
it("only accepts files belonging to the composer's connection and location", () => {
  const raw = JSON.stringify({
    profileID: "one",
    directory: "/repo",
    workspaceID: "ws",
    path: "src/a.ts",
  });
  expect(parseWorkspaceFileDrop(raw, "one", "/repo", "ws")).toBe("src/a.ts");
  expect(parseWorkspaceFileDrop(raw, "two", "/repo", "ws")).toBeNull();
  expect(parseWorkspaceFileDrop(raw, "one", "/other", "ws")).toBeNull();
  expect(parseWorkspaceFileDrop(raw, "one", "/repo", "other")).toBeNull();
  expect(
    parseWorkspaceFileDrop(raw.replace("src/a.ts", "../secret"), "one", "/repo", "ws"),
  ).toBeNull();
  expect(parseWorkspaceFileDrop("null", "one", "/repo")).toBeNull();
});
