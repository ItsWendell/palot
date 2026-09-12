import type { FileContents } from "@pierre/diffs";
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { WorkbenchTab } from "../../lib/workbench-tabs";
import { FileTab } from "./file-tab";

const mocks = vi.hoisted(() => ({
  file: vi.fn((_props: { file: FileContents }) => null),
  query: { data: new TextEncoder().encode("const value = 1;\n"), isPending: false },
}));

vi.mock("@pierre/diffs/react", () => ({ File: mocks.file }));
vi.mock("../../hooks/use-workspace-file", () => ({ useWorkspaceFile: () => mocks.query }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it("keeps worker caching available across navigation and invalidates it after a file refresh", () => {
  const tab: Extract<WorkbenchTab, { kind: "file" }> = {
    id: "file-tab",
    pinned: false,
    kind: "file",
    resource: { profileID: "profile-1", location: { directory: "/repo" }, path: "src/a.ts" },
  };
  const { rerender } = render(<FileTab tab={tab} />);
  const first = mocks.file.mock.lastCall![0].file;
  expect(first.cacheKey).toEqual(expect.any(String));
  expect(first.contents).toBe("const value = 1;\n");

  rerender(<FileTab tab={{ ...tab, resource: { ...tab.resource, line: 2 } }} />);
  expect(mocks.file.mock.lastCall![0].file.cacheKey).toBe(first.cacheKey);

  mocks.query.data = new TextEncoder().encode("const value = 2;\n");
  rerender(<FileTab tab={tab} />);
  const refreshed = mocks.file.mock.lastCall![0].file;
  expect(refreshed.contents).toBe("const value = 2;\n");
  expect(refreshed.cacheKey).not.toBe(first.cacheKey);

  rerender(<FileTab tab={{ ...tab, resource: { ...tab.resource, path: "src/a.txt" } }} />);
  expect(mocks.file.mock.lastCall![0].file.cacheKey).not.toBe(refreshed.cacheKey);
});
