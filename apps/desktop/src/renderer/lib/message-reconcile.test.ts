import { describe, expect, it } from "vitest";
import type { PalotMessage } from "../../shared";
import {
  convergeMessageReceipt,
  mergeMessages,
  mergeOptimisticMessages,
  reconcileMessage,
} from "./message-reconcile";

function compaction(text: string): PalotMessage {
  return {
    id: "input-1",
    type: "compaction",
    createdAt: 1,
    completedAt: 2,
    text: null,
    finish: "stop",
    tokens: null,
    model: null,
    agent: null,
    data: null,
    content: [{ type: "compaction", id: "input-1", status: "completed", text }],
  };
}

describe("message reconciliation", () => {
  it("preserves the preferred message identity when no live-only metadata is missing", () => {
    const persisted = compaction("Persisted summary");
    expect(reconcileMessage(persisted, compaction("Live summary"), false)).toBe(persisted);
  });

  it("replaces the live compaction with its hydrated persisted message", () => {
    const merged = mergeMessages(
      [compaction("Persisted summary")],
      [compaction("Live summary")],
      false,
    );

    expect(merged).toHaveLength(1);
    expect(merged[0]?.content[0]).toMatchObject({ text: "Persisted summary" });
  });

  it("retains live first-token timing when the persisted message replaces it", () => {
    const persisted = compaction("Persisted summary");
    const live = { ...compaction("Live summary"), firstTokenAt: 3 };

    const merged = mergeMessages([persisted], [live], false);

    expect(merged[0]?.content[0]).toMatchObject({ text: "Persisted summary" });
    expect(merged[0]?.firstTokenAt).toBe(3);
  });

  it("retains ephemeral run ownership when hydrated messages replace live input", () => {
    const persisted = { ...compaction("Persisted summary"), type: "user" };
    const live = {
      ...persisted,
      delivery: "steer" as const,
      promotedAt: 2,
      runStartedAt: 3,
      runCompletedAt: 4,
    };

    const merged = mergeMessages([persisted], [live], false);

    expect(merged[0]).toMatchObject({
      delivery: "steer",
      promotedAt: 2,
      runStartedAt: 3,
      runCompletedAt: 4,
    });
  });

  it("orders equal-timestamp messages deterministically", () => {
    const merged = mergeMessages(
      [
        { ...compaction("second"), id: "message-b", type: "user" },
        { ...compaction("first"), id: "message-a", type: "user" },
      ],
      [],
      false,
    );

    expect(merged.map((message) => message.id)).toEqual(["message-a", "message-b"]);
  });

  it("converges an already-confirmed receipt in the optimistic slot", () => {
    const optimistic = {
      ...compaction("prompt"),
      id: "local-1",
      type: "user",
      timelineAt: 1,
    };
    const activity = { ...compaction("work"), id: "assistant", type: "assistant" };
    const receipt = {
      ...compaction("prompt"),
      id: "receipt-1",
      type: "user",
      createdAt: 3,
    };

    const converged = convergeMessageReceipt(
      [optimistic, activity, receipt],
      optimistic.id,
      receipt.id,
    );

    expect(converged).toEqual([{ ...receipt, timelineAt: 1 }, activity]);
  });

  it("uses the authoritative receipt time for optimistic ordering", () => {
    const optimistic = {
      ...compaction("prompt"),
      id: "msg_prompt",
      type: "user",
      optimistic: true,
      createdAt: 30,
      timelineAt: 30,
    };
    const answer = {
      ...compaction("answer"),
      id: "assistant",
      type: "assistant",
      createdAt: 20,
    };

    const converged = convergeMessageReceipt(
      [answer, optimistic],
      optimistic.id,
      optimistic.id,
      10,
    );

    expect(converged[1]).toMatchObject({ createdAt: 10, timelineAt: 10, optimistic: true });
    expect(mergeMessages(converged, [], true).map((message) => message.id)).toEqual([
      optimistic.id,
      answer.id,
    ]);
  });

  it("uses hydrated chronology rather than the retained optimistic timestamp", () => {
    const optimistic = {
      ...compaction("prompt"),
      id: "receipt-1",
      type: "user",
      timelineAt: 1,
    };
    const nextInput = {
      ...compaction("next"),
      id: "receipt-2",
      type: "user",
      createdAt: 2,
    };
    const { timelineAt: _timelineAt, ...receiptWithoutTimeline } = optimistic;
    const receipt = { ...receiptWithoutTimeline, createdAt: 3 };

    const merged = mergeMessages([receipt, nextInput], [optimistic, nextInput], false);

    expect(merged.map((message) => message.id)).toEqual(["receipt-2", "receipt-1"]);
    expect(merged[1]?.timelineAt).toBe(1);
  });

  it("keeps optimistic input visible until the authoritative message arrives", () => {
    const existing = { ...compaction("existing"), id: "existing", type: "user" };
    const optimistic = {
      ...compaction("steer"),
      id: "msg_steer",
      type: "user",
      optimistic: true,
      timelineAt: 2,
      delivery: "steer" as const,
    };

    expect(mergeOptimisticMessages([existing], [existing, optimistic])).toEqual([
      existing,
      optimistic,
    ]);
  });

  it("confirms optimistic input while retaining its admission metadata", () => {
    const optimistic = {
      ...compaction("steer"),
      id: "msg_steer",
      type: "user",
      optimistic: true,
      timelineAt: 2,
      delivery: "steer" as const,
    };
    const authoritative = {
      ...optimistic,
      optimistic: undefined,
      createdAt: 3,
      timelineAt: undefined,
    };

    expect(mergeOptimisticMessages([authoritative], [optimistic])).toEqual([
      expect.objectContaining({ id: optimistic.id, timelineAt: 2 }),
    ]);
    expect(mergeOptimisticMessages([authoritative], [optimistic])[0]?.optimistic).toBeUndefined();
  });
});
