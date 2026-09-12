import { describe, expect, it } from "vitest";
import {
  MAX_RETAINED_SESSION_VIEWS,
  SessionViewRetention,
  retainSessionViews,
} from "./session-view-retention";

describe("session view retention", () => {
  it("keeps the most recently touched session views", () => {
    const retention = new SessionViewRetention();
    for (let index = 0; index < MAX_RETAINED_SESSION_VIEWS + 3; index += 1) {
      retention.touch(`session-${index}`);
    }
    expect([...retention.retained()]).toEqual(
      Array.from({ length: MAX_RETAINED_SESSION_VIEWS }, (_, index) => `session-${index + 3}`),
    );
  });

  it("refreshes recency without duplicating a session", () => {
    const retention = new SessionViewRetention();
    retention.touch("a");
    retention.touch("b");
    retention.touch("a");
    expect([...retention.retained()]).toEqual(["b", "a"]);
  });

  it("keeps protected active or attention sessions", () => {
    const retention = new SessionViewRetention();
    for (let index = 0; index < MAX_RETAINED_SESSION_VIEWS + 1; index += 1) {
      retention.touch(`session-${index}`);
    }
    expect(retention.retained(["session-0", "attention-session"])).toEqual(
      new Set([
        ...Array.from({ length: MAX_RETAINED_SESSION_VIEWS }, (_, index) => `session-${index + 1}`),
        "session-0",
        "attention-session",
      ]),
    );
  });

  it("prunes entity maps to retained session IDs", () => {
    const values = new Map([
      ["a", 1],
      ["b", 2],
      ["c", 3],
    ]);
    expect(retainSessionViews(values, new Set(["b", "c"]))).toEqual(
      new Map([
        ["b", 2],
        ["c", 3],
      ]),
    );
  });
});
