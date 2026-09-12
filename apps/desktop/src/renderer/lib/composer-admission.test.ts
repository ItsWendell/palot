import { describe, expect, it, vi } from "vitest";
import type { PalotSession } from "../../shared";
import type { ComposerSubmission } from "./composer-draft";
import { admitComposerSubmission, type ComposerAdmissionEffects } from "./composer-admission";

const session: PalotSession = {
  id: "session-1",
  parentID: null,
  projectID: "project-1",
  title: null,
  agent: null,
  model: null,
  location: { directory: "/repo" },
  createdAt: 1,
  updatedAt: 1,
  archivedAt: null,
  cost: null,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
};
const submission: ComposerSubmission = { kind: "prompt", text: "Ship it", files: [], skills: [] };

function setup() {
  const order: string[] = [];
  const effects: ComposerAdmissionEffects = {
    setSending: vi.fn((value) => order.push(`sending:${value}`)),
    clearLocal: vi.fn(() => order.push("clear")),
    admitOptimistic: vi.fn(() => order.push("optimistic")),
    convergeReceipt: vi.fn(() => order.push("receipt")),
    rollbackOptimistic: vi.fn(() => order.push("rollback")),
    reportCreationError: vi.fn(() => order.push("creation-error")),
    reportDispatchError: vi.fn(() => order.push("dispatch-error")),
  };
  return { effects, order };
}

describe("composer admission", () => {
  it("owns clearing, optimistic admission, receipt convergence, and completion order", async () => {
    const { effects, order } = setup();
    const dispatch = vi.fn().mockResolvedValue({ id: "message-1" });
    await admitComposerSubmission({
      submission,
      files: [],
      delivery: "steer",
      createTarget: vi.fn().mockResolvedValue(session),
      dispatch,
      effects,
    });

    expect(order).toEqual(["sending:true", "optimistic", "clear", "receipt", "sending:false"]);
    expect(effects.admitOptimistic).toHaveBeenCalledWith({
      sessionID: session.id,
      message: expect.objectContaining({ delivery: "steer" }),
      execution: expect.objectContaining({ status: "running" }),
    });
    const optimistic = vi.mocked(effects.admitOptimistic).mock.calls[0]?.[0].message;
    expect(optimistic?.id).toMatch(/^msg_/);
    expect(optimistic?.optimistic).toBe(true);
    expect(dispatch).toHaveBeenCalledWith(session.id, optimistic?.id);
  });

  it("leaves local state intact and reports creation failures without optimistic rollback", async () => {
    const { effects, order } = setup();
    await admitComposerSubmission({
      submission,
      files: [],
      delivery: "steer",
      createTarget: vi.fn().mockRejectedValue(new Error("create failed")),
      dispatch: vi.fn(),
      effects,
    });

    expect(order).toEqual(["sending:true", "creation-error", "sending:false"]);
  });

  it("can dispatch commands without inventing a server receipt", async () => {
    const { effects, order } = setup();
    const dispatch = vi.fn().mockResolvedValue(undefined);

    await admitComposerSubmission({
      submission: {
        kind: "command",
        text: "/review auth",
        command: "review",
        arguments: "auth",
        files: [],
        skills: [],
      },
      files: [],
      delivery: "steer",
      optimistic: false,
      createTarget: vi.fn().mockResolvedValue(session),
      dispatch,
      effects,
    });

    expect(order).toEqual(["sending:true", "clear", "sending:false"]);
    expect(effects.admitOptimistic).not.toHaveBeenCalled();
    expect(effects.convergeReceipt).not.toHaveBeenCalled();
    expect(dispatch).toHaveBeenCalledWith(session.id, expect.stringMatching(/^msg_/));
  });

  it("leaves local state intact and rolls back only its optimistic execution on dispatch failure", async () => {
    const { effects, order } = setup();
    await admitComposerSubmission({
      submission,
      files: [],
      delivery: "steer",
      createTarget: vi.fn().mockResolvedValue(session),
      dispatch: vi.fn().mockRejectedValue(new Error("send failed")),
      effects,
    });

    expect(order).toEqual([
      "sending:true",
      "optimistic",
      "rollback",
      "dispatch-error",
      "sending:false",
    ]);
  });
});
