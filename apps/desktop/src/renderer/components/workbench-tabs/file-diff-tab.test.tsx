import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { resolveFileDiff } from "../../lib/file-diffs";
import type { WorkbenchTab } from "../../lib/workbench-tabs";
import type { FileDiffFindTarget } from "../file-diff-view";
import { useTaskViewShortcuts } from "../transcript-find";
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
vi.mock("../file-diff-view", () => ({ FileDiffView }));
/** Hands Find the parsed diff, as the real view does once it renders. */
function FileDiffView({
  file,
  patch,
  onFindTargetChange,
}: {
  file: string;
  patch: string;
  onFindTargetChange?(target: FileDiffFindTarget): void;
}) {
  useEffect(
    () => onFindTargetChange?.({ fileDiff: resolveFileDiff({ file, patch }), scroller: null }),
    [file, onFindTargetChange, patch],
  );
  return (
    <pre tabIndex={0} aria-label={`Diff contents for ${file}`}>
      {patch}
    </pre>
  );
}
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

function TranscriptHarness({ onFind }: { onFind(): void }) {
  useTaskViewShortcuts({ onFind, onTurn: () => {}, onJump: () => {} });
  return (
    <div data-palot-task-view="">
      <button type="button">Transcript</button>
    </div>
  );
}

it("finds and steps through diff matches without taking the transcript's Mod+F", async () => {
  mocks.query.isPending = false;
  mocks.query.data = [
    {
      file: "a.txt",
      additions: 1,
      deletions: 1,
      patch: [
        "--- a/a.txt",
        "+++ b/a.txt",
        "@@ -1,2 +1,2 @@",
        " const widget = 1;",
        "-useWidget(widget);",
        "+render(widget);",
      ].join("\n"),
    },
  ];
  const transcriptFind = vi.fn();
  render(
    <>
      <TranscriptHarness onFind={transcriptFind} />
      <section data-workbench-pane="right">
        <FileDiffTab tab={{ ...tab, resource: { ...tab.resource, mode: "working" } }} />
      </section>
    </>,
  );
  const findKey = { key: "f", code: "KeyF", ctrlKey: true };

  // Mod+F in the transcript stays with Find in task.
  expect(fireEvent.keyDown(screen.getByRole("button", { name: "Transcript" }), findKey)).toBe(
    false,
  );
  expect(transcriptFind).toHaveBeenCalledOnce();
  expect(screen.queryByRole("textbox", { name: "Find in diff" })).toBeNull();

  // Mod+F inside the diff tab opens Find in diff instead.
  expect(fireEvent.keyDown(screen.getByLabelText("Diff contents for a.txt"), findKey)).toBe(false);
  expect(transcriptFind).toHaveBeenCalledOnce();
  const input = screen.getByRole("textbox", { name: "Find in diff" });
  const status = () => screen.getByRole("status").textContent;

  await act(async () => {
    fireEvent.change(input, { target: { value: "widget" } });
  });
  await waitFor(() => expect(status()).toBe("1 of 4"));
  fireEvent.keyDown(input, { key: "Enter" });
  expect(status()).toBe("2 of 4");
  fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
  fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
  expect(status()).toBe("4 of 4");

  await act(async () => {
    fireEvent.change(input, { target: { value: "missing" } });
  });
  await waitFor(() => expect(status()).toBe("No results"));

  fireEvent.keyDown(input, { key: "Escape" });
  expect(screen.queryByRole("search", { name: "Find in diff" })).toBeNull();
});
