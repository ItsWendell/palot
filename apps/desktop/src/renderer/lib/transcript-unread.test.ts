import { expect, it } from "vitest";
import type { PalotMessage } from "../../shared";
import { taskIsUnread } from "./task-unread";
import { firstUnseenMessage } from "./transcript-unread";

it("uses the viewed watermark and idle unread contract, not message IDs or updated time", () => {
  const messages = [
    { id: "old", createdAt: 10 },
    { id: "new", createdAt: 21 },
    { id: "later", createdAt: 25 },
  ] as PalotMessage[];
  expect(firstUnseenMessage({ viewedAt: 20, idleAt: 30 }, messages)).toBe("new");
  expect(firstUnseenMessage({ viewedAt: 30, idleAt: 30 }, messages)).toBeNull();
  expect(firstUnseenMessage({ viewedAt: 20 }, messages)).toBeNull();
  expect(firstUnseenMessage({ idleAt: 30 }, messages)).toBe("old");
});

it("shows no divider for a task that is unread only because Palot marked it", () => {
  const messages = [{ id: "old", createdAt: 10 }] as PalotMessage[];
  const session = { viewedAt: 30, idleAt: 30 };
  expect(taskIsUnread(session, { marked: true })).toBe(true);
  expect(firstUnseenMessage(session, messages)).toBeNull();
});
