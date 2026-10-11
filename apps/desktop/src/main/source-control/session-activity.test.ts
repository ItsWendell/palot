// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import {
  USER_MESSAGE_PAGE_LIMIT,
  USER_MESSAGE_PAGE_SIZE,
  latestUserMessageAt,
  type UserMessageCandidate,
} from "./session-activity";

const PALOT = ["palot.sourceControl", "palot.automation"];

function wake(created: number): UserMessageCandidate {
  return { type: "user", time: { created }, metadata: { "palot.sourceControl": { version: 1 } } };
}

function fullPage(start: number, extra: UserMessageCandidate[] = []) {
  return {
    data: [
      ...extra,
      ...Array.from({ length: USER_MESSAGE_PAGE_SIZE - extra.length }, (_, index) =>
        wake(start - index),
      ),
    ],
    cursor: { next: `cursor-${start}` },
  };
}

describe("latestUserMessageAt", () => {
  it("pages past a run of Palot wakes to the user's own message", async () => {
    const readPage = vi
      .fn()
      .mockResolvedValueOnce(fullPage(10_000))
      .mockResolvedValueOnce({
        data: [wake(900), { type: "user", time: { created: 800 } }],
        cursor: { next: null },
      });
    await expect(latestUserMessageAt(readPage, PALOT)).resolves.toEqual({
      at: 800,
      complete: true,
    });
    expect(readPage).toHaveBeenNthCalledWith(2, "cursor-10000");
  });

  it("reports no message once the session's history ends", async () => {
    const readPage = vi.fn(async () => ({ data: [wake(5)], cursor: { next: "end" } }));
    await expect(latestUserMessageAt(readPage, PALOT)).resolves.toEqual({
      at: null,
      complete: true,
    });
  });

  it("gives up as incomplete rather than guessing after the page budget", async () => {
    let start = 1_000_000;
    const readPage = vi.fn(async () => fullPage((start -= USER_MESSAGE_PAGE_SIZE)));
    await expect(latestUserMessageAt(readPage, PALOT)).resolves.toEqual({
      at: null,
      complete: false,
    });
    expect(readPage).toHaveBeenCalledTimes(USER_MESSAGE_PAGE_LIMIT);
  });
});
