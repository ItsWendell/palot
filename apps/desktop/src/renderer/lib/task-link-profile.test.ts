import { expect, it } from "vitest";
import { resolveTaskLinkProfile } from "./task-link-profile";

type Connections = Parameters<typeof resolveTaskLinkProfile>[0];

const connections = [
  { profile: { id: "local-default" }, sessions: [{ id: "ses_local" }] },
  { profile: { id: "work" }, sessions: [{ id: "ses_work" }] },
] as unknown as Connections;

it("opens a linked task on the named profile, or on the one that has it", () => {
  expect(resolveTaskLinkProfile(connections, "ses_local", "work")).toBe("work");
  // A profile from another machine falls back to the server whose list holds the task.
  expect(resolveTaskLinkProfile(connections, "ses_work", "elsewhere")).toBe("work");
  expect(resolveTaskLinkProfile(connections, "ses_work")).toBe("work");
  expect(resolveTaskLinkProfile(connections, "ses_unknown")).toBeUndefined();
  // Before Palot has listed its servers, the link's profile is all there is to go on.
  expect(resolveTaskLinkProfile([], "ses_work", "work")).toBe("work");
});
