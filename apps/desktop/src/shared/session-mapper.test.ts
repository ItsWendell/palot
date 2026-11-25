import type { SessionInfo } from "@opencode/client";
import { expect, it } from "vitest";
import { mapSessionInfo } from "./session-mapper";

const base: SessionInfo = {
  id: "session-1",
  projectID: "project-1",
  cost: 0.25,
  tokens: { input: 1, output: 2, reasoning: 3, cache: { read: 4, write: 5 } },
  time: { created: 1, updated: 2 },
  location: { directory: "/repo" },
};

it("maps every session field the renderer and main process read", () => {
  const permissions = [{ action: "shell", resource: "git *", effect: "ask" as const }];
  const source: SessionInfo = {
    ...base,
    parentID: "root",
    title: "Fix the build",
    metadata: { label: "review" },
    permissions,
    time: { created: 1, updated: 2, busy: 3, idle: 4, viewed: 5, archived: 6 },
    outcome: "succeeded",
  };

  const mapped = mapSessionInfo(source);

  expect(mapped).toMatchObject({
    id: "session-1",
    parentID: "root",
    title: "Fix the build",
    agent: null,
    model: null,
    metadata: { label: "review" },
    permissions,
    location: { directory: "/repo" },
    createdAt: 1,
    updatedAt: 2,
    busyAt: 3,
    idleAt: 4,
    viewedAt: 5,
    archivedAt: 6,
    outcome: "succeeded",
    cost: 0.25,
    tokens: { input: 1, output: 2, reasoning: 3, cache: { read: 4, write: 5 } },
  });
  expect(mapped.permissions?.[0]).not.toBe(permissions[0]);
  expect(mapped.metadata).not.toBe(source.metadata);
});

it("leaves optional fields out and guards a missing cost", () => {
  const mapped = mapSessionInfo({ ...base, cost: undefined } as unknown as SessionInfo);

  expect(mapped.cost).toBeNull();
  expect(mapped.parentID).toBeNull();
  expect(mapped.archivedAt).toBeNull();
  for (const key of ["metadata", "permissions", "busyAt", "idleAt", "revert"])
    expect(mapped).not.toHaveProperty(key);
});

it("copies only the revert fields Palot uses", () => {
  const mapped = mapSessionInfo({
    ...base,
    revert: {
      messageID: "message-1",
      snapshot: "snapshot-1",
      files: [{ file: "src/app.ts", additions: 1, deletions: 1, status: "modified", patch: "@@" }],
    },
  } as SessionInfo);

  expect(mapped.revert).toEqual({
    messageID: "message-1",
    snapshot: "snapshot-1",
    files: [{ file: "src/app.ts", additions: 1, deletions: 1, status: "modified", patch: "@@" }],
  });
});
