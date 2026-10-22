import { describe, expect, it } from "vitest";
import { describeSession, REPLY_CHAR_LIMIT } from "./session";
import { agentSwitched, assistant, idle, question, sessionInfo, text, user } from "./test-fixtures";

describe("describeSession", () => {
  it("reports a finished turn as idle with its outcome", () => {
    const snapshot = describeSession(
      sessionInfo({ outcome: "failed" }),
      [user("fix it"), assistant(text("Tried")), idle("failed")],
      0,
    );
    expect(snapshot).toMatchObject({ status: "idle", outcome: "failed", pendingQuestions: 0 });
    expect(snapshot.replies).toBeUndefined();
  });

  it("treats a prompt after the last idle marker as a running turn", () => {
    const snapshot = describeSession(
      sessionInfo({ outcome: "succeeded" }),
      [user("one"), idle(), user("two")],
      0,
    );
    expect(snapshot.status).toBe("busy");
    expect(snapshot.outcome).toBeUndefined();
  });

  it("does not count an agent switch while idle as work", () => {
    expect(describeSession(sessionInfo(), [user("one"), idle(), agentSwitched()], 0).status).toBe(
      "idle",
    );
  });

  it("needs input while a permission is pending or a question is open", () => {
    expect(describeSession(sessionInfo(), [user("go"), assistant()], 1).status).toBe("needs_input");

    const asking = describeSession(sessionInfo(), [user("go"), assistant(question("running"))], 0);
    expect(asking).toMatchObject({ status: "needs_input", pendingQuestions: 1 });

    const answered = describeSession(
      sessionInfo(),
      [user("go"), assistant(question("completed"))],
      0,
    );
    expect(answered).toMatchObject({ status: "busy", pendingQuestions: 0 });
  });

  it("returns the newest replies oldest first, skipping tool-only steps", () => {
    const messages = [
      user("go"),
      assistant(text("First")),
      assistant(question("completed")),
      assistant(text("Second"), text("continued")),
      idle(),
    ];
    expect(describeSession(sessionInfo(), messages, 0, 1).replies).toEqual(["Second\ncontinued"]);
    expect(describeSession(sessionInfo(), messages, 0, 5).replies).toEqual([
      "First",
      "Second\ncontinued",
    ]);
  });

  it("cuts long replies so the opening survives", () => {
    const long = `Done. ${"x".repeat(REPLY_CHAR_LIMIT * 2)}`;
    const [reply] =
      describeSession(sessionInfo(), [assistant(text(long)), idle()], 0, 1).replies ?? [];
    expect(reply?.startsWith("Done.")).toBe(true);
    expect(reply?.endsWith("…")).toBe(true);
    expect(reply?.length).toBe(REPLY_CHAR_LIMIT + 1);
  });
});
