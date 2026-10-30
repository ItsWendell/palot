import { expect, it } from "vitest";
import { taskAnnouncement } from "./task-announcements";
const task = { id: "one", title: "Fix login", attention: false, running: false, failed: false };
it("silences hydration and unchanged streaming state", () => {
  expect(taskAnnouncement(undefined, { ...task, running: true }, true)).toBeNull();
  expect(taskAnnouncement("working", { ...task, running: true }, true)).toBeNull();
});
it("announces open-task lifecycle changes with input taking priority", () => {
  expect(taskAnnouncement("idle", { ...task, running: true }, true)).toBe(
    "Open task: started working.",
  );
  expect(taskAnnouncement("working", { ...task, running: true, attention: true }, true)).toBe(
    "Open task: needs your input.",
  );
  expect(taskAnnouncement("working", task, true)).toBe("Open task: finished.");
  expect(taskAnnouncement("working", { ...task, failed: true }, true)).toBe("Open task: failed.");
});
it("only announces attention and failure for background tasks", () => {
  expect(taskAnnouncement("idle", { ...task, running: true }, false)).toBeNull();
  expect(taskAnnouncement("working", task, false)).toBeNull();
  expect(taskAnnouncement("working", { ...task, attention: true }, false)).toBe(
    "Fix login: needs your input.",
  );
  expect(taskAnnouncement("working", { ...task, failed: true }, false)).toBe("Fix login: failed.");
});
