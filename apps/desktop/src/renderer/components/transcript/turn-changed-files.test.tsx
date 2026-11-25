import type { FileDiffInfo } from "@opencode/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider, createStore } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenCodeRuntimeStatus } from "../../../shared";
import { runtimeAtom } from "../../atoms/workspace";
import { createRendererQueryClient } from "../../lib/query-client";
import { TurnChangedFiles } from "./turn-changed-files";

const mocks = vi.hoisted(() => ({ listTurnDiffs: vi.fn() }));
vi.mock("../../services/palot", () => ({ palot: { listTurnDiffs: mocks.listTurnDiffs } }));

function diff(file: string, additions: number, deletions: number, status = "modified") {
  return { file, patch: "", additions, deletions, status } as FileDiffInfo;
}

function renderCard(files: readonly string[], onOpenDiff = vi.fn()) {
  const store = createStore();
  store.set(runtimeAtom, {
    connected: true,
    profileID: "profile",
    connectionID: "origin",
  } as OpenCodeRuntimeStatus);
  render(
    <QueryClientProvider client={createRendererQueryClient()}>
      <Provider store={store}>
        <TurnChangedFiles
          profileID="profile"
          sessionID="session"
          userMessageID="u1"
          files={files}
          onOpenDiff={onOpenDiff}
        />
      </Provider>
    </QueryClientProvider>,
  );
  return { onOpenDiff };
}

/** Replaces happy-dom's observer, which never reports an intersection, for one test. */
function stubIntersectionObserver(intersecting: boolean) {
  const observers: IntersectionObserverCallback[] = [];
  class StubIntersectionObserver {
    constructor(private readonly callback: IntersectionObserverCallback) {
      observers.push(callback);
    }
    observe() {
      if (intersecting)
        this.callback(
          [{ isIntersecting: true } as IntersectionObserverEntry],
          this as unknown as IntersectionObserver,
        );
    }
    disconnect() {}
  }
  vi.stubGlobal("IntersectionObserver", StubIntersectionObserver);
  return {
    enter: () =>
      observers.forEach((callback) =>
        callback([{ isIntersecting: true } as IntersectionObserverEntry], {} as never),
      ),
  };
}

const card = () => screen.getByRole("group", { name: "Files changed in this turn" });
const fileRows = () => within(card()).getAllByRole("listitem");

describe("TurnChangedFiles", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubIntersectionObserver(true);
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("lists the files before counts arrive", () => {
    mocks.listTurnDiffs.mockReturnValue(new Promise(() => {}));
    renderCard(["src/app.ts", "src/lib/util.ts", "README.md"]);

    expect(card().textContent).toContain("3 files changed");
    expect(fileRows().map((row) => row.textContent)).toEqual([
      "app.tssrc",
      "util.tssrc/lib",
      "README.md",
    ]);
    expect(card().textContent).not.toContain("+");
    expect(mocks.listTurnDiffs).toHaveBeenCalledWith(
      "session",
      "u1",
      expect.anything(),
      "origin",
      3,
    );
  });

  it("adds per-file counts, totals and status once the diff loads", async () => {
    mocks.listTurnDiffs.mockResolvedValue([
      diff("src/app.ts", 30, 10),
      diff("src/new.ts", 10, 0, "added"),
      diff("old.ts", 0, 2, "deleted"),
    ]);
    renderCard(["src/app.ts", "src/new.ts", "old.ts"]);

    await screen.findByRole("button", { name: "src/app.ts, +30 −10" });
    expect(card().textContent).toContain("3 files changed+40−12");
    expect(screen.getByRole("button", { name: "src/new.ts, added, +10 −0" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "old.ts, deleted, +0 −2" })).toBeTruthy();
  });

  it("lists lockfiles and generated files after the others and counts them apart", async () => {
    mocks.listTurnDiffs.mockResolvedValue([
      diff("bun.lock", 300, 120),
      diff("src/app.ts", 30, 10),
      diff("dist/app.js", 900, 800),
      diff("src/app.test.ts", 5, 0),
    ]);
    renderCard(["bun.lock", "src/app.ts", "dist/app.js", "src/app.test.ts"]);

    await screen.findByRole("button", { name: "src/app.ts, +30 −10" });
    expect(fileRows().map((row) => within(row).getByRole("button").title)).toEqual([
      "src/app.ts",
      "src/app.test.ts",
      "bun.lock",
      "dist/app.js",
    ]);
    // Totals cover the two files the turn is about; the rest is named separately.
    expect(card().textContent).toContain("2 files changed+35−10+ 1 lockfile, 1 generated");
    expect(
      screen.getByRole("button", { name: "bun.lock, lockfile, +300 −120" }).textContent,
    ).toContain("Lockfile");
  });

  it("does not split totals when every file is a lockfile", async () => {
    mocks.listTurnDiffs.mockResolvedValue([diff("bun.lock", 3, 1)]);
    renderCard(["bun.lock"]);
    await screen.findByRole("button", { name: "bun.lock, lockfile, +3 −1" });
    expect(card().textContent).toContain("Changed bun.lock+3−1");
  });

  it("adds files only the diff reports", async () => {
    mocks.listTurnDiffs.mockResolvedValue([diff("src/app.ts", 1, 0), diff("src/late.ts", 2, 0)]);
    renderCard(["src/app.ts"]);
    await screen.findByRole("button", { name: "src/late.ts, +2 −0" });
    expect(card().textContent).toContain("2 files changed");
  });

  it("shows five files and reveals the rest on request", async () => {
    mocks.listTurnDiffs.mockReturnValue(new Promise(() => {}));
    renderCard(["a.ts", "b.ts", "c.ts", "d.ts", "e.ts", "f.ts", "g.ts"]);

    expect(fileRows()).toHaveLength(5);
    await userEvent.click(screen.getByRole("button", { name: "Show 2 more" }));
    expect(fileRows()).toHaveLength(7);
    await userEvent.click(screen.getByRole("button", { name: "Show fewer" }));
    expect(fileRows()).toHaveLength(5);
  });

  it("keeps the names when the diff fails and retries on request", async () => {
    mocks.listTurnDiffs.mockRejectedValueOnce(new Error("offline"));
    renderCard(["src/app.ts"]);

    await screen.findByText("Diff unavailable");
    expect(screen.getByRole("button", { name: "src/app.ts" })).toBeTruthy();

    mocks.listTurnDiffs.mockResolvedValueOnce([diff("src/app.ts", 4, 1)]);
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    await screen.findByRole("button", { name: "src/app.ts, +4 −1" });
    expect(screen.queryByText("Diff unavailable")).toBeNull();
  });

  it("treats an empty diff as unavailable", async () => {
    mocks.listTurnDiffs.mockResolvedValue([]);
    renderCard(["src/app.ts"]);
    await screen.findByText("Diff unavailable");
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });

  it("names a single changed file", () => {
    mocks.listTurnDiffs.mockReturnValue(new Promise(() => {}));
    renderCard(["Sources/App/app.swift"]);
    expect(card().textContent).toContain("Changed app.swift");
  });

  it("opens the diff at a file or for the whole turn", async () => {
    mocks.listTurnDiffs.mockReturnValue(new Promise(() => {}));
    const { onOpenDiff } = renderCard(["src/app.ts", "README.md"]);

    await userEvent.click(screen.getByRole("button", { name: "README.md" }));
    expect(onOpenDiff).toHaveBeenLastCalledWith("README.md");
    await userEvent.click(screen.getByRole("button", { name: "Review changes" }));
    expect(onOpenDiff).toHaveBeenLastCalledWith();
  });

  it("waits until the card is near the viewport before loading counts", async () => {
    const viewport = stubIntersectionObserver(false);
    mocks.listTurnDiffs.mockResolvedValue([diff("src/app.ts", 1, 1)]);
    renderCard(["src/app.ts"]);
    expect(screen.getByRole("button", { name: "src/app.ts" })).toBeTruthy();
    expect(mocks.listTurnDiffs).not.toHaveBeenCalled();

    act(() => viewport.enter());
    await screen.findByRole("button", { name: "src/app.ts, +1 −1" });
    expect(mocks.listTurnDiffs).toHaveBeenCalledOnce();
  });
});
