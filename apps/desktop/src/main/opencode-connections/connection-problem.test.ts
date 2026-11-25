// @vitest-environment node

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { connectionProblem, probeOpenCodeServer } from "./connection-problem";

class ClientError extends Error {
  constructor(
    readonly reason: string,
    options: ErrorOptions,
  ) {
    super(reason, options);
  }
}

const transport = (code: string) =>
  new ClientError("Transport", {
    cause: Object.assign(new TypeError("fetch failed"), {
      cause: Object.assign(new Error(), { code }),
    }),
  });
const status = (value: number) => new ClientError("UnexpectedStatus", { cause: { status: value } });
const url = "https://box.example";

describe("connectionProblem", () => {
  it("names the failing part and its fix", () => {
    const cases: [unknown, "redeem" | "connect", string][] = [
      [{ _tag: "UnauthorizedError" }, "redeem", "code"],
      [status(401), "connect", "credentials"],
      [status(404), "redeem", "version"],
      [status(502), "connect", "tunnel"],
      [transport("ENOTFOUND"), "connect", "address"],
      [transport("ECONNREFUSED"), "connect", "address"],
      [transport("ETIMEDOUT"), "connect", "address"],
      [transport("DEPTH_ZERO_SELF_SIGNED_CERT"), "connect", "certificate"],
      [
        new ClientError("Transport", { cause: new DOMException("t", "TimeoutError") }),
        "connect",
        "address",
      ],
      [status(500), "connect", "server"],
    ];
    for (const [error, stage, step] of cases) {
      const problem = connectionProblem(error, { url, stage });
      expect(problem.step, `${stage} ${step}`).toBe(step);
      expect(problem.fix.length).toBeGreaterThan(10);
    }
    expect(connectionProblem(transport("ECONNREFUSED"), { url, stage: "connect" }).title).toBe(
      "Nothing answered at box.example.",
    );
  });

  it("reads a host's per-address errors", () => {
    const aggregate = new ClientError("Transport", {
      cause: new TypeError("fetch failed", {
        cause: new AggregateError([Object.assign(new Error(), { code: "ECONNREFUSED" })]),
      }),
    });
    expect(connectionProblem(aggregate, { url, stage: "connect" }).title).toMatch(
      /Nothing answered/,
    );
  });

  it("says when the one-time code is gone and never echoes a redemption URL", () => {
    expect(
      connectionProblem(status(502), { url, stage: "connect", codeSpent: true }),
    ).toMatchObject({
      codeSpent: true,
      fix: expect.stringContaining("create a new one"),
    });
    const leak = new Error("failed GET https://box.example/auth/connect/secret-code-1234567");
    expect(JSON.stringify(connectionProblem(leak, { url, stage: "redeem" }))).not.toContain(
      "secret-code",
    );
  });
});

describe("probeOpenCodeServer", () => {
  let server: Server | undefined;
  afterEach(
    () => new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve())),
  );

  const listen = (handler: Parameters<typeof createServer>[1]) =>
    new Promise<string>((resolve) => {
      server = createServer(handler).listen(0, "127.0.0.1", () =>
        resolve(`http://127.0.0.1:${(server!.address() as AddressInfo).port}`),
      );
    });

  it("returns the first address that answers with its version", async () => {
    const live = await listen((request, response) => {
      expect(request.headers.authorization).toBe("Bearer t");
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ version: "2.3.0", pid: 1, urls: [], paths: { tmp: "/tmp" } }));
    });
    const result = await probeOpenCodeServer(["http://127.0.0.1:9", live], {
      authorization: "Bearer t",
    });
    expect(result).toEqual({ ok: true, url: live, version: "2.3.0", supported: true });
  });

  it("prefers the problem that proves the server answered, even behind an HTML proxy", async () => {
    const denied = await listen((_request, response) => {
      response.statusCode = 401;
      response.setHeader("content-type", "text/html");
      response.end("<h1>Unauthorized</h1>");
    });
    const result = await probeOpenCodeServer(["http://127.0.0.1:9", denied], undefined);
    expect(result.ok ? null : result.problem.step).toBe("credentials");
  });
});
