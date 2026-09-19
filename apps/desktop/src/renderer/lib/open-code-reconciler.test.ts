import type { PermissionRuleset, SessionInfo, SessionLogOutput } from "@opencode/client";
import { describe, expect, it, vi } from "vitest";
import type { PalotEvent, PalotEventBatch, PalotMessage } from "../../shared";
import { OpenCodeReconciler } from "./open-code-reconciler";
import { getStreamingPatchLine, getStreamingPatchLineCount } from "./streaming-patch-input";
import { projectToolExecution } from "./tool-executions";

function event(type: PalotEvent["type"], sequence: number, data: unknown): PalotEvent {
  return {
    id: `${type}-${sequence}`,
    type,
    created: sequence,
    createdAt: sequence,
    receiveSequence: sequence,
    data,
  } as PalotEvent;
}

function batch(sequence: number, events: PalotEvent[]): PalotEventBatch {
  return {
    connectionID: "connection",
    contractVersion: "test",
    streamEpoch: 1,
    batchSequence: sequence,
    receivedAt: sequence,
    sentAt: sequence,
    events,
  };
}

function session(title: string): SessionInfo {
  return {
    id: "session",
    projectID: "project",
    title,
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 1, updated: 1 },
    location: { directory: "/repo" },
  };
}

function assistant(text: string): PalotMessage {
  return {
    id: "message",
    type: "assistant",
    createdAt: 1,
    completedAt: null,
    text,
    agent: "build",
    model: null,
    tokens: null,
    finish: null,
    content: [{ type: "text", text }],
    data: null,
  };
}

describe("OpenCodeReconciler", () => {
  it("hydrates created permissions and applies foreign normal, full, and custom updates on only their connection", () => {
    const reconciler = new OpenCodeReconciler();
    const full: PermissionRuleset = [{ action: "*", resource: "*", effect: "allow" }];
    reconciler.upsertSessionInfos("other", [{ ...session("Other owner"), permissions: full }]);
    reconciler.applyBatch(
      batch(1, [
        event("session.created", 1, {
          sessionID: "session",
          projectID: "project",
          location: { directory: "/repo" },
          permissions: full,
        }),
      ]),
    );
    expect(reconciler.session("connection", "session")?.permissions).toEqual(full);
    const snapshot = reconciler.beginSnapshot("connection");
    const rulesets: PermissionRuleset[] = [
      [],
      full,
      [{ action: "shell", resource: "git *", effect: "ask" }],
    ];
    for (const [index, permissions] of rulesets.entries()) {
      reconciler.applyBatch(
        batch(index + 2, [
          event("session.permissions", index + 2, {
            sessionID: "session",
            permissions,
          }),
        ]),
      );
      expect(reconciler.session("connection", "session")?.permissions).toEqual(permissions);
      expect(reconciler.session("other", "session")?.permissions).toEqual(full);
    }
    reconciler.upsertSessionInfos(
      "connection",
      [{ ...session("Stale snapshot"), permissions: full }],
      snapshot,
    );
    expect(reconciler.session("connection", "session")?.permissions).toEqual(rulesets[2]);
  });

  it("replays durable permission rules and ignores already admitted older changes", () => {
    const reconciler = new OpenCodeReconciler();
    const full: PermissionRuleset = [{ action: "*", resource: "*", effect: "allow" }];
    const created = {
      ...event("session.created", 1, {
        sessionID: "session",
        projectID: "project",
        location: { directory: "/repo" },
        permissions: full,
      }),
      durable: { aggregateID: "session", seq: 1, version: 1 },
    } as SessionLogOutput;
    const normal = {
      ...event("session.permissions", 2, { sessionID: "session", permissions: [] }),
      durable: { aggregateID: "session", seq: 2, version: 1 },
    } as SessionLogOutput;
    reconciler.applyReplay("connection", "session", [
      created,
      normal,
      { type: "log.synced", aggregateID: "session", seq: 2 },
    ]);
    expect(reconciler.session("connection", "session")?.permissions).toEqual([]);
    const custom: PermissionRuleset = [{ action: "shell", resource: "rm *", effect: "deny" }];
    reconciler.applyBatch(
      batch(1, [
        {
          ...event("session.permissions", 3, { sessionID: "session", permissions: custom }),
          durable: { aggregateID: "session", seq: 3, version: 1 },
        } as PalotEvent,
      ]),
    );
    const replay = reconciler.applyReplay("connection", "session", [
      created,
      normal,
      { type: "log.synced", aggregateID: "session", seq: 3 },
    ]);
    expect(replay.events).toHaveLength(0);
    expect(reconciler.session("connection", "session")?.permissions).toEqual(custom);
  });

  it.each(["text", "reasoning"] as const)(
    "keeps live %s when its older durable started event arrives through replay",
    (type) => {
      const reconciler = new OpenCodeReconciler();
      const address = { sessionID: "session", assistantMessageID: "message", ordinal: 0 };
      reconciler.applyBatch(
        batch(1, [event(`session.${type}.delta`, 20, { ...address, delta: "Live prefix" })]),
      );
      const replay = reconciler.applyReplay("connection", "session", [
        {
          ...event(`session.${type}.started`, 10, address),
          durable: { aggregateID: "session", seq: 1, version: 1 },
        } as SessionLogOutput,
        { type: "log.synced", aggregateID: "session", seq: 1 },
      ]);
      expect(replay.events).toHaveLength(1);
      expect(reconciler.messages("connection", "session")[0]?.content[0]?.text).toBe("Live prefix");
      reconciler.applyBatch(
        batch(2, [event(`session.${type}.delta`, 21, { ...address, delta: " suffix" })]),
      );
      const message = reconciler.messages("connection", "session")[0]!;
      expect(message.content[0]).toMatchObject({
        text: "Live prefix suffix",
        streaming: true,
        time: { created: 10 },
      });
      expect(message.firstTokenAt).toBe(20);
      if (type === "text") expect(message.text).toBe("Live prefix suffix");
    },
  );

  it.each(["text", "reasoning"] as const)(
    "accepts authoritative %s snapshots without preserving finalized, replaced, or unobserved streams",
    (type) => {
      for (const boundary of [
        "nonempty",
        "snapshot-completed",
        "message-completed",
        "focus-away",
        "identity",
        "part-restarted",
        "part-completed",
        "no-delta",
      ] as const) {
        const reconciler = new OpenCodeReconciler();
        const seed: PalotMessage = {
          ...assistant(""),
          content: [
            {
              type,
              text: "",
              id: "part",
              ...(boundary === "part-restarted" ? { time: { created: 1 } } : {}),
            },
          ],
        };
        reconciler.setTranscriptSnapshot("connection", "session", [seed], "rooted");
        const address = { sessionID: "session", assistantMessageID: "message", ordinal: 0 };
        if (boundary !== "no-delta")
          reconciler.applyBatch(
            batch(1, [
              event(`session.${type}.delta`, 1, { ...address, delta: "Long live prefix" }),
            ]),
          );
        if (boundary === "message-completed")
          reconciler.applyBatch(
            batch(2, [event("session.step.ended", 2, { ...address, finish: "stop" })]),
          );
        if (boundary === "focus-away") {
          reconciler.setFocusedConnection("other");
          reconciler.applyBatch(
            batch(2, [event(`session.${type}.delta`, 2, { ...address, delta: " missed" })]),
          );
          reconciler.setFocusedConnection("connection");
        }
        const text = boundary === "nonempty" ? "Short" : "";
        const snapshot: PalotMessage = {
          ...seed,
          text: type === "text" ? text : null,
          completedAt: boundary === "snapshot-completed" ? 3 : null,
          content: [
            {
              type,
              text,
              id: boundary === "identity" ? "replacement" : "part",
              ...(boundary === "part-restarted" ? { time: { created: 3 } } : {}),
              ...(boundary === "part-completed" ? { time: { created: 1, completed: 3 } } : {}),
            },
          ],
        };
        reconciler.setTranscriptSnapshot(
          "connection",
          "session",
          [snapshot],
          "recent",
          reconciler.beginSnapshot("connection"),
        );
        expect(reconciler.messages("connection", "session")[0], boundary).toEqual(snapshot);
        // Once replaced, the old ephemeral annotation cannot leak into later empty fetches.
        reconciler.setTranscriptSnapshot(
          "connection",
          "session",
          [seed],
          "rooted",
          reconciler.beginSnapshot("connection"),
        );
        expect(reconciler.messages("connection", "session")[0]?.content[0]?.text, boundary).toBe(
          "",
        );
      }
    },
  );

  it("matches interleaved text and reasoning by typed ordinal while accepting part metadata", () => {
    const reconciler = new OpenCodeReconciler();
    const seed: PalotMessage = {
      ...assistant(""),
      content: [
        { type: "reasoning", text: "Settled thought" },
        { type: "text", text: "Settled answer" },
        { type: "reasoning", text: "" },
        { type: "text", text: "" },
      ],
    };
    reconciler.setTranscriptSnapshot("connection", "session", [seed], "rooted");
    const address = { sessionID: "session", assistantMessageID: "message", ordinal: 1 };
    reconciler.applyBatch(
      batch(1, [
        event("session.reasoning.delta", 1, { ...address, delta: "Live thought" }),
        event("session.text.delta", 2, { ...address, delta: "Live answer" }),
      ]),
    );
    const snapshot: PalotMessage = {
      ...seed,
      content: seed.content.map((part) => ({
        ...part,
        presentation: "recap",
        data: { fresh: true },
      })),
    };
    reconciler.setTranscriptSnapshot(
      "connection",
      "session",
      [snapshot],
      "recent",
      reconciler.beginSnapshot("connection"),
    );
    const message = reconciler.messages("connection", "session")[0]!;
    expect(message.content.map((part) => part.text)).toEqual([
      "Settled thought",
      "Settled answer",
      "Live thought",
      "Live answer",
    ]);
    expect(message.text).toBe("Settled answerLive answer");
    expect(message.firstTokenAt).toBe(1);
    expect(message.content[2]).toMatchObject({ presentation: "recap", data: { fresh: true } });
  });

  it.each(["recent", "rooted"] as const)(
    "preserves ephemeral text and reasoning through a %s snapshot begun between deltas",
    (mode) => {
      for (const type of ["text", "reasoning"] as const) {
        const reconciler = new OpenCodeReconciler();
        const seed: PalotMessage = {
          ...assistant(""),
          content: [{ type, text: "" }],
        };
        reconciler.setTranscriptSnapshot("connection", "session", [seed], "rooted");
        const address = { sessionID: "session", assistantMessageID: "message", ordinal: 0 };
        const prefix = Array.from({ length: 16 }, (_, i) => `${i} `).join("");
        const suffix = Array.from({ length: 16 }, (_, i) => `${i + 16} `).join("");
        reconciler.applyBatch(
          batch(1, [event(`session.${type}.delta`, 1, { ...address, delta: prefix })]),
        );
        const token = reconciler.beginSnapshot("connection");
        const snapshot = { ...seed, agent: "server-agent", data: { metadata: "fresh" } };
        reconciler.setTranscriptSnapshot("connection", "session", [snapshot], mode, token);
        const hydrated = reconciler.messages("connection", "session")[0]!;
        expect(hydrated.content[0]?.text).toBe(prefix);
        expect(hydrated.firstTokenAt).toBe(1);
        expect(hydrated.agent).toBe("server-agent");
        expect(hydrated.data).toEqual({ metadata: "fresh" });
        if (type === "text") expect(hydrated.text).toBe(prefix);

        // Repeating the same empty persisted body must not publish another change.
        reconciler.setTranscriptSnapshot(
          "connection",
          "session",
          [snapshot],
          mode,
          reconciler.beginSnapshot("connection"),
        );
        expect(reconciler.messages("connection", "session")[0]).toBe(hydrated);
        reconciler.applyBatch(
          batch(2, [event(`session.${type}.delta`, 2, { ...address, delta: suffix })]),
        );
        expect(reconciler.messages("connection", "session")[0]?.content[0]?.text).toBe(
          prefix + suffix,
        );

        // Ended is a full value, not an append or a longest-string heuristic.
        reconciler.applyBatch(
          batch(3, [event(`session.${type}.ended`, 3, { ...address, text: "Final" })]),
        );
        expect(reconciler.messages("connection", "session")[0]?.content[0]?.text).toBe("Final");
        reconciler.setTranscriptSnapshot(
          "connection",
          "session",
          [seed],
          mode,
          reconciler.beginSnapshot("connection"),
        );
        expect(reconciler.messages("connection", "session")[0]?.content[0]?.text).toBe("");
      }
    },
  );

  it("keeps background summaries and raw events without scanning or allocating transcripts", () => {
    const reconciler = new OpenCodeReconciler();
    reconciler.setFocusedConnection("focused");
    const events = [
      event("session.created", 1, {
        sessionID: "session",
        projectID: "project",
        location: { directory: "/repo" },
      }),
      event("session.execution.started", 2, { sessionID: "session" }),
      event("session.step.started", 3, { sessionID: "session", assistantMessageID: "message" }),
      event("session.text.delta", 4, {
        sessionID: "session",
        assistantMessageID: "message",
        ordinal: 0,
        delta: "Hello",
      }),
      event("permission.asked", 5, {
        id: "permission",
        sessionID: "session",
        action: "shell",
        resources: [],
      }),
      event("form.created", 6, { form: { id: "form", sessionID: "session", questions: [] } }),
      event("session.inbox.enqueued", 7, {
        sessionID: "session",
        inboxID: "inbox",
        item: { type: "message", text: "queued", delivery: "queue" },
      }),
    ];
    const listener = vi.fn();
    reconciler.subscribe(listener);
    const messages = vi.spyOn(reconciler, "messages");
    const background = { ...batch(1, events), connectionID: "background" };
    const result = reconciler.applyBatch(background);
    expect(messages).not.toHaveBeenCalled();
    expect(result.events).toEqual(events);
    expect(result.missingMessageSessionIDs).toEqual([]);
    expect(listener).toHaveBeenCalledWith({ batch: background, result });
    expect(reconciler.messages("background", "session")).toEqual([]);
    expect(reconciler.activity("background").activeIDs.has("session")).toBe(true);
    expect(reconciler.requests("background", "session")).toMatchObject({
      permissions: [{ id: "permission" }],
      forms: [{ id: "form" }],
      inbox: [{ id: "inbox" }],
    });

    reconciler.applyBatch({ ...batch(1, events), connectionID: "focused" });
    expect(reconciler.messages("focused", "session")[0]?.content[0]?.text).toBe("Hello");
    const settled = reconciler.applyBatch({
      ...batch(3, [
        event("session.execution.succeeded", 9, { sessionID: "session" }),
        event("permission.replied", 10, { sessionID: "session", requestID: "permission" }),
        event("form.replied", 11, { sessionID: "session", id: "form" }),
        event("session.inbox.delivered", 12, { sessionID: "session", inboxID: "inbox" }),
      ]),
      connectionID: "background",
    });
    expect(settled.gap).toBe(true);
    expect(settled.gapSessionIDs).toEqual(["session"]);
    expect(settled.missingMessageSessionIDs).toEqual([]);
    expect(reconciler.session("background", "session")?.outcome).toBe("succeeded");
    expect(reconciler.activity("background").activeIDs.has("session")).toBe(false);
    expect(reconciler.requests("background", "session")).toMatchObject({
      permissions: [],
      forms: [],
      inbox: [],
    });
    expect(reconciler.activity("focused").activeIDs.has("session")).toBe(true);
    expect(reconciler.requests("focused", "session")?.permissions).toHaveLength(1);
  });

  it("retains background snapshots and replay ordering until focus rehydrates them", () => {
    const reconciler = new OpenCodeReconciler();
    reconciler.setTranscriptSnapshot("connection", "session", [assistant("Old")], "rooted");
    const old = reconciler.messages("connection", "session")[0];
    reconciler.setFocusedConnection(null);
    const delta = {
      ...event("session.text.delta", 1, {
        sessionID: "session",
        assistantMessageID: "message",
        ordinal: 0,
        delta: " skipped",
      }),
      durable: { aggregateID: "session", seq: 1, version: 1 },
    } as PalotEvent;
    const messages = vi.spyOn(reconciler, "messages");
    const replay = reconciler.applyReplay("connection", "session", [
      delta as SessionLogOutput,
      { type: "log.synced", aggregateID: "session", seq: 1 },
    ]);
    expect(messages).not.toHaveBeenCalled();
    expect(replay.events).toHaveLength(1);
    expect(reconciler.replayCursor("connection", "session")).toBe(1);
    expect(reconciler.applyBatch(batch(1, [delta])).events).toEqual([]);
    expect(reconciler.messages("connection", "session")[0]).toBe(old);

    reconciler.setFocusedConnection("connection");
    reconciler.setTranscriptSnapshot(
      "connection",
      "session",
      [assistant("Authoritative")],
      "rooted",
      reconciler.beginSnapshot("connection"),
    );
    reconciler.applyBatch(
      batch(2, [
        event("session.text.delta", 2, {
          sessionID: "session",
          assistantMessageID: "message",
          ordinal: 0,
          delta: " live",
        }),
      ]),
    );
    expect(reconciler.messages("connection", "session")[0]?.content[0]?.text).toBe(
      "Authoritative live",
    );
  });

  it("publishes catalog, runtime, and request changes as one event batch", () => {
    const reconciler = new OpenCodeReconciler();
    const publications: string[][] = [];
    const subscription = reconciler.graph.collection.subscribeChanges((changes) => {
      publications.push(changes.map((change) => change.value.kind).toSorted());
    });

    reconciler.applyBatch(
      batch(1, [
        event("session.created", 1, {
          sessionID: "session",
          projectID: "project",
          location: { directory: "/repo" },
        }),
        event("session.execution.started", 2, { sessionID: "session" }),
        event("permission.asked", 3, {
          id: "permission",
          sessionID: "session",
          action: "shell",
          resources: [],
        }),
      ]),
    );

    expect(publications).toEqual([["session", "session-request", "session-runtime"]]);
    expect(reconciler.activity("connection").execution.get("session")?.status).toBe("running");
    expect(reconciler.requests("connection", "session")?.permissions).toHaveLength(1);
    subscription.unsubscribe();
  });

  it("rejects duplicate durable events while advancing transport ordering", () => {
    const reconciler = new OpenCodeReconciler();
    reconciler.upsertSessionInfos("connection", [session("Original")]);
    const first = {
      ...event("session.renamed", 1, { sessionID: "session", title: "Renamed" }),
      durable: { aggregateID: "session", seq: 1, version: 1 },
    } as PalotEvent;
    const duplicate = {
      ...event("session.renamed", 2, { sessionID: "session", title: "Stale duplicate" }),
      receiveSequence: 2,
      durable: { aggregateID: "session", seq: 1, version: 1 },
    } as PalotEvent;

    expect(reconciler.applyBatch(batch(1, [first])).events).toHaveLength(1);
    expect(reconciler.applyBatch(batch(2, [duplicate])).events).toHaveLength(0);
    expect(reconciler.session("connection", "session")?.title).toBe("Renamed");
  });

  it("does not treat a public durable sequence jump as a transport gap", () => {
    const reconciler = new OpenCodeReconciler();
    reconciler.upsertSessionInfos("connection", [session("Original")]);
    const first = {
      ...event("session.renamed", 1, { sessionID: "session", title: "First" }),
      durable: { aggregateID: "session", seq: 1, version: 1 },
    } as PalotEvent;
    const third = {
      ...event("session.renamed", 2, { sessionID: "session", title: "Third" }),
      durable: { aggregateID: "session", seq: 3, version: 1 },
    } as PalotEvent;

    expect(reconciler.applyBatch(batch(1, [first])).gap).toBe(false);
    expect(reconciler.applyBatch(batch(2, [third])).gap).toBe(false);
    expect(reconciler.session("connection", "session")?.title).toBe("Third");
  });

  it("applies replay through the canonical reducer and commits the synced cursor", () => {
    const reconciler = new OpenCodeReconciler();
    reconciler.upsertSessionInfos("connection", [session("Original")]);
    const live = {
      ...event("session.renamed", 1, { sessionID: "session", title: "Live" }),
      durable: { aggregateID: "session", seq: 2, version: 1 },
    } as PalotEvent;
    reconciler.applyBatch(batch(1, [live]));

    const replay = reconciler.applyReplay("connection", "session", [
      {
        ...live,
        created: live.createdAt,
        data: { sessionID: "session", title: "Duplicate" },
      } as SessionLogOutput,
      {
        ...live,
        id: "session.renamed-3",
        created: 3,
        data: { sessionID: "session", title: "Replay" },
        durable: { aggregateID: "session", seq: 3, version: 1 },
      } as SessionLogOutput,
      { type: "log.synced", aggregateID: "session", seq: 4 },
    ]);

    expect(replay.events).toHaveLength(1);
    expect(replay.cursor).toBe(4);
    expect(reconciler.replayCursor("connection", "session")).toBe(4);
    expect(reconciler.session("connection", "session")?.title).toBe("Replay");
  });

  it("does not apply or advance an incomplete replay", () => {
    const reconciler = new OpenCodeReconciler();
    reconciler.upsertSessionInfos("connection", [session("Original")]);
    const item = {
      ...event("session.renamed", 1, { sessionID: "session", title: "Incomplete" }),
      created: 1,
      durable: { aggregateID: "session", seq: 1, version: 1 },
    } as SessionLogOutput;

    const replay = reconciler.applyReplay("connection", "session", [item]);

    expect(replay.synced).toBe(false);
    expect(reconciler.replayCursor("connection", "session")).toBeUndefined();
    expect(reconciler.session("connection", "session")?.title).toBe("Original");
  });

  it("does not admit a snapshot over a record changed after its watermark", () => {
    const reconciler = new OpenCodeReconciler();
    reconciler.upsertSessionInfos("connection", [session("Original")]);
    const token = reconciler.beginSnapshot("connection");
    reconciler.applyBatch(
      batch(1, [event("session.renamed", 1, { sessionID: "session", title: "Live" })]),
    );

    reconciler.upsertSessionInfos("connection", [session("Stale snapshot")], token);

    expect(reconciler.session("connection", "session")?.title).toBe("Live");
  });

  it("reduces live transcript events against the DB snapshot", () => {
    const reconciler = new OpenCodeReconciler();
    reconciler.setTranscriptSnapshot("connection", "session", [assistant("Hello")], "rooted");

    const result = reconciler.applyBatch(
      batch(1, [
        event("session.text.delta", 1, {
          sessionID: "session",
          assistantMessageID: "message",
          ordinal: 0,
          delta: " world",
        }),
      ]),
    );

    expect(result.changedSessionIDs).toEqual(["session"]);
    expect(result.changedTranscriptSessionIDs).toEqual(["session"]);
    expect(reconciler.messages("connection", "session")[0]?.content[0]?.text).toBe("Hello world");
  });

  it("reports actual committed transcript changes separately from metadata event owners", () => {
    const reconciler = new OpenCodeReconciler();
    reconciler.upsertSessionInfos("connection", [session("Original")]);
    reconciler.applyBatch(
      batch(0, [
        event("session.text.ended", 0, {
          sessionID: "session",
          assistantMessageID: "message",
          ordinal: 0,
          text: "Hello",
        }),
      ]),
    );
    const message = reconciler.messages("connection", "session")[0];
    const metadata = reconciler.applyBatch(
      batch(1, [
        event("session.viewed", 1, { sessionID: "session", idle: 100 }),
        event("session.status", 2, { sessionID: "session", status: { type: "busy" } }),
      ]),
    );
    expect(metadata.changedSessionIDs).toEqual(["session"]);
    expect(metadata.changedTranscriptSessionIDs).toEqual([]);
    expect(reconciler.session("connection", "session")?.time.viewed).toBe(100);

    // This reducer produces fresh objects, but the graph suppresses deep-equal writes.
    const noop = reconciler.applyBatch(
      batch(2, [
        event("session.text.ended", 3, {
          sessionID: "session",
          assistantMessageID: "message",
          ordinal: 0,
          text: "Hello",
        }),
        event("session.viewed", 4, { sessionID: "session", idle: 200 }),
      ]),
    );
    expect(noop.changedSessionIDs).toEqual(["session"]);
    expect(noop.changedTranscriptSessionIDs).toEqual([]);
    expect(reconciler.messages("connection", "session")[0]).toBe(message);

    const changed = reconciler.applyBatch(
      batch(3, [
        event("session.text.ended", 5, {
          sessionID: "session",
          assistantMessageID: "message",
          ordinal: 0,
          text: "Goodbye",
        }),
      ]),
    );
    expect(changed.changedTranscriptSessionIDs).toEqual(["session"]);
    const duplicate = reconciler.applyBatch(batch(3, changed.events));
    expect(duplicate.changedTranscriptSessionIDs).toEqual([]);
  });

  it("reports missing-message deltas only when the reducer actually creates a transcript record", () => {
    const reconciler = new OpenCodeReconciler();
    const missing = reconciler.applyBatch(
      batch(1, [
        event("session.text.delta", 1, {
          sessionID: "session",
          assistantMessageID: "missing",
          ordinal: 0,
          delta: "Hello",
        }),
      ]),
    );
    expect(missing.missingMessageSessionIDs).toEqual(["session"]);
    expect(missing.changedTranscriptSessionIDs).toEqual(["session"]);
    expect(reconciler.messages("connection", "session")[0]?.id).toBe("missing");

    reconciler.setFocusedConnection("other");
    const background = reconciler.applyBatch(
      batch(2, [
        event("session.text.delta", 2, {
          sessionID: "session",
          assistantMessageID: "another-missing",
          ordinal: 0,
          delta: "Ignored without transcript interest",
        }),
      ]),
    );
    expect(background.changedSessionIDs).toEqual(["session"]);
    expect(background.changedTranscriptSessionIDs).toEqual([]);
  });

  it("reports removed message records including cascaded session deletion", () => {
    const reconciler = new OpenCodeReconciler();
    reconciler.upsertSessionInfos("connection", [
      session("Parent"),
      { ...session("Child"), id: "child", parentID: "session" },
    ]);
    reconciler.setTranscriptSnapshot("connection", "session", [assistant("Parent")], "rooted");
    reconciler.setTranscriptSnapshot("connection", "child", [assistant("Child")], "rooted");
    const result = reconciler.applyBatch(
      batch(1, [event("session.deleted", 1, { sessionID: "session" })]),
    );
    expect(result.changedSessionIDs).toEqual(["session"]);
    expect(result.changedTranscriptSessionIDs).toEqual(["session", "child"]);
  });

  it("preserves transcript events received while a snapshot is in flight", () => {
    const reconciler = new OpenCodeReconciler();
    reconciler.setTranscriptSnapshot("connection", "session", [assistant("Hello")], "rooted");
    const token = reconciler.beginSnapshot("connection");
    reconciler.applyBatch(
      batch(1, [
        event("session.text.delta", 1, {
          sessionID: "session",
          assistantMessageID: "message",
          ordinal: 0,
          delta: " live",
        }),
      ]),
    );

    reconciler.setTranscriptSnapshot(
      "connection",
      "session",
      [assistant("Stale snapshot")],
      "recent",
      token,
    );

    expect(reconciler.messages("connection", "session")[0]?.content[0]?.text).toBe("Hello live");
  });

  it.each(["rooted", "recent"] as const)(
    "preserves an ephemeral patch decoder across a %s snapshot begun between input deltas",
    (mode) => {
      const reconciler = new OpenCodeReconciler();
      reconciler.setTranscriptSnapshot(
        "connection",
        "session",
        [assistant("Local text")],
        "rooted",
      );
      const data = { sessionID: "session", assistantMessageID: "message", id: "patch-1" };
      const lines = [
        "*** Begin Patch",
        "*** Update File: src/old.ts",
        "*** Move to: src/new.ts",
        ...Array.from({ length: 160 }, (_, index) => `+line ${index}`),
        "+continued",
        "*** Add File: src/added.ts",
        "+new file",
        "*** End Patch",
      ];
      const patchText = lines.join("\n");
      const json = JSON.stringify({ patchText });
      // Pause after the backslash of a JSON newline escape, not at a decoder boundary.
      const boundary = json.indexOf("\\n+continued") + 1;
      reconciler.applyBatch(
        batch(1, [
          event("session.tool.input.started", 1, { ...data, name: "patch" }),
          event("session.tool.input.delta", 2, { ...data, delta: json.slice(0, boundary) }),
        ]),
      );
      const token = reconciler.beginSnapshot("connection");
      const snapshot: PalotMessage = {
        ...assistant("Authoritative text"),
        content: [
          { type: "text", text: "Authoritative text" },
          {
            type: "tool",
            id: "read-1",
            name: "read",
            state: { status: "completed", input: { path: "README.md" }, output: "Server output" },
          },
          {
            type: "tool",
            id: "patch-1",
            name: "patch",
            state: { status: "streaming", input: "", metadata: { title: "Server title" } },
          },
        ],
      };
      reconciler.setTranscriptSnapshot("connection", "session", [snapshot], mode, token);

      const hydrated = reconciler.messages("connection", "session")[0]!;
      expect(hydrated.text).toBe("Authoritative text");
      expect(hydrated.content.slice(0, 2)).toEqual(snapshot.content.slice(0, 2));
      expect(projectToolExecution(hydrated.content[2]!, 2)).toMatchObject({
        inputStreaming: true,
        rawInput: { patchText: patchText.slice(0, patchText.indexOf("\n+continued")) },
      });
      expect(hydrated.content[2]!.state).toMatchObject({ metadata: { title: "Server title" } });

      reconciler.applyBatch(
        batch(2, [event("session.tool.input.delta", 3, { ...data, delta: json.slice(boundary) })]),
      );

      const message = reconciler.messages("connection", "session")[0]!;
      const view = projectToolExecution(message.content[2]!, 2);
      if (view.kind !== "file-change" || !view.patchDocument) throw new Error("Expected patch");
      expect(view.patchDocument.text).toBe(patchText);
      expect(
        Array.from({ length: getStreamingPatchLineCount(view.patchDocument) }, (_, index) =>
          getStreamingPatchLine(view.patchDocument!, index),
        ),
      ).toEqual(lines);
      expect(view.targetFiles).toEqual(["src/old.ts", "src/new.ts", "src/added.ts"]);
      expect(message.content.slice(0, 2)).toEqual(snapshot.content.slice(0, 2));
      expect(snapshot.content[2]!.state).toEqual({
        status: "streaming",
        input: "",
        metadata: { title: "Server title" },
      });
    },
  );

  it.each(["running", "completed", "streaming"])(
    "accepts authoritative %s patch input instead of preserving a partial stream",
    (status) => {
      const reconciler = new OpenCodeReconciler();
      const data = { sessionID: "session", assistantMessageID: "message", id: "patch-1" };
      reconciler.applyBatch(
        batch(1, [
          event("session.tool.input.started", 1, { ...data, name: "apply_patch" }),
          event("session.tool.input.delta", 2, {
            ...data,
            delta: '{"patchText":"*** Begin Patch\\n*** Update File: stale.ts\\n+partial',
          }),
        ]),
      );
      const token = reconciler.beginSnapshot("connection");
      if (status === "streaming") {
        reconciler.setFocusedConnection(null);
        reconciler.applyBatch(
          batch(2, [
            event("session.tool.input.delta", 3, {
              ...data,
              delta: " skipped",
            }),
          ]),
        );
        reconciler.setFocusedConnection("connection");
      }
      const patchText = "*** Begin Patch\n*** Add File: authoritative.ts\n+final\n*** End Patch";
      const snapshot: PalotMessage = {
        ...assistant("Server text"),
        completedAt: status === "completed" ? 10 : null,
        content: [
          {
            type: "tool",
            id: "patch-1",
            name: "apply_patch",
            state: {
              status,
              input: { patchText },
              metadata: {
                files: [{ file: "authoritative.ts", before: "", after: "final\n", additions: 1 }],
              },
            },
          },
        ],
      };
      reconciler.setTranscriptSnapshot("connection", "session", [snapshot], "recent", token);

      const message = reconciler.messages("connection", "session")[0]!;
      expect(message).toEqual(snapshot);
      expect(projectToolExecution(message.content[0]!, 0)).toMatchObject({
        inputStreaming: status === "streaming",
        patchDocument: { text: patchText },
        rawInput: { patchText },
        targetFiles: ["authoritative.ts"],
        files: [{ file: "authoritative.ts", before: "", after: "final\n", additions: 1 }],
      });
    },
  );

  it("publishes each admitted transport batch once", () => {
    const reconciler = new OpenCodeReconciler();
    const admitted: number[] = [];
    const unsubscribe = reconciler.subscribe(({ batch: applied }) => {
      admitted.push(applied.batchSequence);
    });

    reconciler.applyBatch(
      batch(1, [event("session.synthetic", 1, { sessionID: "session", text: "Once" })]),
    );
    reconciler.applyBatch(
      batch(1, [event("session.synthetic", 1, { sessionID: "session", text: "Duplicate" })]),
    );

    expect(admitted).toEqual([1]);
    unsubscribe();
  });

  it("recovers a missing execution start from the active transcript turn", () => {
    const reconciler = new OpenCodeReconciler();
    reconciler.replaceActivity("connection", {
      activeIDs: new Set(["session"]),
      execution: new Map([["session", { status: "running", startedAt: null, completedAt: null }]]),
      statuses: new Map(),
    });
    reconciler.setTranscriptSnapshot(
      "connection",
      "session",
      [
        {
          id: "user",
          type: "user",
          createdAt: 20,
          completedAt: null,
          text: "Continue",
          agent: null,
          model: null,
          tokens: null,
          finish: null,
          content: [{ type: "text", text: "Continue" }],
          data: null,
          runStartedAt: 25,
        },
      ],
      "rooted",
    );

    expect(reconciler.activity("connection").execution.get("session")?.startedAt).toBe(25);
  });
});
