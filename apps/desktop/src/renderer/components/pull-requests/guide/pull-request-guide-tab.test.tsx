import type { SelectedLineRange } from "@pierre/diffs";
import type { FileDiffProps } from "@pierre/diffs/react";
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createStore } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PalotModelCatalog } from "../../../../shared";
import type { ReviewGuide } from "../../../lib/review-guide";
import { saveReviewGuide } from "../../../lib/review-guide-store";
import { generateOpenCodeText } from "../../../services/opencode-generate";
import { pendingReviewAtom } from "../code/pending-review-store";
import { prFile } from "../code/test-support";
import { renderPullRequestsPage } from "../page-test-support";
import { installSourceControl, pullRequestDetail } from "../test-fixtures";

// The excerpt renderer is a stand-in: it draws annotations and lets the test select lines.
let latestOptions: FileDiffProps<unknown, undefined>["options"];
vi.mock("@pierre/diffs/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@pierre/diffs/react")>()),
  FileDiff: (props: FileDiffProps<unknown, undefined>) => {
    latestOptions = props.options;
    return (
      <div data-testid="excerpt-diff">
        {(props.lineAnnotations ?? []).map((annotation) => (
          <div key={`${annotation.side}:${annotation.lineNumber}`}>
            {props.renderAnnotation?.(annotation)}
          </div>
        ))}
      </div>
    );
  },
}));
vi.mock("../../markdown-content", () => ({
  MarkdownContent: ({ value }: { value: string }) => <div>{value}</div>,
}));
vi.mock("../../../services/opencode-generate", () => ({ generateOpenCodeText: vi.fn() }));
let catalog: Partial<PalotModelCatalog> | undefined;
vi.mock("../../../hooks/use-model-catalog", () => ({
  useModelCatalog: () => ({ data: catalog }),
}));
const startTask = vi.fn(async () => {});
vi.mock("../pull-request-actions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../pull-request-actions")>()),
  useStartPullRequestTask: () => startTask,
}));

const generate = vi.mocked(generateOpenCodeText);
const KEY = "github.com/acme/web#7";
const URL = "https://github.com/acme/web/pull/7";
const reply = JSON.stringify({
  stops: [
    {
      title: "The new two",
      summary: "Line two changes.",
      attention: { kind: "contract", note: "Callers now see the new value." },
      excerpts: [{ path: "src/a.ts", side: "new", start: 2, end: 2, caption: "The change" }],
      files: [],
      notes: [{ path: "src/a.ts", line: 2, title: "Why two", body: "Because." }],
      questions: ["Why not keep the old two?"],
    },
  ],
});

function render(options: { headOid?: string } = {}) {
  const store = createStore();
  installSourceControl({
    pullRequestDetail: async (ref) => ({
      ok: true,
      value: pullRequestDetail(ref.number, {
        headOid: options.headOid ?? "head123",
        viewer: {
          login: "reviewer",
          canMerge: true,
          canUpdate: true,
          isAuthor: false,
          reviewState: null,
        },
      }),
    }),
    pullRequestFiles: async () => ({
      ok: true,
      value: {
        headOid: options.headOid ?? "head123",
        files: [prFile("src/a.ts"), prFile("src/b.ts")],
        truncated: false,
      },
    }),
  });
  renderPullRequestsPage({ pr: "github.com/acme/web/7", store });
  return { store };
}

async function openGuide() {
  await userEvent.click(await screen.findByRole("tab", { name: /Guide/ }));
}

async function writeGuide() {
  await openGuide();
  generate.mockResolvedValueOnce(reply);
  await userEvent.click(await screen.findByRole("button", { name: "Write guide" }));
  return screen.findByRole("heading", { name: "The new two" });
}

beforeEach(() => {
  generate.mockReset();
  startTask.mockClear();
  catalog = {
    defaultModel: { id: "sonnet", providerID: "anthropic", name: "Sonnet" } as never,
    models: [],
  };
});
afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, "palot");
  window.localStorage.clear();
});

describe("pull request guide", () => {
  it("explains guides, writes one on request, and tours its stops by keyboard", async () => {
    render();
    await openGuide();
    expect(await screen.findByText("No review guide yet")).toBeTruthy();
    expect(screen.getByText(/short tour of the change/)).toBeTruthy();

    let finish: (text: string) => void = () => {};
    generate.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
    await userEvent.click(screen.getByRole("button", { name: "Write guide" }));
    expect(await screen.findByText("Writing guide… this can take a minute.")).toBeTruthy();
    expect(generate.mock.calls[0]![0].model).toEqual({ id: "sonnet", providerID: "anthropic" });
    await act(async () => finish(reply));

    expect(await screen.findByRole("heading", { name: "The new two" })).toBeTruthy();
    const rail = screen.getByRole("complementary", { name: "Guide stops" });
    const stops = within(rail)
      .getAllByRole("listitem")
      .map((item) => within(item).getByRole("button"));
    expect(stops.map((stop) => stop.textContent)).toEqual([
      "1Stop 1: The new twoLook closely, 1 file",
      "2Stop 2: Skim the rest1 file",
    ]);
    expect(stops[0]!.getAttribute("aria-current")).toBe("step");
    // The one call to make at this stop.
    expect(screen.getByRole("note").textContent).toContain("Look closely · contract");
    expect(screen.getByRole("note").textContent).toContain("Callers now see the new value.");
    expect(screen.getAllByText("Why two").length).toBeGreaterThan(0);

    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    expect(await screen.findByRole("heading", { name: "Skim the rest" })).toBeTruthy();
    expect(screen.getAllByText("Stop 2 of 2").length).toBeGreaterThan(0);
    const skimFiles = screen.getByRole("region", { name: "Files in this stop" });
    expect(within(skimFiles).getByText("src/b.ts")).toBeTruthy();
    fireEvent.keyDown(document.body, { key: "k" });
    expect(await screen.findByRole("heading", { name: "The new two" })).toBeTruthy();
    // Typing never steps the tour.
    fireEvent.keyDown(screen.getByRole("tab", { name: /Guide/ }), { key: "ArrowRight" });
    expect(screen.queryByRole("heading", { name: "Skim the rest" })).toBeNull();
  });

  it("adds excerpt line comments to the review the Code tab sends, and finishes there", async () => {
    const { store } = render();
    await writeGuide();

    act(() =>
      latestOptions?.onLineSelectionEnd?.({ start: 2, end: 2, side: "additions" } as never),
    );
    await userEvent.type(screen.getByRole("textbox", { name: "Line comment" }), "Nice");
    await userEvent.click(screen.getByRole("button", { name: "Add comment" }));

    expect(store.get(pendingReviewAtom(KEY)).comments).toEqual([
      expect.objectContaining({ path: "src/a.ts", line: 2, side: "RIGHT", body: "Nice" }),
    ]);
    // Shown on its line in the excerpt and counted in the toolbar tray.
    expect(screen.getByText("Nice")).toBeTruthy();
    expect(screen.getByRole("button", { name: "1 pending comment" })).toBeTruthy();

    // A line outside the change cannot be commented on.
    act(() =>
      latestOptions?.onLineSelectionEnd?.({
        start: 40,
        end: 40,
        side: "additions",
      } satisfies SelectedLineRange),
    );
    expect(screen.queryByRole("textbox", { name: "Line comment" })).toBeNull();

    fireEvent.keyDown(document.body, { key: "j" });
    await userEvent.click(await screen.findByRole("button", { name: "Finish review" }));
    const form = await screen.findByRole("form", { name: "Submit review" });
    expect(within(form).getByText("1 line comment will be sent with this review.")).toBeTruthy();
  });

  it("asks about a stop in a new task with the pull request and the stop's code", async () => {
    render();
    await writeGuide();
    await userEvent.click(screen.getByRole("button", { name: "Ask: Why not keep the old two?" }));
    expect(startTask).toHaveBeenCalledWith(
      "detail",
      expect.objectContaining({ url: URL }),
      expect.stringContaining(URL),
    );
    const prompt = (startTask.mock.calls[0] as unknown as [string, unknown, string])[2];
    expect(prompt).toContain("stop 1 of 2: The new two");
    expect(prompt).toContain("- src/a.ts, line 2");
    expect(prompt).toContain("Why not keep the old two?");

    await userEvent.click(screen.getByRole("button", { name: "Ask about this stop" }));
    expect(startTask).toHaveBeenCalledTimes(2);
  });

  it("flags a guide written before the latest push and rewrites it", async () => {
    const stale: ReviewGuide = {
      headSha: "old-head",
      generatedAt: "2026-01-01T00:00:00.000Z",
      model: null,
      stops: [
        {
          title: "Old tour",
          summary: "",
          attention: null,
          excerpts: [],
          files: [{ path: "src/a.ts" }],
          notes: [],
          questions: [],
        },
      ],
    };
    saveReviewGuide(KEY, stale);
    render();
    await openGuide();
    expect(await screen.findByRole("heading", { name: "Old tour" })).toBeTruthy();
    expect(screen.getByText("Written before the latest push")).toBeTruthy();

    generate.mockResolvedValueOnce(reply);
    await userEvent.click(screen.getByRole("button", { name: "Rewrite" }));
    expect(await screen.findByRole("heading", { name: "The new two" })).toBeTruthy();
    expect(screen.queryByText("Written before the latest push")).toBeNull();
  });

  it("writes or rewrites from the pull request menu", async () => {
    render();
    await screen.findByRole("tab", { name: /Guide/ });
    generate.mockResolvedValueOnce(reply);
    await userEvent.click(screen.getByRole("button", { name: "Pull request actions" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Write guide" }));
    expect(await screen.findByRole("heading", { name: "The new two" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /Guide/ }).getAttribute("aria-selected")).toBe("true");

    await userEvent.click(screen.getByRole("button", { name: "Pull request actions" }));
    expect(await screen.findByRole("menuitem", { name: "Rewrite guide" })).toBeTruthy();
  });

  it("shows generation errors inline and can try again", async () => {
    render();
    await openGuide();
    generate.mockRejectedValueOnce(new Error("Provider is overloaded"));
    await userEvent.click(await screen.findByRole("button", { name: "Write guide" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Could not write the guide");
    expect(alert.textContent).toContain("Provider is overloaded");

    generate.mockResolvedValueOnce(reply);
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { name: "The new two" })).toBeTruthy();
  });

  it("explains why a guide cannot be written without a model", async () => {
    catalog = { defaultModel: null, models: [] };
    render();
    await openGuide();
    const write = await screen.findByRole("button", { name: "Write guide" });
    expect(write.hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("No model is available. Connect a provider in Settings.")).toBeTruthy();
  });
});
