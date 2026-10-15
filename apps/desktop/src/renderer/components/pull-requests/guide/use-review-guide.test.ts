import { QueryClient } from "@tanstack/react-query";
import { createStore } from "jotai";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { pullRequestKey } from "../../../../shared/source-control-contract";
import {
  loadReviewGuide,
  MAX_STORED_GUIDE_CHARS,
  reviewGuideAtom,
  saveReviewGuide,
} from "../../../lib/review-guide-store";
import { SKIM_STOP_TITLE, type ReviewGuide } from "../../../lib/review-guide";
import { generateOpenCodeText } from "../../../services/opencode-generate";
import { prFile } from "../code/test-support";
import { installSourceControl, pullRequestDetail } from "../test-fixtures";
import {
  cancelReviewGuide,
  REVIEW_GUIDE_TIMEOUT_MS,
  reviewGuideRunAtom,
  runReviewGuide,
} from "./use-review-guide";

vi.mock("../../../services/opencode-generate", () => ({ generateOpenCodeText: vi.fn() }));
const generate = vi.mocked(generateOpenCodeText);

const files = [prFile("src/a.ts"), prFile("src/b.ts")];
const reply = JSON.stringify({
  stops: [
    {
      title: "The new two",
      summary: "Line two changes.",
      attention: { kind: "contract", note: "Callers see the new value." },
      excerpts: [{ path: "src/a.ts", side: "new", start: 2, end: 2, caption: "" }],
      files: [],
      notes: [],
      questions: [],
    },
  ],
});

let number = 100;
function setup() {
  number += 1;
  const detail = pullRequestDetail(number, { headOid: "head123" });
  installSourceControl({
    pullRequestFiles: async () => ({
      ok: true,
      value: { headOid: "head123", files, truncated: false },
    }),
  });
  const store = createStore();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const key = pullRequestKey(detail);
  return { detail, store, queryClient, key };
}

beforeEach(() => generate.mockReset());
afterEach(() => {
  Reflect.deleteProperty(window, "palot");
  window.localStorage.clear();
});

it("writes a guide held to the change, with a long timeout and the chosen model", async () => {
  const { detail, store, queryClient, key } = setup();
  generate.mockResolvedValueOnce(reply);
  await runReviewGuide(store, queryClient, {
    detail,
    model: { ref: { id: "sonnet", providerID: "anthropic" }, label: "Sonnet" },
    connectionID: "connection",
  });

  expect(generate).toHaveBeenCalledTimes(1);
  const [input, connectionID, signal, options] = generate.mock.calls[0]!;
  expect(input.model).toEqual({ id: "sonnet", providerID: "anthropic" });
  expect(input.prompt).toContain("pull request #");
  expect(connectionID).toBe("connection");
  expect(signal).toBeInstanceOf(AbortSignal);
  expect(options).toEqual({ timeoutMs: REVIEW_GUIDE_TIMEOUT_MS });

  const guide = store.get(reviewGuideAtom(key));
  expect(guide).toMatchObject({ headSha: "head123", model: "Sonnet" });
  // src/b.ts was never placed, so it lands in the skim stop.
  expect(guide?.stops.map((stop) => stop.title)).toEqual(["The new two", SKIM_STOP_TITLE]);
  expect(store.get(reviewGuideRunAtom(key))).toBeNull();
  // Kept across restarts.
  expect(loadReviewGuide(key)?.headSha).toBe("head123");
});

it("asks once more to repair a reply that is not the expected JSON", async () => {
  const { detail, store, queryClient, key } = setup();
  generate.mockResolvedValueOnce("Sure! The guide covers the change.").mockResolvedValueOnce(reply);
  await runReviewGuide(store, queryClient, { detail, model: { ref: null, label: null } });

  expect(generate).toHaveBeenCalledTimes(2);
  const repair = generate.mock.calls[1]![0].prompt;
  expect(repair).toContain("could not be read as the required JSON");
  expect(repair).toContain("Sure! The guide covers the change.");
  expect(store.get(reviewGuideAtom(key))?.stops[0]?.title).toBe("The new two");
});

it("fails with a readable message when the repair is unreadable too, keeping the old guide", async () => {
  const { detail, store, queryClient, key } = setup();
  const previous: ReviewGuide = {
    headSha: "old",
    generatedAt: "2026-01-01T00:00:00.000Z",
    model: null,
    stops: [],
  };
  store.set(reviewGuideAtom(key), previous);
  generate.mockResolvedValue("still not json");
  await runReviewGuide(store, queryClient, { detail, model: { ref: null, label: null } });

  expect(generate).toHaveBeenCalledTimes(2);
  expect(store.get(reviewGuideRunAtom(key))).toEqual({
    status: "failed",
    message: expect.stringContaining("did not return a guide"),
  });
  expect(store.get(reviewGuideAtom(key))).toBe(previous);
});

it("reports generation errors and returns to idle when cancelled", async () => {
  const { detail, store, queryClient, key } = setup();
  generate.mockRejectedValueOnce(new Error("Provider is overloaded"));
  await runReviewGuide(store, queryClient, { detail, model: { ref: null, label: null } });
  expect(store.get(reviewGuideRunAtom(key))).toEqual({
    status: "failed",
    message: "Provider is overloaded",
  });

  generate.mockImplementationOnce(
    (_input, _connection, signal) =>
      new Promise((_resolve, reject) =>
        signal?.addEventListener("abort", () => reject(signal.reason)),
      ),
  );
  const run = runReviewGuide(store, queryClient, { detail, model: { ref: null, label: null } });
  await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(2));
  expect(store.get(reviewGuideRunAtom(key))).toMatchObject({ status: "running" });
  cancelReviewGuide(key);
  await run;
  expect(store.get(reviewGuideRunAtom(key))).toBeNull();
  expect(store.get(reviewGuideAtom(key))).toBeNull();
});

it("does not keep a guide too large for local storage", () => {
  const key = "github.com/acme/web#999";
  const huge: ReviewGuide = {
    headSha: "head",
    generatedAt: "2026-01-01T00:00:00.000Z",
    model: null,
    stops: [
      {
        title: "Big",
        summary: "x".repeat(MAX_STORED_GUIDE_CHARS),
        attention: null,
        excerpts: [],
        files: [],
        notes: [],
        questions: [],
      },
    ],
  };
  expect(saveReviewGuide(key, { ...huge, stops: [] })).toBe(true);
  expect(loadReviewGuide(key)).not.toBeNull();
  expect(saveReviewGuide(key, huge)).toBe(false);
  expect(loadReviewGuide(key)).toBeNull();
});
