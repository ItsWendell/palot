// @vitest-environment node

import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/node-sqlite";
import { migrate } from "drizzle-orm/node-sqlite/migrator";
import { SessionTriageStore } from "./session-triage-store";

describe("SessionTriageStore", () => {
  let sqlite: DatabaseSync;
  let store: SessionTriageStore;

  beforeEach(() => {
    sqlite = new DatabaseSync(":memory:");
    const database = drizzle({ client: sqlite });
    migrate(database, { migrationsFolder: path.resolve("drizzle") });
    store = new SessionTriageStore(database);
  });

  afterEach(() => sqlite.close());

  it("keeps triage ownership separate for equal session IDs on different profiles", () => {
    store.dispatch({ type: "pin", profileID: "server-a", sessionID: "same-session", at: 100 });
    store.dispatch({ type: "pin", profileID: "server-b", sessionID: "same-session", at: 200 });
    expect(store.load("server-a").sessions[0]?.pinnedAt).toBe(100);
    expect(store.load("server-b").sessions[0]?.pinnedAt).toBe(200);
  });

  it("creates one sparse profile bootstrap", () => {
    expect(
      store.dispatch({
        type: "bootstrap",
        profileID: "local",
        at: 100,
        through: { updatedAt: 90, sessionID: "session-z" },
      }),
    ).toEqual({
      profileID: "local",
      bootstrapThrough: { updatedAt: 90, sessionID: "session-z" },
      sessions: [],
    });
  });

  it("does not move an existing bootstrap forward", () => {
    store.dispatch({
      type: "bootstrap",
      profileID: "local",
      at: 100,
      through: { updatedAt: 90, sessionID: "session-a" },
    });
    expect(
      store.dispatch({
        type: "bootstrap",
        profileID: "local",
        at: 200,
        through: { updatedAt: 190, sessionID: "session-z" },
      }).bootstrapThrough,
    ).toEqual({ updatedAt: 90, sessionID: "session-a" });
  });

  it("repairs bootstrap after an early triage action creates the profile", () => {
    store.dispatch({ type: "pin", profileID: "local", sessionID: "session-1", at: 100 });

    const snapshot = store.dispatch({
      type: "bootstrap",
      profileID: "local",
      at: 110,
      through: { updatedAt: 90, sessionID: "session-z" },
    });

    expect(snapshot.bootstrapThrough).toEqual({ updatedAt: 90, sessionID: "session-z" });
    expect(snapshot.sessions[0]?.pinnedAt).toBe(100);
  });

  it("ignores stale commands and activity already covered by settlement", () => {
    store.dispatch({
      type: "bootstrap",
      profileID: "local",
      at: 50,
      through: { updatedAt: 40, sessionID: "session-z" },
    });
    store.dispatch({
      type: "settle",
      profileID: "local",
      sessionID: "session-1",
      at: 200,
      through: { updatedAt: 180, sessionID: "session-1" },
    });

    store.dispatch({
      type: "inbox",
      profileID: "local",
      sessionID: "session-1",
      at: 210,
      activity: { updatedAt: 170, sessionID: "child" },
    });
    store.dispatch({
      type: "pin",
      profileID: "local",
      sessionID: "session-1",
      at: 190,
    });
    expect(store.load("local").sessions[0]).toMatchObject({
      disposition: "settled",
      pinnedAt: null,
      updatedAt: 200,
    });

    expect(
      store.dispatch({
        type: "inbox",
        profileID: "local",
        sessionID: "session-1",
        at: 220,
        activity: { updatedAt: 181, sessionID: "child" },
      }).sessions[0],
    ).toMatchObject({ disposition: "inbox", updatedAt: 220 });
  });

  it("only wakes snoozed work for newer OpenCode activity", () => {
    store.dispatch({
      type: "snooze",
      profileID: "local",
      sessionID: "session-1",
      at: 200,
      until: 1_000,
      through: { updatedAt: 180, sessionID: "child-z" },
    });

    store.dispatch({
      type: "inbox",
      profileID: "local",
      sessionID: "session-1",
      at: 210,
      activity: { updatedAt: 180, sessionID: "child-a" },
    });
    expect(store.load("local").sessions[0]?.snoozedUntil).toBe(1_000);

    expect(
      store.dispatch({
        type: "inbox",
        profileID: "local",
        sessionID: "session-1",
        at: 220,
        activity: { updatedAt: 181, sessionID: "child-a" },
      }).sessions[0],
    ).toMatchObject({ snoozedUntil: null, snoozedThrough: null });
  });

  it("does not move settle or snooze activity watermarks backward", () => {
    store.dispatch({
      type: "settle",
      profileID: "local",
      sessionID: "session-1",
      at: 100,
      through: { updatedAt: 90, sessionID: "z-child" },
    });
    expect(
      store.dispatch({
        type: "settle",
        profileID: "local",
        sessionID: "session-1",
        at: 110,
        through: { updatedAt: 80, sessionID: "a-child" },
      }).sessions[0]?.settledThrough,
    ).toEqual({ updatedAt: 90, sessionID: "z-child" });

    store.dispatch({
      type: "snooze",
      profileID: "local",
      sessionID: "session-1",
      at: 120,
      until: 1_000,
      through: { updatedAt: 100, sessionID: "z-child" },
    });
    expect(
      store.dispatch({
        type: "snooze",
        profileID: "local",
        sessionID: "session-1",
        at: 130,
        until: 2_000,
        through: { updatedAt: 100, sessionID: "a-child" },
      }).sessions[0]?.snoozedThrough,
    ).toEqual({ updatedAt: 100, sessionID: "z-child" });
  });

  it("applies triage transitions without storing OpenCode session data", () => {
    store.dispatch({
      type: "bootstrap",
      profileID: "local",
      at: 100,
      through: { updatedAt: 90, sessionID: "session-z" },
    });
    store.dispatch({ type: "pin", profileID: "local", sessionID: "session-1", at: 110 });
    store.dispatch({
      type: "snooze",
      profileID: "local",
      sessionID: "session-1",
      at: 120,
      until: 1_000,
      through: { updatedAt: 115, sessionID: "session-1" },
    });
    const settled = store.dispatch({
      type: "settle",
      profileID: "local",
      sessionID: "session-1",
      at: 130,
      through: { updatedAt: 125, sessionID: "session-1" },
    });

    expect(settled.sessions).toEqual([
      {
        sessionID: "session-1",
        disposition: "settled",
        settledThrough: { updatedAt: 125, sessionID: "session-1" },
        pinnedAt: null,
        snoozedUntil: null,
        snoozedThrough: null,
        updatedAt: 130,
      },
    ]);
  });

  it("isolates remote connection profiles and removes deleted sessions", () => {
    store.dispatch({
      type: "bootstrap",
      profileID: "remote-a",
      at: 100,
      through: { updatedAt: 90, sessionID: "session-z" },
    });
    store.dispatch({
      type: "bootstrap",
      profileID: "remote-b",
      at: 200,
      through: { updatedAt: 190, sessionID: "session-z" },
    });
    store.dispatch({ type: "pin", profileID: "remote-a", sessionID: "session-1", at: 110 });
    store.dispatch({ type: "pin", profileID: "remote-b", sessionID: "session-1", at: 210 });

    store.dispatch({ type: "remove", profileID: "remote-a", sessionID: "session-1" });

    expect(store.load("remote-a").sessions).toEqual([]);
    expect(store.load("remote-b").sessions).toHaveLength(1);
  });
  it("notifies each new settlement once, not when a settle is replayed", () => {
    const settled = vi.fn();
    const observed = new SessionTriageStore(drizzle({ client: sqlite }), settled);
    const through = { updatedAt: 100, sessionID: "session-1" };
    const settle = (at: number, watermark = through) =>
      observed.dispatch({
        type: "settle",
        profileID: "local",
        sessionID: "session-1",
        at,
        through: watermark,
      });

    settle(200);
    settle(201);
    expect(settled).toHaveBeenCalledTimes(1);
    expect(settled).toHaveBeenCalledWith({
      profileID: "local",
      sessionID: "session-1",
      through,
      batch: null,
    });

    // Newer activity, then settling again, is a new settlement.
    settle(300, { updatedAt: 250, sessionID: "session-1" });
    expect(settled).toHaveBeenCalledTimes(2);

    // Moving back to the inbox and settling again also notifies.
    observed.dispatch({ type: "inbox", profileID: "local", sessionID: "session-1", at: 400 });
    settle(500, { updatedAt: 250, sessionID: "session-1" });
    expect(settled).toHaveBeenCalledTimes(3);

    // Pins and snoozes never notify, and a stale settle is ignored.
    observed.dispatch({ type: "pin", profileID: "local", sessionID: "session-2", at: 600 });
    observed.dispatch({
      type: "settle",
      profileID: "local",
      sessionID: "session-2",
      at: 10,
      through: { updatedAt: 5, sessionID: "session-2" },
    });
    expect(settled).toHaveBeenCalledTimes(3);
  });

  it("settles a batch in one command, tags its notices, and undoes it together", () => {
    const settled = vi.fn();
    const observed = new SessionTriageStore(drizzle({ client: sqlite }), settled);
    observed.dispatch({ type: "pin", profileID: "local", sessionID: "session-2", at: 50 });
    const batch = (at: number) =>
      observed.dispatch({
        type: "settle-many",
        profileID: "local",
        at,
        trigger: "auto",
        sessions: ["session-1", "session-2"].map((sessionID) => ({
          sessionID,
          through: { updatedAt: 100, sessionID },
        })),
      });

    const snapshot = batch(200);
    expect(snapshot.sessions.map((record) => [record.sessionID, record.disposition])).toEqual([
      ["session-1", "settled"],
      ["session-2", "settled"],
    ]);
    expect(snapshot.sessions.find((record) => record.sessionID === "session-2")?.pinnedAt).toBe(
      null,
    );
    const events = settled.mock.calls.map(([event]) => event);
    expect(events.map((event) => event.sessionID)).toEqual(["session-1", "session-2"]);
    expect(events[0].batch).toEqual({ id: expect.any(String), trigger: "auto" });
    expect(events[1].batch).toEqual(events[0].batch);

    // Replaying the batch changes nothing and does not notify again.
    batch(201);
    expect(settled).toHaveBeenCalledTimes(2);

    const undone = observed.dispatch({
      type: "inbox-many",
      profileID: "local",
      at: 300,
      sessionIDs: ["session-1", "session-2"],
    });
    expect(undone.sessions.map((record) => [record.disposition, record.settledThrough])).toEqual([
      ["inbox", null],
      ["inbox", null],
    ]);
  });
});
