import { describe, expect, it } from "vitest";
import type { PalotSession } from "../../shared";
import { mergeSessionPage } from "./session-catalog";

const session = (id: string, updatedAt: number): PalotSession => ({
  id,
  parentID: null,
  projectID: "project-1",
  title: id,
  agent: null,
  model: null,
  location: { directory: "/repo" },
  createdAt: updatedAt,
  updatedAt,
  archivedAt: null,
  cost: null,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
});

describe("mergeSessionPage", () => {
  it("deduplicates pages and keeps the authoritative cursor", () => {
    expect(
      mergeSessionPage(
        { sessions: [session("a", 1), session("b", 2)], nextCursor: "old" },
        {
          data: [session("a", 4), session("c", 3)],
          cursor: { previous: null, next: "next" },
        },
      ),
    ).toEqual({
      sessions: [session("a", 4), session("c", 3), session("b", 2)],
      nextCursor: "next",
    });
  });
});
