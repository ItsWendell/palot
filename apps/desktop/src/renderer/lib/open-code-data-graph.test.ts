import { describe, expect, it, vi } from "vitest";
import type { Project, SessionInfo } from "@opencode/client";
import type { PalotMessage } from "../../shared";
import {
  OpenCodeDataGraph,
  openCodeDataGraphKeys,
  selectConnectionRecords,
  selectSessionRecords,
  type OpenCodeProjectRecord,
  type OpenCodeSessionMessageRecord,
  type OpenCodeSessionRecord,
  type OpenCodeSessionRequestRecord,
  type OpenCodeSessionRuntimeRecord,
} from "./open-code-data-graph";

const project = (id: string, name = id): Project => ({
  id,
  canonical: `/repos/${id}`,
  name,
  sandboxes: [],
  time: { created: 1, updated: 1 },
});

const projectRecord = (id: string, name = id): OpenCodeProjectRecord => ({
  connectionID: "connection-1",
  kind: "project",
  entityID: id,
  sessionID: null,
  value: project(id, name),
});

const session = (id: string, projectID: string): SessionInfo => ({
  id,
  projectID,
  title: id,
  location: { directory: `/repos/${projectID}` },
  time: { created: 1, updated: 1 },
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
});

const message = (id: string, text: string): PalotMessage => ({
  id,
  type: "user",
  createdAt: 1,
  completedAt: null,
  text,
  agent: null,
  model: null,
  tokens: null,
  finish: null,
  content: [{ type: "text", text }],
  data: null,
});

describe("OpenCodeDataGraph", () => {
  it("discards staged changes when a callback or delete predicate throws", () => {
    const graph = new OpenCodeDataGraph();
    const original = projectRecord("existing");
    graph.commit([{ type: "upsert", record: original }]);
    const publications: string[][] = [];
    const subscription = graph.collection.subscribeChanges(
      (changes) => publications.push(changes.map((change) => change.type)),
      { includeInitialState: false },
    );

    expect(() =>
      graph.commit((batch) => {
        batch.delete(openCodeDataGraphKeys.project("connection-1", "existing"));
        batch.upsert(projectRecord("new"));
        expect(graph.collection.toArray.map((record) => record.value)).toEqual([original.value]);
        throw new Error("failed hydration");
      }),
    ).toThrow("failed hydration");
    expect(() =>
      graph.commit((batch) => {
        batch.upsert(projectRecord("new"));
        batch.deleteWhere((record) => {
          if (record.entityID === "new") throw new Error("failed predicate");
          return true;
        });
      }),
    ).toThrow("failed predicate");

    expect(graph.collection.toArray.map((record) => record.value)).toEqual([original.value]);
    expect(publications).toEqual([]);
    expect(graph.commit([{ type: "upsert", record: projectRecord("recovered") }])).toBe(true);
    expect(publications).toEqual([["insert"]]);
    subscription.unsubscribe();
  });

  it("does not publish deeply equal replacements or mutations that cancel out", () => {
    const graph = new OpenCodeDataGraph();
    const original = projectRecord("existing");
    graph.commit([{ type: "upsert", record: original }]);
    const publications: string[][] = [];
    const subscription = graph.collection.subscribeChanges(
      (changes) => publications.push(changes.map((change) => change.type)),
      { includeInitialState: false },
    );

    expect(graph.commit([])).toBe(false);
    expect(graph.commit([{ type: "upsert", record: projectRecord("existing") }])).toBe(false);
    expect(
      graph.commit((batch) => {
        batch.upsert(projectRecord("existing", "temporary rename"));
        batch.delete(openCodeDataGraphKeys.project("connection-1", "existing"));
        batch.upsert(projectRecord("existing"));
        batch.upsert(projectRecord("temporary"));
        batch.delete(openCodeDataGraphKeys.project("connection-1", "temporary"));
        batch.delete(openCodeDataGraphKeys.project("connection-1", "missing"));
      }),
    ).toBe(false);

    expect(publications).toEqual([]);
    expect(
      graph.collection.get(openCodeDataGraphKeys.project("connection-1", "existing"))?.value,
    ).toBe(original.value);
    subscription.unsubscribe();
  });

  it("evaluates successive deletes against staged values in insertion order", () => {
    const graph = new OpenCodeDataGraph();
    graph.commit((batch) => {
      batch.upsert(projectRecord("first"));
      batch.upsert(projectRecord("second"));
      batch.upsert(projectRecord("third"));
      batch.upsert(projectRecord("removed"));
    });
    const firstPass: string[] = [];
    const secondPass: string[] = [];
    const publications: string[][] = [];
    const subscription = graph.collection.subscribeChanges(
      (changes) => publications.push(changes.map((change) => change.type)),
      { includeInitialState: false },
    );

    expect(
      graph.commit([
        { type: "upsert", record: projectRecord("first", "discard") },
        { type: "upsert", record: projectRecord("new", "discard") },
        { type: "delete", key: openCodeDataGraphKeys.project("connection-1", "removed") },
        { type: "delete", key: openCodeDataGraphKeys.project("connection-1", "second") },
        { type: "upsert", record: projectRecord("second", "restored") },
        {
          type: "deleteWhere",
          predicate: (record) => {
            firstPass.push(record.entityID);
            return record.kind === "project" && record.value.name === "discard";
          },
        },
        { type: "upsert", record: projectRecord("new", "survives") },
        {
          type: "deleteWhere",
          predicate: (record) => {
            secondPass.push(record.entityID);
            return record.entityID === "third";
          },
        },
      ]),
    ).toBe(true);

    expect(firstPass).toEqual(["first", "third", "new", "second"]);
    expect(secondPass).toEqual(["third", "second", "new"]);
    expect(graph.collection.size).toBe(2);
    expect(graph.collection.toArray.map((record) => record.value)).toEqual(
      expect.arrayContaining([project("second", "restored"), project("new", "survives")]),
    );
    expect(publications).toHaveLength(1);
    expect(publications[0]?.filter((type) => type === "delete")).toHaveLength(3);
    expect(publications[0]?.filter((type) => type === "update")).toHaveLength(1);
    expect(publications[0]?.filter((type) => type === "insert")).toHaveLength(1);
    subscription.unsubscribe();
  });

  it("rejects nested commits without publishing either batch and releases the guard", () => {
    const graph = new OpenCodeDataGraph();
    expect(() =>
      graph.commit((batch) => {
        batch.upsert(projectRecord("outer"));
        graph.commit([{ type: "upsert", record: projectRecord("inner") }]);
      }),
    ).toThrow("OpenCode data graph commits cannot be nested");
    expect(graph.collection.size).toBe(0);
    expect(graph.commit([{ type: "upsert", record: projectRecord("recovered") }])).toBe(true);
    expect(graph.collection.toArray.map((record) => record.value)).toEqual([project("recovered")]);
  });

  it("atomically upserts and updates records through authoritative sync", () => {
    const graph = new OpenCodeDataGraph();
    const originalProject = project("project-1", "Original");
    const sessionValue = session("session-1", originalProject.id);
    const projectRecord: OpenCodeProjectRecord = {
      connectionID: "connection-1",
      kind: "project",
      entityID: originalProject.id,
      sessionID: null,
      value: originalProject,
    };
    const sessionRecord: OpenCodeSessionRecord = {
      connectionID: "connection-1",
      kind: "session",
      entityID: sessionValue.id,
      sessionID: sessionValue.id,
      value: sessionValue,
    };
    const publications: string[][] = [];
    const subscription = graph.collection.subscribeChanges(
      (changes) => publications.push(changes.map((change) => change.type)),
      { includeInitialState: false },
    );

    graph.commit((batch) => {
      batch.upsert(projectRecord);
      batch.upsert(sessionRecord);
    });

    expect(publications).toEqual([["insert", "insert"]]);
    expect(graph.collection.size).toBe(2);
    expect(
      graph.collection.get(openCodeDataGraphKeys.project("connection-1", "project-1"))?.value,
    ).toBe(originalProject);

    const updatedProject = project("project-1", "Updated");
    graph.commit([
      {
        type: "upsert",
        record: { ...projectRecord, value: updatedProject },
      },
    ]);

    expect(publications.at(-1)).toEqual(["update"]);
    expect(
      graph.collection.get(openCodeDataGraphKeys.project("connection-1", "project-1"))?.value,
    ).toBe(updatedProject);
    subscription.unsubscribe();
  });

  it("atomically deletes explicit keys and matching records", () => {
    const graph = new OpenCodeDataGraph();
    const runtime: OpenCodeSessionRuntimeRecord = {
      connectionID: "connection-1",
      kind: "session-runtime",
      entityID: "session-1",
      sessionID: "session-1",
      value: {
        active: true,
        execution: { status: "running", startedAt: 1, completedAt: null },
        status: { type: "busy" },
      },
    };
    const request: OpenCodeSessionRequestRecord = {
      connectionID: "connection-1",
      kind: "session-request",
      entityID: "session-1",
      sessionID: "session-1",
      value: { permissions: [], forms: [], inbox: [], errors: [] },
    };
    const messageRecord: OpenCodeSessionMessageRecord = {
      connectionID: "connection-1",
      kind: "session-message",
      entityID: "message-1",
      sessionID: "session-1",
      value: message("message-1", "hello"),
    };
    graph.commit((batch) => {
      batch.upsert(runtime);
      batch.upsert(request);
      batch.upsert(messageRecord);
    });

    const publications: string[][] = [];
    const subscription = graph.collection.subscribeChanges(
      (changes) => publications.push(changes.map((change) => change.type)),
      { includeInitialState: false },
    );
    graph.commit((batch) => {
      batch.delete(openCodeDataGraphKeys.sessionRuntime("connection-1", "session-1"));
      batch.deleteWhere(
        (record) => record.connectionID === "connection-1" && record.kind === "session-message",
      );
    });

    expect(publications).toEqual([["delete", "delete"]]);
    expect(graph.collection.toArray).toHaveLength(1);
    expect(graph.collection.toArray[0]?.kind).toBe("session-request");
    subscription.unsubscribe();
  });

  it("selects records by connection and session without flattening values", () => {
    const graph = new OpenCodeDataGraph();
    const projectValue = project("project-1");
    const messageValue = message("message-1", "nested value");
    graph.commit((batch) => {
      batch.upsert({
        connectionID: "connection-1",
        kind: "project",
        entityID: projectValue.id,
        sessionID: null,
        value: projectValue,
      });
      batch.upsert({
        connectionID: "connection-1",
        kind: "session-message",
        entityID: messageValue.id,
        sessionID: "session-1",
        value: messageValue,
      });
      batch.upsert({
        connectionID: "connection-2",
        kind: "session-runtime",
        entityID: "session-1",
        sessionID: "session-1",
        value: { active: false, execution: null, status: { type: "idle" } },
      });
    });

    expect(selectConnectionRecords("connection-1", graph).map((record) => record.kind)).toEqual([
      "project",
      "session-message",
    ]);
    const selected = selectSessionRecords("connection-1", "session-1", graph);
    expect(selected).toHaveLength(1);
    expect(selected[0]?.value).toBe(messageValue);
    expect(graph.selectSessionRecords("connection-2", "session-1")[0]?.kind).toBe(
      "session-runtime",
    );
  });

  it("reads indexed subsets without enumerating the graph and retains old snapshots", () => {
    const graph = new OpenCodeDataGraph();
    const record: OpenCodeSessionMessageRecord = {
      connectionID: "connection-1",
      sessionID: "shared-session",
      kind: "session-message",
      entityID: "shared-message",
      value: message("shared-message", "before"),
    };
    graph.commit((writer) => {
      writer.upsert(record);
      writer.upsert({ ...record, connectionID: "other" });
      writer.upsert({ ...record, sessionID: "other" });
      for (let i = 0; i < 100; i++) writer.upsert(projectRecord(`unrelated-${i}`));
    });
    const values = vi.spyOn(graph.collection, "values");
    const get = vi.spyOn(graph.collection, "get");
    const first = graph.selectSessionRecords("connection-1", "shared-session", "session-message");
    expect(first.map((item) => item.value)).toEqual([record.value]);
    expect(get).toHaveBeenCalledTimes(1);
    expect(values).not.toHaveBeenCalled();
    expect(graph.selectConnectionRecords("connection-1", "session-message")).toHaveLength(2);
    expect(graph.selectSessionRecords("missing", "shared-session")).toEqual([]);
    graph.commit((writer) =>
      writer.upsert({ ...record, value: message("shared-message", "after") }),
    );
    expect(graph.selectSessionRecords("connection-1", "shared-session")[0]?.value).not.toBe(
      first[0]?.value,
    );
    expect(first[0]?.value).toBe(record.value);
    expect(values).not.toHaveBeenCalled();
    values.mockRestore();
    get.mockRestore();
  });

  it("publishes fully updated indexes and leaves them untouched after failed staging", () => {
    const graph = new OpenCodeDataGraph();
    graph.commit((writer) => writer.upsert(projectRecord("old")));
    const publications: string[][] = [];
    const subscription = graph.collection.subscribeChanges(
      () => {
        publications.push(
          graph.selectConnectionRecords("connection-1", "project").map((record) => record.entityID),
        );
      },
      { includeInitialState: false },
    );
    graph.commit((writer) => {
      writer.delete(openCodeDataGraphKeys.project("connection-1", "old"));
      writer.upsert(projectRecord("first"));
      writer.upsert(projectRecord("second"));
      expect(
        graph.selectConnectionRecords("connection-1", "project").map((record) => record.entityID),
      ).toEqual(["old"]);
    });
    expect(publications).toEqual([["first", "second"]]);
    expect(() =>
      graph.commit((writer) => {
        writer.deleteWhere(() => true);
        writer.upsert(projectRecord("discarded"));
        throw new Error("rollback");
      }),
    ).toThrow("rollback");
    expect(
      graph.selectConnectionRecords("connection-1", "project").map((record) => record.entityID),
    ).toEqual(["first", "second"]);
    graph.commit((writer) => writer.deleteWhere(() => true));
    expect(publications).toEqual([["first", "second"], []]);
    subscription.unsubscribe();
  });
});
