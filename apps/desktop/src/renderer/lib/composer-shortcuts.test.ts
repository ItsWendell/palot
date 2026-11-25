import { describe, expect, it } from "vitest";
import { composerEnterAction, type ComposerEnterState } from "./composer-shortcuts";

const enter = { key: "Enter", shiftKey: false, metaKey: false, ctrlKey: false };
const steerKeys = { ...enter, ctrlKey: true };
const ready: ComposerEnterState = {
  empty: true,
  working: true,
  queued: 3,
  editing: false,
  shell: false,
  submitting: false,
  delivery: "queue",
};

describe("composerEnterAction", () => {
  it("steers the first queued message on an empty composer while the task works", () => {
    expect(composerEnterAction(steerKeys, ready)).toBe("steer-first");
    expect(composerEnterAction({ ...enter, metaKey: true }, ready)).toBe("steer-first");
  });

  it.each<[string, Partial<ComposerEnterState>]>([
    ["the composer holds a message", { empty: false }],
    ["nothing is queued", { queued: 0 }],
    ["a queued message is being edited", { editing: true }],
    ["the composer is in shell mode", { shell: true }],
    ["a submission is in progress", { submitting: true }],
  ])("keeps the steer keys on the composer when %s", (_, change) => {
    expect(composerEnterAction(steerKeys, { ...ready, ...change })).toBe("steer");
  });

  it("sends the other delivery with Mod+Enter while the task works", () => {
    const typed = { ...ready, empty: false };
    expect(composerEnterAction(steerKeys, typed)).toBe("steer");
    expect(composerEnterAction(steerKeys, { ...typed, delivery: "steer" })).toBe("queue");
    // On an empty composer it still steers the first queued message, whatever the default.
    expect(composerEnterAction(steerKeys, { ...ready, delivery: "steer" })).toBe("steer-first");
  });

  it("queues first with Alt+Enter while the task works, and sends like Enter otherwise", () => {
    const alt = { ...enter, altKey: true };
    const typed = { ...ready, empty: false };
    expect(composerEnterAction(alt, typed)).toBe("queue-first");
    expect(composerEnterAction(alt, { ...typed, delivery: "steer" })).toBe("queue-first");
    expect(composerEnterAction(alt, { ...typed, queued: 0 })).toBe("queue-first");
    expect(composerEnterAction(alt, { ...typed, working: false })).toBe("send");
    expect(composerEnterAction(alt, { ...typed, shell: true })).toBe("send");
    expect(composerEnterAction({ ...alt, shiftKey: true }, typed)).toBeNull();
  });

  it("sends with the steer keys when the task is idle", () => {
    expect(composerEnterAction(steerKeys, { ...ready, working: false })).toBe("send");
  });

  it("sends with plain Enter whatever is queued", () => {
    expect(composerEnterAction(enter, ready)).toBe("send");
    expect(composerEnterAction(enter, { ...ready, empty: false })).toBe("send");
  });

  it("leaves Shift+Enter and other keys to the input", () => {
    expect(composerEnterAction({ ...steerKeys, shiftKey: true }, ready)).toBeNull();
    expect(composerEnterAction({ ...enter, key: "a" }, ready)).toBeNull();
  });
});
