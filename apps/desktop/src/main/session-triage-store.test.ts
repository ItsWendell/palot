// @vitest-environment node

import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/node-sqlite";
import { migrate } from "drizzle-orm/node-sqlite/migrator";
import * as schema from "./database/schema";
import { SessionTriageStore } from "./session-triage-store";

describe("SessionTriageStore", () => {
  let sqlite: DatabaseSync;
  let store: SessionTriageStore;

  beforeEach(() => {
    sqlite = new DatabaseSync(":memory:");
    const database = drizzle({ client: sqlite, schema });
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
});
