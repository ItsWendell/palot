import { ClientError } from "@opencode/client";
import { describe, expect, it } from "vitest";
import {
  inviteAddresses,
  inviteExpiryLabel,
  inviteReachSummary,
  machineErrorMessage,
  machineJoined,
  machineNameProblem,
  machineReach,
  machineRows,
  machinesUnavailable,
} from "./opencode-machines";

describe("machine rows", () => {
  it("maps OpenCode's list to states, platform and link, sorted by name", () => {
    expect(
      machineRows([
        { id: "gpu", online: false, paired: true },
        {
          id: "devbox",
          online: true,
          paired: true,
          os: "linux",
          arch: "x64",
          connection: { kind: "iroh", path: "relayed", rtt: 41.6 },
        },
        { id: "build", online: false, paired: false },
      ]),
    ).toEqual([
      {
        name: "build",
        state: "waiting",
        stateLabel: "Waiting to join",
        platform: null,
        link: null,
      },
      {
        name: "devbox",
        state: "connected",
        stateLabel: "Connected",
        platform: "linux · x64",
        link: "Iroh · relayed · 42 ms",
      },
      { name: "gpu", state: "offline", stateLabel: "Offline", platform: null, link: null },
    ]);
  });

  it("drops stale platform and link details once a machine is offline", () => {
    const [row] = machineRows([
      {
        id: "devbox",
        online: false,
        paired: true,
        os: "linux",
        connection: { kind: "websocket", path: "direct" },
      },
    ]);
    expect(row).toMatchObject({ platform: null, link: null });
  });

  it("waits until the named machine is paired and online", () => {
    expect(machineJoined([{ id: "devbox", online: false, paired: false }], "devbox")).toBe(false);
    expect(machineJoined([{ id: "devbox", online: true, paired: true }], "devbox")).toBe(true);
    expect(machineJoined([{ id: "gpu", online: true, paired: true }], "devbox")).toBe(false);
  });
});

describe("join strings", () => {
  it("builds link addresses like OpenCode's CLI: reachable first, once each", () => {
    expect(
      machineReach([
        "http://127.0.0.1:4096",
        "https://box.tail.ts.net",
        "http://192.168.1.5:4096/",
        "not a url",
        "http://127.0.0.1:4096",
      ]),
    ).toEqual([
      { type: "url", url: "wss://box.tail.ts.net/api/experimental/machine/link" },
      { type: "url", url: "ws://192.168.1.5:4096/api/experimental/machine/link" },
      { type: "url", url: "ws://127.0.0.1:4096/api/experimental/machine/link" },
    ]);
  });

  it("says where a join string works from", () => {
    expect(inviteReachSummary([{ type: "iroh" }])).toBe("Works from any network.");
    expect(inviteReachSummary([{ type: "url", url: "ws://10.0.0.2/x" }])).toMatch(/reach one/);
    expect(inviteReachSummary([{ type: "url", url: "ws://127.0.0.1/x" }])).toMatch(/loopback/);
    expect(inviteAddresses([{ type: "iroh" }, { type: "url", url: "ws://a/x" }])).toEqual([
      "Iroh relay network",
      "ws://a/x",
    ]);
  });

  it("counts down to expiry", () => {
    expect(inviteExpiryLabel(10 * 60_000, 5 * 60_000)).toBe("Expires in 5 minutes");
    expect(inviteExpiryLabel(60_000 + 1_000, 1_000)).toBe("Expires in 1 minute");
    expect(inviteExpiryLabel(20_000, 0)).toBe("Expires in less than a minute");
    expect(inviteExpiryLabel(0, 1)).toBe("Expired");
  });
});

describe("machine errors", () => {
  it("validates names before sending them", () => {
    expect(machineNameProblem("devbox")).toBeNull();
    expect(machineNameProblem("")).toBe("Enter a name.");
    expect(machineNameProblem("local")).toMatch(/reserved/);
    expect(machineNameProblem("Dev Box")).toMatch(/lowercase/);
  });

  it("treats a disabled flag or a missing route as no machines", () => {
    expect(machinesUnavailable({ _tag: "ForbiddenError", message: "off" })).toBe(true);
    expect(machinesUnavailable(new ClientError("UnsupportedContentType"))).toBe(true);
    expect(machinesUnavailable(new Error("network down"))).toBe(false);
  });

  it("explains OpenCode's typed failures", () => {
    expect(machineErrorMessage({ _tag: "ConflictError", message: "x" }, "devbox")).toMatch(
      /already paired/,
    );
    expect(
      machineErrorMessage({ _tag: "InvalidRequestError", message: "x", kind: "invalid_name" }, "A"),
    ).toMatch(/not a valid machine name/);
    expect(
      machineErrorMessage({ _tag: "MachineNotFoundError", message: "x", machine: "gpu" }),
    ).toBe("No machine named “gpu”.");
  });
});
