import { describe, expect, it } from "vitest";
import {
  assertNewTaskOwner,
  destinationKey,
  resolveNewTaskDestination,
} from "./new-task-destination";
import type { OpenCodeRuntimeStatus, PalotProject } from "../../shared";

const context = {
  focusedProfileID: "remote",
  remembered: null,
  profiles: [
    { id: "remote", kind: "remote" },
    { id: "local-default", kind: "local" },
  ],
  disabledProfileIDs: [],
} as const;

describe("execution destination ownership", () => {
  const owner = {
    profileID: "remote",
    connectionID: "connection-remote",
    connected: true,
  } as OpenCodeRuntimeStatus;
  it("keeps colliding project IDs and paths distinct across profiles", () => {
    const project = { id: "same", canonical: "/repo" } as PalotProject;
    expect(destinationKey("local", project)).not.toBe(destinationKey("remote", project));
    expect(destinationKey("local", { ...project, id: "" })).not.toBe(
      destinationKey("remote", { ...project, id: "" }),
    );
  });
  it.each([
    { current: null, profileID: "remote", disabled: [] },
    { current: { ...owner, connected: false }, profileID: "remote", disabled: [] },
    { current: owner, profileID: "remote", disabled: ["remote"] },
    {
      current: { ...owner, profileID: "local", connectionID: "connection-local" },
      profileID: "remote",
      disabled: [],
    },
    { current: owner, profileID: "local", disabled: [] },
  ])("refuses unavailable or changed owner %#", ({ current, profileID, disabled }) => {
    expect(() => assertNewTaskOwner(owner, current, profileID, disabled)).toThrow();
  });
  it("permits only the selected connected owner", () => {
    expect(() => assertNewTaskOwner(owner, owner, "remote", [])).not.toThrow();
  });
});

describe("resolveNewTaskDestination", () => {
  it("defaults to local while browsing remote", () => {
    expect(resolveNewTaskDestination(context)).toEqual({ profileID: "local-default" });
  });

  it("keeps a remembered local project while browsing remote", () => {
    expect(
      resolveNewTaskDestination({
        ...context,
        remembered: { profileID: "local-default", projectID: "same-project" },
      }),
    ).toEqual({ profileID: "local-default", projectID: "same-project" });
  });

  it("keeps a remembered remote owner when the project also exists locally", () => {
    expect(
      resolveNewTaskDestination({
        ...context,
        focusedProfileID: "local-default",
        remembered: { profileID: "remote", projectID: "same-project" },
      }),
    ).toEqual({ profileID: "remote", projectID: "same-project" });
  });

  it("remembers a server without a selected project", () => {
    expect(
      resolveNewTaskDestination({
        ...context,
        remembered: { profileID: "remote", projectID: null },
      }),
    ).toEqual({ profileID: "remote", projectID: undefined });
  });

  it.each(["removed", "disabled"])("falls back locally for a %s saved owner", (state) => {
    expect(
      resolveNewTaskDestination({
        ...context,
        remembered: { profileID: "remote", projectID: "same-project" },
        profiles: state === "removed" ? context.profiles.slice(1) : context.profiles,
        disabledProfileIDs: state === "disabled" ? ["remote"] : [],
      }),
    ).toEqual({ profileID: "local-default" });
  });

  it("uses the registered local profile rather than assuming its ID", () => {
    expect(
      resolveNewTaskDestination({
        ...context,
        profiles: [{ id: "another-local", kind: "local" }, ...context.profiles],
        disabledProfileIDs: ["local-default"],
      }),
    ).toEqual({ profileID: "another-local" });
  });

  it("uses the known local default before the overview is ready", () => {
    expect(resolveNewTaskDestination({ ...context, profiles: [] })).toEqual({
      profileID: "local-default",
    });
  });

  it("does not discard a saved owner before the registry has loaded", () => {
    expect(
      resolveNewTaskDestination({
        ...context,
        profiles: [],
        remembered: { profileID: "remote", projectID: "same-project" },
      }),
    ).toEqual({ profileID: "remote", projectID: "same-project" });
  });

  it.each(["remote", "removed"])(
    "preserves the explicit %s owner even if disabled",
    (profileID) => {
      expect(
        resolveNewTaskDestination({
          ...context,
          profileID,
          projectID: "same-project",
          remembered: { profileID: "local-default", projectID: "same-project" },
          disabledProfileIDs: [profileID],
        }),
      ).toEqual({ profileID, projectID: "same-project" });
    },
  );

  it("does not borrow a remembered project for an explicitly selected server", () => {
    expect(
      resolveNewTaskDestination({
        ...context,
        profileID: "remote",
        remembered: { profileID: "local-default", projectID: "local-project" },
      }),
    ).toEqual({ profileID: "remote", projectID: undefined });
  });

  it("inherits the focused owner for project-only calls, even if disabled", () => {
    expect(
      resolveNewTaskDestination({
        ...context,
        projectID: "same-project",
        remembered: { profileID: "local-default", projectID: "same-project" },
        disabledProfileIDs: ["remote"],
      }),
    ).toEqual({ profileID: "remote", projectID: "same-project" });
  });
});
