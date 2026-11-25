import { describe, expect, it } from "vitest";
import {
  composerCanSubmit,
  primaryAction,
  primaryPresentation,
  type ComposerSubmitInput,
  type PrimaryActionInput,
} from "./primary-action";

const idle: PrimaryActionInput = {
  working: false,
  canSubmit: true,
  shell: false,
  editing: false,
  delivery: "queue",
  compactSuggested: false,
};

describe("primaryAction", () => {
  it("sends from an idle task and is disabled with nothing to send", () => {
    expect(primaryAction(idle)).toEqual({
      kind: "send",
      label: "Send message",
      disabled: false,
      alternate: null,
      stop: false,
    });
    expect(primaryAction({ ...idle, canSubmit: false })).toMatchObject({
      kind: "send",
      disabled: true,
    });
  });

  it("offers compacting first only for an ordinary idle message", () => {
    expect(primaryAction({ ...idle, compactSuggested: true })).toMatchObject({
      kind: "compact-send",
      label: "Compact and send",
      stop: false,
    });
    expect(primaryAction({ ...idle, compactSuggested: true, editing: true }).kind).toBe("update");
    expect(primaryAction({ ...idle, compactSuggested: true, working: true }).kind).toBe("queue");
  });

  it("is Stop alone while the agent works and nothing can be sent", () => {
    expect(primaryAction({ ...idle, working: true, canSubmit: false })).toEqual({
      kind: "stop",
      label: "Stop task",
      disabled: false,
      alternate: null,
      stop: false,
    });
    expect(primaryAction({ ...idle, working: true, canSubmit: false, shell: true }).kind).toBe(
      "stop",
    );
  });

  it("uses the default delivery while the agent works and keeps Stop beside it", () => {
    expect(primaryAction({ ...idle, working: true })).toEqual({
      kind: "queue",
      label: "Queue message after current turn",
      disabled: false,
      alternate: "steer",
      stop: true,
    });
    // Mod+Enter sends the other delivery, so Steer as the default offers Queue.
    expect(primaryAction({ ...idle, working: true, delivery: "steer" })).toEqual({
      kind: "steer",
      label: "Steer current turn",
      disabled: false,
      alternate: "queue",
      stop: true,
    });
  });

  it("sends an edited pending message with its own delivery", () => {
    expect(primaryAction({ ...idle, editing: true })).toMatchObject({
      kind: "update",
      label: "Send message",
      stop: false,
    });
    expect(
      primaryAction({ ...idle, editing: true, working: true, delivery: "steer" }),
    ).toMatchObject({ kind: "steer", alternate: "queue", stop: true });
  });

  it("runs a shell command, with Stop beside it while the agent works", () => {
    expect(primaryAction({ ...idle, shell: true })).toMatchObject({
      kind: "run",
      label: "Run shell command",
      alternate: null,
      stop: false,
    });
    expect(primaryAction({ ...idle, shell: true, working: true })).toMatchObject({
      kind: "run",
      stop: true,
    });
    expect(primaryAction({ ...idle, shell: true, canSubmit: false }).disabled).toBe(true);
  });
});

describe("primaryPresentation", () => {
  const options = { steerShortcut: "Ctrl+Enter", multiModel: false, compactTokens: null };
  const present = (input: Partial<PrimaryActionInput>, extra = {}) =>
    primaryPresentation(primaryAction({ ...idle, ...input }), { ...options, ...extra });

  it("shows Send and Stop as icons named for what they do", () => {
    expect(present({}).view).toEqual({ kind: "send", label: "Send message" });
    expect(present({ working: true, canSubmit: false }).view).toEqual({
      kind: "stop",
      label: "Stop task",
    });
    // An edited message goes back like any other send.
    expect(present({ editing: true }).view.kind).toBe("send");
  });

  it("words Queue, Steer, Run and Compact and send, keeping their full names", () => {
    expect(present({ working: true }).view).toEqual({
      kind: "queue",
      label: "Queue",
      name: "Queue message after current turn",
    });
    expect(present({ working: true, delivery: "steer" }).view).toMatchObject({
      kind: "steer",
      label: "Steer",
    });
    expect(present({ shell: true }).view).toEqual({
      kind: "run",
      label: "Run",
      name: "Run shell command",
    });
    expect(present({ compactSuggested: true }, { compactTokens: 150_000 })).toMatchObject({
      view: { kind: "compact-send", label: "Compact and send" },
      tooltip: "Summarize 150k tokens of history, then send",
    });
  });

  it("previews the other delivery under each default and names both keys", () => {
    const queue = present({ working: true });
    expect(queue.preview).toEqual({ kind: "steer", label: "Steer", name: "Steer current turn" });
    expect(queue.tooltip).toBe("Queue after the current turn · Enter. Steer it now · Ctrl+Enter");
    const steer = present({ working: true, delivery: "steer" });
    expect(steer.preview).toEqual({
      kind: "queue",
      label: "Queue",
      name: "Queue message after current turn",
    });
    expect(steer.tooltip).toBe(
      "Steer the current turn · Enter. Queue it after the turn · Ctrl+Enter",
    );
    expect(present({ working: true }, { queueFirstShortcut: "Alt+Enter" }).tooltip).toBe(
      "Queue after the current turn · Enter. Steer it now · Ctrl+Enter. Queue it first · Alt+Enter",
    );
  });

  it("mentions Shift-click only where it sends to several models", () => {
    expect(present({}, { multiModel: true }).tooltip).toContain("Shift-click");
    expect(present({}).tooltip).not.toContain("Shift-click");
  });
});

describe("composerCanSubmit", () => {
  const ready: ComposerSubmitInput = {
    shell: false,
    hasText: true,
    btw: false,
    hasContext: false,
    uploading: false,
    selectionBlocked: false,
    permissionsBusy: false,
    locationMissing: false,
    requestOpen: false,
    sending: false,
    canceling: false,
    connected: true,
  };

  it("needs text or context to send", () => {
    expect(composerCanSubmit(ready)).toBe(true);
    expect(composerCanSubmit({ ...ready, hasText: false })).toBe(false);
    expect(composerCanSubmit({ ...ready, hasText: false, hasContext: true })).toBe(true);
  });

  it("never submits while sending, canceling an input, or disconnected", () => {
    for (const blocked of [{ sending: true }, { canceling: true }, { connected: false }])
      for (const shell of [false, true])
        expect(composerCanSubmit({ ...ready, ...blocked, shell, btw: true })).toBe(false);
  });

  it("sends a prompt during an upload, which holds it until the upload finishes", () => {
    expect(composerCanSubmit({ ...ready, uploading: true })).toBe(true);
    // A pasted screenshot still uploading is enough to send.
    expect(composerCanSubmit({ ...ready, hasText: false, uploading: true })).toBe(true);
  });

  it("lets a /btw question through a blocked selection or an open request", () => {
    for (const blocked of [
      { selectionBlocked: true },
      { permissionsBusy: true },
      { locationMissing: true },
      { requestOpen: true },
    ]) {
      expect(composerCanSubmit({ ...ready, ...blocked })).toBe(false);
      expect(composerCanSubmit({ ...ready, ...blocked, btw: true })).toBe(true);
    }
  });

  it("runs shell text regardless of an open request, but not without text", () => {
    expect(composerCanSubmit({ ...ready, shell: true, requestOpen: true })).toBe(true);
    expect(composerCanSubmit({ ...ready, shell: true, hasText: false, hasContext: true })).toBe(
      false,
    );
    expect(composerCanSubmit({ ...ready, shell: true, uploading: true })).toBe(false);
  });
});
