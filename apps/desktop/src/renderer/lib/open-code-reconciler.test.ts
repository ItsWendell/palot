// Audit against OpenCode PR #61785 (timelines drifting from the server on flaky connections).
// Gap 1, a catch-up read racing the stream: Palot does not have it. A read takes its snapshot
// token before the request is sent, and every record a later batch writes is touched at a
// revision above that token, so the read cannot overwrite or remove it. Records no later batch
// wrote hold state the server already had when the read was sent, so the read may refresh them.
// See "catch-up reads against the live stream" below and the reconnect tests in
// hooks/use-workspace.test.tsx.
// Gap 3, accepted prompts needing a transcript read: Palot does not have it. Pending input is
// the server's inbox list with no client-side outbox, so an inbox read alone settles a prompt
// the stream lost the delivery of. See "settles an accepted prompt from an inbox read alone".
// A rooted read keeps the row of a prompt still pending in the inbox (queued by any client),
// since the server's transcript holds it only after delivery ("keeps a prompt queued by
// another client through a rooted read").
import type { PermissionRuleset, Project, SessionInfo, SessionLogOutput } from "@opencode/client";
import { describe, expect, it, vi } from "vitest";
import type { PalotEvent, PalotEventBatch, PalotMessage } from "../../shared";
import { QueryClient } from "@tanstack/react-query";
import {
  OpenCodeReconciler,
  openCodeReconciler,
  projectInfoFromPalot,
  sessionInfoFromPalot,
} from "./open-code-reconciler";
import { mapProject, mapSession } from "../services/opencode-mappers";
import { palot } from "../services/palot";
import { sessionRequestsQueryOptions } from "./session-request-query";
import { getStreamingPatchLine, getStreamingPatchLineCount } from "./streaming-patch-input";
import { projectToolExecution } from "./tool-executions";
import { pendingRequestViews } from "./view-models";

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
  it("round-trips project activity and preserves it when an older projection omits it", () => {
    const project: Project = {
      id: "project",
      canonical: "/repo",
      sandboxes: [],
      time: { created: 1, updated: 2, active: 3 },
    };
    expect(projectInfoFromPalot(mapProject(project)).time).toEqual({
      created: 2,
      updated: 2,
      active: 3,
    });
    expect(
      projectInfoFromPalot({ ...mapProject(project), activeAt: undefined }, project).time,
    ).toEqual(project.time);
    expect(
      projectInfoFromPalot({ ...mapProject(project), activeAt: undefined, updatedAt: 5 }).time
        .active,
    ).toBe(5);
  });

  it("keeps hydrated metadata and applies durable metadata updates without stale snapshots or duplicates", () => {
    const reconciler = new OpenCodeReconciler();
    const source = { ...session("Initial"), metadata: { label: "initial" } };
    reconciler.upsertPalotSessions("connection", [mapSession(source)]);
    expect(sessionInfoFromPalot(mapSession(source)).metadata).toEqual(source.metadata);
    expect(reconciler.session("connection", "session")?.metadata).toEqual(source.metadata);
    const snapshot = reconciler.beginSnapshot("connection");
    const update = {
      ...event("session.metadata.updated", 3, {
        sessionID: "session",
        metadata: { label: "live", extra: true },
      }),
      durable: { aggregateID: "session", seq: 2, version: 1 },
    } as PalotEvent;
    const result = reconciler.applyBatch(batch(1, [update]));
    expect(result.changedSessionIDs).toEqual(["session"]);
    expect(result.changedTranscriptSessionIDs).toEqual([]);
    expect(reconciler.session("connection", "session")?.metadata).toEqual({
      label: "live",
      extra: true,
    });
    reconciler.upsertSessionInfos("connection", [source], snapshot);
    expect(reconciler.session("connection", "session")?.metadata).toEqual({
      label: "live",
      extra: true,
    });
    expect(reconciler.applyBatch(batch(2, [update])).events).toEqual([]);
    expect(reconciler.session("connection", "session")?.metadata).toEqual({
      label: "live",
      extra: true,
    });
    const replay = reconciler.applyReplay("connection", "session", [
      { ...update, created: 3 } as SessionLogOutput,
      { type: "log.synced", aggregateID: "session", seq: 2 },
    ]);
    expect(replay.events).toEqual([]);
  });

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

  it("keeps a running Code Mode script's live calls through a snapshot without them", () => {
    const reconciler = new OpenCodeReconciler();
    const script = (metadata: Record<string, never> = {}): PalotMessage => ({
      ...assistant(""),
      content: [
        {
          type: "tool",
          id: "call-1",
          name: "execute",
          state: { status: "running", input: { code: "…" }, metadata },
        },
      ],
    });
    reconciler.setTranscriptSnapshot("connection", "session", [script()], "rooted");
    const toolCalls = [{ tool: "shell", status: "running", input: { command: "./slow.sh" } }];
    reconciler.applyBatch(
      batch(1, [
        event("session.tool.progress", 1, {
          sessionID: "session",
          assistantMessageID: "message",
          id: "call-1",
          metadata: { toolCalls },
        }),
      ]),
    );
    // OpenCode stores no progress, so a refetch while the script runs has empty metadata.
    reconciler.setTranscriptSnapshot(
      "connection",
      "session",
      [script()],
      "recent",
      reconciler.beginSnapshot("connection"),
    );
    const state = reconciler.messages("connection", "session")[0]!.content[0]!.state;
    expect(state).toMatchObject({ status: "running", metadata: { toolCalls } });
  });

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

  it("projects archive and unarchive events onto cached session info", () => {
    const reconciler = new OpenCodeReconciler();
    reconciler.upsertSessionInfos("connection", [session("Original")]);

    reconciler.applyBatch(batch(1, [event("session.archived", 5, { sessionID: "session" })]));
    expect(reconciler.session("connection", "session")?.time).toEqual({
      created: 1,
      updated: 5,
      archived: 5,
    });

    reconciler.applyBatch(batch(2, [event("session.unarchived", 7, { sessionID: "session" })]));
    expect(reconciler.session("connection", "session")?.time).toEqual({ created: 1, updated: 7 });
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

describe("streamed batches", () => {
  function streamingReconciler() {
    const reconciler = new OpenCodeReconciler();
    reconciler.upsertSessionInfos("connection", [session("Streaming")]);
    const history: PalotMessage = { ...assistant("Earlier answer"), id: "history", createdAt: 0 };
    reconciler.setTranscriptSnapshot(
      "connection",
      "session",
      [history, assistant("Hel")],
      "rooted",
    );
    const delta = (sequence: number, text: string) =>
      event("session.text.delta", sequence, {
        sessionID: "session",
        assistantMessageID: "message",
        ordinal: 0,
        delta: text,
      });
    return { reconciler, history, delta };
  }

  it("streams text without collecting every session or request", () => {
    const { reconciler, delta } = streamingReconciler();
    const sessions = vi.spyOn(reconciler, "sessions");
    const requests = vi.spyOn(reconciler, "requestMap");

    reconciler.applyBatch(batch(1, [delta(1, "l"), delta(2, "lo")]));

    expect(sessions).not.toHaveBeenCalled();
    expect(requests).not.toHaveBeenCalled();
    expect(reconciler.messages("connection", "session")[1]?.content[0]?.text).toBe("Helllo");

    reconciler.applyBatch(
      batch(2, [event("session.renamed", 3, { sessionID: "session", title: "Renamed" })]),
    );
    expect(reconciler.session("connection", "session")?.title).toBe("Renamed");
  });

  it("writes only the message a batch changed", () => {
    const { reconciler, history, delta } = streamingReconciler();
    const written: string[] = [];
    const commit = reconciler.graph.commit.bind(reconciler.graph);
    vi.spyOn(reconciler.graph, "commit").mockImplementation((input) =>
      commit((writer) => {
        if (typeof input !== "function") throw new Error("Expected a commit callback");
        input({
          ...writer,
          upsert: (record) => {
            written.push(`${record.kind}:${record.entityID}`);
            writer.upsert(record);
          },
        });
      }),
    );

    reconciler.applyBatch(batch(1, [delta(1, "lo")]));

    expect(written).toEqual(["session-message:message"]);
    expect(reconciler.messages("connection", "session")[0]).toBe(history);
    expect(reconciler.messages("connection", "session")[1]?.content[0]?.text).toBe("Hello");
  });

  it("lets a catch-up read refresh what no later batch changed, and keeps what one did", () => {
    const { reconciler, history, delta } = streamingReconciler();
    // Applied before the read was sent, so the server's answer already reflects it.
    reconciler.applyBatch(
      batch(1, [
        event("session.text.ended", 1, {
          sessionID: "session",
          assistantMessageID: history.id,
          ordinal: 0,
          text: "Earlier answer, revised",
        }),
      ]),
    );
    const token = reconciler.beginSnapshot("connection");
    reconciler.applyBatch(batch(2, [delta(2, "lo")]));
    const server: PalotMessage = {
      ...history,
      completedAt: 5,
      finish: "stop",
      text: "Earlier answer, revised",
      content: [{ type: "text", text: "Earlier answer, revised" }],
    };

    reconciler.setTranscriptSnapshot(
      "connection",
      "session",
      [server, assistant("Hel")],
      "rooted",
      token,
    );

    const [first, second] = reconciler.messages("connection", "session");
    expect(first).toEqual(server);
    expect(second?.content[0]?.text).toBe("Hello");
  });
});

describe("catch-up reads against the live stream", () => {
  const user: PalotMessage = {
    id: "user",
    type: "user",
    createdAt: 1,
    completedAt: 1,
    text: "Start",
    agent: null,
    model: null,
    tokens: null,
    finish: null,
    content: [],
    data: null,
  };
  const answer: PalotMessage = { ...assistant("Done"), id: "answer", createdAt: 2, completedAt: 3 };

  // A "recent" read only upserts what its page holds; "preserves transcript events received
  // while a snapshot is in flight" covers it. A "rooted" read also removes what its page lacks.
  it("keeps a reply and a prompt delivery applied while a rooted read was in flight", () => {
    const reconciler = new OpenCodeReconciler();
    reconciler.setTranscriptSnapshot("connection", "session", [user, answer], "rooted");
    reconciler.applyBatch(
      batch(1, [
        event("session.inbox.enqueued", 1, {
          sessionID: "session",
          inboxID: "prompt",
          item: { type: "user", payload: { text: "Next" }, delivery: "queue" },
        }),
      ]),
    );
    const token = reconciler.beginSnapshot("connection");
    reconciler.applyBatch(
      batch(2, [
        event("session.inbox.delivered", 2, { sessionID: "session", inboxID: "prompt" }),
        event("session.step.started", 3, {
          sessionID: "session",
          assistantMessageID: "reply",
          agent: "build",
        }),
        event("session.text.delta", 4, {
          sessionID: "session",
          assistantMessageID: "reply",
          ordinal: 0,
          delta: "Live reply",
        }),
      ]),
    );

    // The server answered before it delivered the prompt.
    reconciler.setTranscriptSnapshot("connection", "session", [user, answer], "rooted", token);

    const messages = new Map(
      reconciler.messages("connection", "session").map((message) => [message.id, message]),
    );
    expect([...messages.keys()].toSorted()).toEqual(["answer", "prompt", "reply", "user"]);
    expect(messages.get("prompt")).toMatchObject({ text: "Next", promotedAt: 2 });
    expect(messages.get("reply")?.content[0]?.text).toBe("Live reply");
  });

  function queuedElsewhere(reconciler: OpenCodeReconciler) {
    reconciler.setTranscriptSnapshot("connection", "session", [user, answer], "rooted");
    // Another client (the terminal UI) queues a prompt; its row exists only from this event.
    reconciler.applyBatch(
      batch(1, [
        event("session.inbox.enqueued", 1, {
          sessionID: "session",
          inboxID: "queued",
          item: { type: "user", payload: { text: "Later" }, delivery: "queue" },
        }),
      ]),
    );
  }
  const ids = (reconciler: OpenCodeReconciler) =>
    reconciler
      .messages("connection", "session")
      .map((message) => message.id)
      .toSorted();

  it("keeps a prompt queued by another client through a rooted read, removing what is gone", () => {
    const reconciler = new OpenCodeReconciler();
    queuedElsewhere(reconciler);

    // The server deleted "answer"; the queued prompt is not in the transcript until delivery.
    reconciler.setTranscriptSnapshot(
      "connection",
      "session",
      [user],
      "rooted",
      reconciler.beginSnapshot("connection"),
    );

    expect(ids(reconciler)).toEqual(["queued", "user"]);
  });

  it("replaces a queued row with the delivered message once the transcript holds it", () => {
    const reconciler = new OpenCodeReconciler();
    queuedElsewhere(reconciler);
    reconciler.applyBatch(
      batch(2, [event("session.inbox.delivered", 2, { sessionID: "session", inboxID: "queued" })]),
    );
    const delivered: PalotMessage = { ...user, id: "queued", createdAt: 4, text: "Later" };

    reconciler.setTranscriptSnapshot(
      "connection",
      "session",
      [user, answer, delivered],
      "rooted",
      reconciler.beginSnapshot("connection"),
    );

    expect(reconciler.messages("connection", "session").at(-1)).toEqual(delivered);
  });

  it("removes a queued row on cancel, or on the next rooted read once the inbox lacks it", () => {
    const cancelled = new OpenCodeReconciler();
    queuedElsewhere(cancelled);
    cancelled.applyBatch(
      batch(2, [event("session.inbox.cancelled", 2, { sessionID: "session", inboxID: "queued" })]),
    );
    expect(ids(cancelled)).toEqual(["answer", "user"]);

    // The stream lost the cancel; an inbox read without the prompt releases its row.
    const lost = new OpenCodeReconciler();
    queuedElsewhere(lost);
    lost.setRequests("connection", "session", {
      ...lost.requests("connection", "session")!,
      inbox: [],
    });
    lost.setTranscriptSnapshot("connection", "session", [user, answer], "rooted");
    expect(ids(lost)).toEqual(["answer", "user"]);
  });

  it("settles an accepted prompt from an inbox read alone, without a transcript read", async () => {
    const queryClient = new QueryClient();
    const reconciler = openCodeReconciler(queryClient);
    reconciler.applyBatch(
      batch(1, [
        event("session.inbox.enqueued", 1, {
          sessionID: "session",
          inboxID: "prompt",
          item: { type: "user", payload: { text: "Queued" }, delivery: "queue" },
        }),
      ]),
    );
    expect(
      pendingRequestViews(reconciler.requests("connection", "session")!).map(
        (request) => request.id,
      ),
    ).toEqual(["prompt"]);
    // The stream lost the delivery; the server's inbox no longer holds the prompt.
    const inbox = vi.spyOn(palot, "loadSessionInbox").mockResolvedValue([]);
    const transcript = vi.spyOn(palot, "loadTranscript");

    await queryClient.fetchQuery(sessionRequestsQueryOptions(queryClient, "connection", "session"));

    expect(pendingRequestViews(reconciler.requests("connection", "session")!)).toEqual([]);
    expect(transcript).not.toHaveBeenCalled();
    inbox.mockRestore();
    transcript.mockRestore();
  });
});

describe("transcript retention", () => {
  it("forgets an unviewed transcript when its query is dropped, but keeps running tasks", () => {
    const queryClient = new QueryClient();
    const reconciler = openCodeReconciler(queryClient);
    for (const id of ["idle", "busy"]) {
      reconciler.setTranscriptSnapshot("c1", id, [assistant(id)], "rooted");
      queryClient.setQueryData(["opencode", "c1", "transcripts", id], {
        pages: [],
        pageParams: [],
      });
    }
    reconciler.replaceActivity("c1", {
      activeIDs: new Set(["busy"]),
      execution: new Map(),
      statuses: new Map(),
    });

    queryClient.removeQueries({ queryKey: ["opencode", "c1", "transcripts"] });

    expect(reconciler.messages("c1", "idle")).toEqual([]);
    expect(reconciler.messages("c1", "busy")).toHaveLength(1);
    expect(reconciler.evictTranscript("c1", "idle")).toBe(false);
  });
});
