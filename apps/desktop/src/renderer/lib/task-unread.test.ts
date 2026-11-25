import { describe, expect, it } from "vitest";
import {
  MAX_UNREAD_MARKS,
  addUnreadMark,
  hasUnreadMark,
  removeUnreadMark,
  taskIsUnread,
  unreadMarkKey,
  validUnreadMarks,
} from "./task-unread";

const read = { idleAt: 30, viewedAt: 30 };
const unread = { idleAt: 30, viewedAt: 20 };

describe("taskIsUnread", () => {
  it("follows OpenCode's idle and viewed watermarks", () => {
    expect(taskIsUnread(unread)).toBe(true);
    expect(taskIsUnread({ idleAt: 30 })).toBe(true);
    expect(taskIsUnread(read)).toBe(false);
    expect(taskIsUnread({ viewedAt: 20 })).toBe(false);
  });

  it("treats a marked task as unread, even while it is open", () => {
    expect(taskIsUnread(read, { marked: true })).toBe(true);
    expect(taskIsUnread(read, { marked: true, selected: true })).toBe(true);
    expect(taskIsUnread({}, { marked: true })).toBe(true);
  });

  it("hides OpenCode's unread state on the open task", () => {
    expect(taskIsUnread(unread, { selected: true })).toBe(false);
  });
});

describe("unread marks", () => {
  const key = unreadMarkKey("profile-1", "session-1");

  it("sets and clears a mark per profile and task", () => {
    const marked = addUnreadMark({}, key, 1);
    expect(hasUnreadMark(marked, key)).toBe(true);
    expect(hasUnreadMark(marked, unreadMarkKey("profile-2", "session-1"))).toBe(false);
    expect(hasUnreadMark(removeUnreadMark(marked, key), key)).toBe(false);
  });

  it("returns the same marks when clearing a task that is not marked", () => {
    const marks = addUnreadMark({}, key, 1);
    expect(removeUnreadMark(marks, unreadMarkKey("profile-1", "other"))).toBe(marks);
  });

  it(`keeps the newest ${MAX_UNREAD_MARKS} marks`, () => {
    let marks = {};
    for (let index = 0; index <= MAX_UNREAD_MARKS; index += 1) {
      marks = addUnreadMark(marks, unreadMarkKey("profile-1", `session-${index}`), index);
    }
    expect(Object.keys(marks)).toHaveLength(MAX_UNREAD_MARKS);
    expect(hasUnreadMark(marks, unreadMarkKey("profile-1", "session-0"))).toBe(false);
    expect(hasUnreadMark(marks, unreadMarkKey("profile-1", `session-${MAX_UNREAD_MARKS}`))).toBe(
      true,
    );
    // Marking again refreshes recency, so the refreshed task survives the next eviction.
    marks = addUnreadMark(marks, unreadMarkKey("profile-1", "session-1"), MAX_UNREAD_MARKS + 1);
    marks = addUnreadMark(marks, unreadMarkKey("profile-1", "extra"), MAX_UNREAD_MARKS + 2);
    expect(hasUnreadMark(marks, unreadMarkKey("profile-1", "session-1"))).toBe(true);
    expect(hasUnreadMark(marks, unreadMarkKey("profile-1", "session-2"))).toBe(false);
  });

  it("validates stored marks", () => {
    expect(validUnreadMarks({ [key]: 1 })).toBe(true);
    expect(validUnreadMarks({ [key]: "1" })).toBe(false);
    expect(validUnreadMarks([])).toBe(false);
    expect(validUnreadMarks(null)).toBe(false);
  });
});
