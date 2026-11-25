import { describe, expect, it } from "vitest";
import {
  createFamilyCompletionTracker,
  subagentReportHasBackgroundWork,
  subagentReportWaitsOnlyForSubagents,
  type FamilyCompletion,
  type FamilyEvent,
} from "./family-completion";

/** root → child → grandchild, as with `experimental.subagent_depth: 2`. */
const parents = new Map<string, string | null>([
  ["root", null],
  ["child", "root"],
  ["other", "root"],
  ["grandchild", "child"],
]);

function setup() {
  const finished: FamilyCompletion[] = [];
  const timers: Array<{ callback: () => void; cleared: boolean }> = [];
  const tracker = createFamilyCompletionTracker({
    parentOf: (sessionID) => parents.get(sessionID),
    onFinished: (completion) => finished.push(completion),
    setTimer: (callback) => {
      const timer = { callback, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearTimer: (handle) => {
      (handle as { cleared: boolean }).cleared = true;
    },
  });
  let sequence = 0;
  const send = (type: string, sessionID: string, data: Record<string, unknown> = {}) => {
    const event: FamilyEvent = { id: `e${++sequence}`, type, data: { sessionID, ...data } };
    tracker.handle(event);
    return event.id;
  };
  return {
    tracker,
    finished,
    started: (id: string) => send("session.execution.started", id),
    succeeded: (id: string) => send("session.execution.succeeded", id),
    failed: (id: string, type = "ProviderError") =>
      send("session.execution.failed", id, { error: { type, message: "Model error" } }),
    // OpenCode admits a child's report to its parent's inbox right after the child's idle.
    report: (parent: string, inboxID: string, text = "<subagent>", childID = "child") =>
      send("session.inbox.enqueued", parent, {
        inboxID,
        item: {
          type: "synthetic",
          payload: { text, metadata: { source: "subagent", childID, state: "completed" } },
          delivery: "steer",
        },
      }),
    delivered: (parent: string, inboxID: string) =>
      send("session.inbox.delivered", parent, { inboxID }),
    /** Fires the grace timers still pending. */
    graceElapses: () => {
      for (const timer of timers.splice(0)) if (!timer.cleared) timer.callback();
    },
  };
}

describe("family completion", () => {
  it("finishes a task without subagents when its run ends", () => {
    const family = setup();
    family.started("root");
    const end = family.succeeded("root");
    expect(family.finished).toEqual([
      { rootID: "root", outcome: "succeeded", error: null, eventID: end, eventCreatedAt: null },
    ]);
  });

  it("waits for a background child and the run its report wakes, then finishes once", () => {
    const family = setup();
    family.started("root");
    family.started("child");
    family.succeeded("root");
    expect(family.finished).toEqual([]);
    family.succeeded("child");
    family.report("root", "report-1");
    family.started("root");
    family.graceElapses();
    expect(family.finished).toEqual([]);
    const end = family.succeeded("root");
    expect(family.finished).toEqual([expect.objectContaining({ rootID: "root", eventID: end })]);
  });

  it("finishes after the grace when a child's report wakes nothing", () => {
    const family = setup();
    family.started("root");
    family.started("child");
    family.succeeded("root");
    family.succeeded("child");
    family.report("root", "report-1");
    expect(family.finished).toEqual([]);
    family.graceElapses();
    expect(family.finished).toEqual([expect.objectContaining({ outcome: "succeeded" })]);
  });

  it("does not finish early when the parent ends just before a child's report arrives", () => {
    const family = setup();
    family.started("root");
    family.started("child");
    // The child ends while the parent still runs; the parent ends before the report lands.
    family.succeeded("child");
    family.succeeded("root");
    expect(family.finished).toEqual([]);
    family.report("root", "report-1");
    family.started("root");
    const end = family.succeeded("root");
    expect(family.finished).toEqual([expect.objectContaining({ eventID: end })]);
  });

  it("finishes at the parent's end when the report joined its running run", () => {
    const family = setup();
    family.started("root");
    family.started("child");
    family.succeeded("child");
    family.report("root", "report-1");
    family.delivered("root", "report-1");
    const end = family.succeeded("root");
    expect(family.finished).toEqual([expect.objectContaining({ eventID: end })]);
  });

  it("follows a three-level family until the grandchild's report has reached the task", () => {
    const family = setup();
    family.started("root");
    family.started("child");
    family.succeeded("root");
    family.started("grandchild");
    family.succeeded("child");
    family.report("root", "child-report");
    family.started("root");
    family.succeeded("root");
    // The grandchild still runs: nothing is finished.
    expect(family.finished).toEqual([]);
    family.succeeded("grandchild");
    family.report("child", "grandchild-report");
    family.started("child");
    family.succeeded("child");
    family.report("root", "child-report-2");
    family.started("root");
    expect(family.finished).toEqual([]);
    const end = family.succeeded("root");
    expect(family.finished).toEqual([expect.objectContaining({ rootID: "root", eventID: end })]);
  });

  it("names a provider limit that failed the task, with its reset", () => {
    const family = setup();
    family.started("root");
    family.failed("root", "provider.chatgpt-workspace-limit");
    expect(family.finished.at(-1)).toMatchObject({
      outcome: "failed",
      error: "ChatGPT workspace limit reached.",
    });
  });

  it("reports the task's latest run, and a stop as interrupted", () => {
    const family = setup();
    family.started("root");
    family.failed("root");
    expect(family.finished.at(-1)).toMatchObject({ outcome: "failed", error: "Model error" });
    family.started("root");
    family.failed("root", "MessageAbortedError");
    expect(family.finished.at(-1)).toMatchObject({ outcome: "interrupted", error: null });
  });

  it("finishes once more when a message sent to a finished subagent wakes the task", () => {
    const family = setup();
    family.started("root");
    family.succeeded("root");
    expect(family.finished).toHaveLength(1);
    // The user messages the subagent directly; its report wakes the task for another run.
    family.started("child");
    family.succeeded("child");
    family.report("root", "report-2");
    family.started("root");
    family.graceElapses();
    expect(family.finished).toHaveLength(1);
    const end = family.succeeded("root");
    expect(family.finished).toHaveLength(2);
    expect(family.finished[1]).toMatchObject({ rootID: "root", eventID: end });
  });

  it("has no result for a period in which only a subagent ran", () => {
    const family = setup();
    family.started("child");
    family.succeeded("child");
    family.graceElapses();
    expect(family.finished).toEqual([]);
  });

  it("stays open while a subagent's latest report lists background work still running", () => {
    // OpenCode 2.3.0: the child went idle with its own background command still running.
    const waitingReport =
      '<subagent sessionID="child" state="running" description="Build">\nStarted the build.\n\n' +
      "Background work still running:\n- shell (sh_1): bun run build\n</subagent>";
    const family = setup();
    family.started("root");
    family.started("child");
    family.succeeded("root");
    family.succeeded("child");
    family.report("root", "report-1", waitingReport);
    family.started("root");
    family.delivered("root", "report-1");
    family.succeeded("root");
    family.graceElapses();
    expect(family.tracker.busy("root")).toBe(true);
    expect(family.finished).toEqual([]);

    // The command ends, wakes the child, and its next report lists nothing still running.
    family.started("child");
    family.succeeded("child");
    family.report(
      "root",
      "report-2",
      '<subagent sessionID="child" state="completed" description="Build">\nBuilt.\n</subagent>',
    );
    family.started("root");
    const end = family.succeeded("root");
    expect(family.finished).toEqual([expect.objectContaining({ rootID: "root", eventID: end })]);
  });

  it("stays open while a subagent's own subagent waits for the user's answer", () => {
    // OpenCode 2.3.0's report lists the grandchild; a release without the list says nothing,
    // and the running grandchild alone must keep the family open.
    const listed =
      '<subagent sessionID="child" state="running" description="Coordinate">\nWaiting for the ' +
      "collector.\n\nBackground work still running:\n- subagent (General, sessionID: grandchild): " +
      "Collect the decision\n</subagent>";
    const unlisted =
      '<subagent sessionID="child" state="completed" description="Coordinate">\n' +
      "Waiting for the collector.\n</subagent>";
    for (const text of [listed, unlisted]) {
      const family = setup();
      family.started("root");
      family.started("child");
      family.succeeded("root");
      // The grandchild asks the user and stays running until they answer.
      family.started("grandchild");
      family.succeeded("child");
      family.report("root", "child-report", text);
      family.started("root");
      family.delivered("root", "child-report");
      family.succeeded("root");
      family.graceElapses();
      expect(family.tracker.busy("root")).toBe(true);
      expect(family.finished).toEqual([]);

      // The answer: the grandchild ends, its report wakes the child, whose report wakes the task.
      family.succeeded("grandchild");
      family.report("child", "grandchild-report", "<subagent>", "grandchild");
      family.started("child");
      family.succeeded("child");
      family.report("root", "child-report-2");
      family.started("root");
      expect(family.finished).toEqual([]);
      const end = family.succeeded("root");
      expect(family.finished).toEqual([expect.objectContaining({ rootID: "root", eventID: end })]);
    }
  });

  it("recognises a report that waits only for its own subagents", () => {
    const body = (list: string) => `Waiting.\n\nBackground work still running:\n${list}`;
    expect(
      subagentReportWaitsOnlyForSubagents(
        `<subagent sessionID="c" state="running">\n${body("- subagent (General, sessionID: g): Ask")}\n</subagent>`,
      ),
    ).toBe(true);
    expect(
      subagentReportWaitsOnlyForSubagents(
        body("- subagent (General, sessionID: g): Ask\n- shell (sh_1): bun test"),
      ),
    ).toBe(false);
    expect(subagentReportWaitsOnlyForSubagents("Done.")).toBe(false);
  });

  it("stops waiting on a subagent's background work when the task is stopped", () => {
    const family = setup();
    family.started("root");
    family.started("child");
    family.succeeded("child");
    family.report("root", "report-1", "Started.\n\nBackground work still running:\n- shell");
    family.delivered("root", "report-1");
    const stop = family.failed("root", "MessageAbortedError");
    expect(family.finished).toEqual([
      expect.objectContaining({ outcome: "interrupted", eventID: stop }),
    ]);
  });

  it("recognises a report that lists background work still running", () => {
    expect(
      subagentReportHasBackgroundWork(
        '<subagent sessionID="c" state="running" description="d">\nBody\n</subagent>',
      ),
    ).toBe(true);
    expect(
      subagentReportHasBackgroundWork("Body\n\nBackground work still running:\n- subagent"),
    ).toBe(true);
    // A report body that is only the list, once trimmed.
    expect(subagentReportHasBackgroundWork("Background work still running:\n- shell")).toBe(true);
    expect(
      subagentReportHasBackgroundWork(
        '<subagent sessionID="c" state="completed" description="d">\nNo background work still running: all done.\n</subagent>',
      ),
    ).toBe(false);
  });

  it("lets a tagged report's state decide, whatever its answer quotes", () => {
    const quoted =
      "The server appends:\n\nBackground work still running:\n- shell (sh_1): bun test\n\nThat is all.";
    // #64026: completed means the server's outstanding list was empty.
    expect(
      subagentReportHasBackgroundWork(
        `<subagent sessionID="c" state="completed" description="d">\n${quoted}\n</subagent>`,
      ),
    ).toBe(false);
    // 2.3.0: the tag says running when the server appended its list.
    expect(
      subagentReportHasBackgroundWork(
        '<subagent sessionID="c" state="running" description="d">\nStarted.\n\nBackground work still running:\n- shell (sh_1): bun test\n</subagent>',
      ),
    ).toBe(true);
    // An error report keeps reading the list.
    expect(
      subagentReportHasBackgroundWork(
        '<subagent sessionID="c" state="error" description="d">\nboom\n\nBackground work still running:\n- shell (sh_1): bun test\n</subagent>',
      ),
    ).toBe(true);
    expect(
      subagentReportHasBackgroundWork(
        '<subagent sessionID="c" state="error" description="d">\nboom\n</subagent>',
      ),
    ).toBe(false);
  });

  it('reads 2.4 reports, <background-result kind="subagent">', () => {
    // Fixtures from OpenCode's subagent-completion tests after #64971.
    const running = [
      '<background-result kind="subagent" sessionID="ses_deliver_child" state="running" description="Deliver report">',
      "Waiting.",
      "",
      "Background work still running:",
      "- subagent (General, sessionID: g): Ask",
      "</background-result>",
    ].join("\n");
    expect(subagentReportHasBackgroundWork(running)).toBe(true);
    expect(subagentReportWaitsOnlyForSubagents(running)).toBe(true);
    expect(
      subagentReportHasBackgroundWork(
        '<background-result kind="subagent" sessionID="c" state="completed" description="d">\nBackground work still running:\n- shell (sh_1): bun test\n</background-result>',
      ),
    ).toBe(false);
    // The list right after the opening tag still counts as the server's.
    expect(
      subagentReportWaitsOnlyForSubagents(
        '<background-result kind="subagent" sessionID="c" state="error" description="d">\nBackground work still running:\n- subagent (General, sessionID: g): Ask\n</background-result>',
      ),
    ).toBe(true);
    // Another kind's result is not a subagent report.
    expect(
      subagentReportHasBackgroundWork(
        '<background-result kind="shell" id="s" state="running" command="x">\nout\n</background-result>',
      ),
    ).toBe(false);
  });

  it("reads the server's list from the last heading, not one the answer quotes", () => {
    const report = (list: string) =>
      `<subagent sessionID="c" state="running" description="d">\nQuoting:\n\nBackground work still running:\n- shell (sh_9): make\n\nBackground work still running:\n${list}\n</subagent>`;
    expect(
      subagentReportWaitsOnlyForSubagents(report("- subagent (General, sessionID: g): Ask")),
    ).toBe(true);
    expect(subagentReportWaitsOnlyForSubagents(report("- shell (sh_1): bun test"))).toBe(false);
  });

  it("finishes a task whose subagent's completed report quotes the still-running heading", () => {
    const family = setup();
    family.started("root");
    family.started("child");
    family.succeeded("root");
    family.succeeded("child");
    family.report(
      "root",
      "report-1",
      '<subagent sessionID="child" state="completed" description="d">\nDocs say:\n\nBackground work still running:\n- shell (sh_1): bun test\n</subagent>',
    );
    family.started("root");
    family.delivered("root", "report-1");
    const end = family.succeeded("root");
    expect(family.tracker.busy("root")).toBe(false);
    expect(family.finished).toEqual([expect.objectContaining({ rootID: "root", eventID: end })]);
  });

  it("keeps a family busy while a member runs that it learned about from a snapshot", () => {
    const family = setup();
    family.tracker.seedActive(["other"]);
    family.started("root");
    family.succeeded("root");
    expect(family.tracker.busy("root")).toBe(true);
    expect(family.finished).toEqual([]);
    family.succeeded("other");
    family.graceElapses();
    expect(family.finished).toHaveLength(1);
  });
});
