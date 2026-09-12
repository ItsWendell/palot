import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { WorkbenchTab } from "../../lib/workbench-tabs";
import { FileDiffTab } from "./file-diff-tab";

const mocks = vi.hoisted(() => ({
  query: {
    isPending: true,
    isError: false,
    error: new Error("bad ref"),
    data: [] as { file: string; patch: string; additions: number; deletions: number }[],
    refetch: vi.fn(),
    reviewBase: {
      ref: null as string | null,
      manual: null as string | null,
      inferred: {
        isPending: false,
        isError: false,
        error: new Error("offline"),
        data: null,
        refetch: vi.fn(),
      },
    },
  },
  setManual: vi.fn(),
}));
vi.mock("../../hooks/use-location-diffs", () => ({ useLocationDiffs: () => mocks.query }));
vi.mock("../../hooks/use-vcs-info", () => ({
  useReviewBase: () => ({ ...mocks.query.reviewBase, setManual: mocks.setManual }),
  useVcsBranches: () => ({ data: ["release"], isSuccess: true }),
}));
vi.mock("../file-diff-view", () => ({
  FileDiffView: ({ patch }: { patch: string }) => <pre>{patch}</pre>,
}));
const tab: Extract<WorkbenchTab, { kind: "file-diff" }> = {
  id: "diff",
  kind: "file-diff",
  pinned: false,
  resource: { profileID: "local", location: { directory: "/repo" }, path: "a.txt", mode: "branch" },
};
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.query.isPending = true;
  mocks.query.isError = false;
  mocks.query.data = [];
  mocks.query.reviewBase.ref = null;
  mocks.query.reviewBase.manual = null;
  mocks.query.reviewBase.inferred.isPending = false;
  mocks.query.reviewBase.inferred.isError = false;
});

it("explains null inference instead of displaying an endless diff spinner and permits manual selection", async () => {
  render(<FileDiffTab tab={tab} />);
  expect(screen.getByRole("status").textContent).toContain("No unambiguous base");
  expect(screen.queryByText("Loading diff")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Review base: Choose base" }));
  fireEvent.click(await screen.findByRole("button", { name: "release" }));
  expect(mocks.setManual).toHaveBeenCalledWith("release");
});

it("distinguishes inference loading and failure, with an inference retry", () => {
  mocks.query.reviewBase.inferred.isPending = true;
  const { rerender } = render(<FileDiffTab tab={tab} />);
  expect(screen.getByRole("status").textContent).toContain("Finding review base");
  mocks.query.reviewBase.inferred.isPending = false;
  mocks.query.reviewBase.inferred.isError = true;
  rerender(<FileDiffTab tab={tab} />);
  expect(screen.getByRole("alert").textContent).toContain("offline");
  fireEvent.click(screen.getByRole("button", { name: "Retry base" }));
  expect(mocks.query.reviewBase.inferred.refetch).toHaveBeenCalledOnce();
});

it("keeps the picker available through diff loading, request failure, missing file and success", () => {
  mocks.query.reviewBase.ref = "release";
  mocks.query.reviewBase.manual = "release";
  const { rerender } = render(<FileDiffTab tab={tab} />);
  expect(screen.getByText("Loading diff")).toBeTruthy();
  mocks.query.isPending = false;
  mocks.query.isError = true;
  rerender(<FileDiffTab tab={tab} />);
  expect(screen.getByText("bad ref")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /^Retry$/ }));
  expect(mocks.query.refetch).toHaveBeenCalledOnce();
  mocks.query.isError = false;
  rerender(<FileDiffTab tab={tab} />);
  expect(screen.getByText("Diff unavailable")).toBeTruthy();
  mocks.query.data = [{ file: "a.txt", patch: "selected base patch", additions: 1, deletions: 0 }];
  rerender(<FileDiffTab tab={tab} />);
  expect(screen.getByText("selected base patch")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Review base: release" })).toBeTruthy();
});

it("does not gate working diffs on branch inference", () => {
  render(<FileDiffTab tab={{ ...tab, resource: { ...tab.resource, mode: "working" } }} />);
  expect(screen.getByText("Loading diff")).toBeTruthy();
  expect(screen.queryByRole("button", { name: /Review base:/ })).toBeNull();
});
