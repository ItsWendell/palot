// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { OpenCodeRuntimeStatus } from "../shared/opencode-contract";
import {
  createSessionWindowScope,
  guardFocusedOpenCodeConnection,
  sessionWindowConnection,
} from "./opencode-native-scope";

describe("native OpenCode action scope", () => {
  it("fails closed for omitted, background, and disconnected generations", () => {
    const status = () => ({ connectionID: "focused", connected: true });
    expect(() => guardFocusedOpenCodeConnection(undefined, status)).toThrow("connection ID");
    expect(() => guardFocusedOpenCodeConnection("background", status)).toThrow("connection ID");
    expect(() =>
      guardFocusedOpenCodeConnection("focused", () => ({ ...status(), connected: false })),
    ).toThrow("connection ID");
  });

  it("revalidates focus after asynchronous native work", () => {
    let connectionID = "first";
    const validate = guardFocusedOpenCodeConnection("first", () => ({
      connectionID,
      connected: true,
    }));
    expect(validate).not.toThrow();
    connectionID = "second";
    expect(validate).toThrow("connection ID");
  });
});

function registry() {
  const origin = {
    connectionID: "origin",
    profileID: "profile-origin",
    connected: true,
  } as OpenCodeRuntimeStatus;
  const background = {
    connectionID: "background",
    profileID: "profile-background",
    connected: true,
  } as OpenCodeRuntimeStatus;
  const runtimes = new Map([
    [origin.connectionID, origin],
    [background.connectionID, background],
  ]);
  const runtimeStatus = vi.fn(() => origin);
  const switchProfile = vi.fn();
  return {
    runtimes,
    origin,
    background,
    runtimeStatus,
    switchProfile,
    listRuntimes: () => [...runtimes.values()],
    scopedConnection(connectionID: string) {
      const captured = runtimes.get(connectionID);
      if (!captured) throw new Error("OpenCode connection is unavailable or stale");
      return {
        runtimeStatus() {
          if (runtimes.get(connectionID) !== captured)
            throw new Error("OpenCode connection is unavailable or stale");
          return captured;
        },
      };
    },
  };
}

describe("session-window connection scope", () => {
  it("isolates windows with duplicate session IDs by their exact owning connection", () => {
    const runtime = registry();
    const windows = ["origin", "background"].map((connectionID) => ({
      sessionID: "same-session-id",
      owner: sessionWindowConnection(connectionID, runtime),
    }));
    expect(windows.map(({ sessionID, owner }) => [sessionID, owner.profileID])).toEqual([
      ["same-session-id", "profile-origin"],
      ["same-session-id", "profile-background"],
    ]);
    const scope = createSessionWindowScope(windows[1]!.owner, runtime);
    // Root-route hydration invokes profile-switch IPC. It must resolve locally.
    expect(scope.switchProfile("profile-background")).toBe(runtime.background);
    expect(scope.runtimeStatus()).toBe(runtime.background);
    expect(runtime.switchProfile).not.toHaveBeenCalled();
    expect(runtime.runtimeStatus()).toBe(runtime.origin);
  });

  it.each([undefined, null, "", "disposed"])(
    "rejects missing or stale generation %s",
    (connectionID) => {
      expect(() => sessionWindowConnection(connectionID, registry())).toThrow();
    },
  );

  it("rejects an offline background owner instead of falling back to focus", () => {
    const runtime = registry();
    runtime.background.connected = false;
    expect(() => sessionWindowConnection("background", runtime)).toThrow("disconnected or stale");
    expect(runtime.runtimeStatus).not.toHaveBeenCalled();
  });

  it.each(["offline", "disposed", "replaced", "changed-owner"])(
    "rejects a window whose captured owner becomes %s during loading",
    (change) => {
      const runtime = registry();
      const owner = sessionWindowConnection("background", runtime);
      expect(owner.runtimeStatus()).toBe(runtime.background);
      if (change === "offline") runtime.background.connected = false;
      else if (change === "changed-owner") runtime.background.profileID = "another-profile";
      else {
        runtime.runtimes.delete("background");
        if (change === "replaced")
          runtime.runtimes.set("replacement", {
            ...runtime.background,
            connectionID: "replacement",
          });
      }
      expect(owner.runtimeStatus).toThrow();
    },
  );

  it("keeps profile navigation local and rejects unavailable targets without replacing the window owner", () => {
    const runtime = registry();
    const scope = createSessionWindowScope(sessionWindowConnection("background", runtime), runtime);
    expect(() => scope.switchProfile("missing")).toThrow();
    expect(scope.runtimeStatus()).toBe(runtime.background);
    runtime.origin.connected = false;
    expect(() => scope.switchProfile("profile-origin")).toThrow();
    expect(scope.runtimeStatus()).toBe(runtime.background);
    runtime.origin.connected = true;
    expect(scope.switchProfile("profile-origin")).toBe(runtime.origin);
    expect(scope.runtimeStatus()).toBe(runtime.origin);
    expect(runtime.switchProfile).not.toHaveBeenCalled();
  });

  it("does not silently rebind an existing window to a replacement generation of the same profile", () => {
    const runtime = registry();
    const scope = createSessionWindowScope(sessionWindowConnection("background", runtime), runtime);
    runtime.runtimes.delete("background");
    runtime.runtimes.set("replacement", { ...runtime.background, connectionID: "replacement" });
    expect(() => scope.switchProfile("profile-background")).toThrow("stale");
    expect(scope.runtimeStatus).toThrow("stale");
    expect(runtime.switchProfile).not.toHaveBeenCalled();
  });
});
