import { describe, expect, it } from "vitest";
import type { SessionActivityData } from "../lib/session-activity-query";
import { createInboxActivitySelector } from "./use-session-inbox";

describe("createInboxActivitySelector", () => {
  it("projects running parent execution into the inbox when only a child is directly active", () => {
    const select = createInboxActivitySelector();
    const data: SessionActivityData = {
      activeIDs: new Set(["child"]),
      execution: new Map([
        ["root", { status: "running", startedAt: 10, completedAt: null }],
        ["child", { status: "running", startedAt: 20, completedAt: null, parentID: "root" }],
      ]),
      statuses: new Map([
        ["root", { type: "idle" }],
        ["child", { type: "busy" }],
      ]),
    };

    const result = select(data);

    expect(result.activeIDs).toEqual(new Set(["root", "child"]));
    expect(result.runningSinceBySession).toEqual(
      new Map([
        ["root", 10],
        ["child", 20],
      ]),
    );
  });
});
