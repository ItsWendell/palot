import { OpenCode } from "@opencode/client";
import type { OpenCodeConnectionProblem } from "../../shared";
import { actionableErrorMessage } from "../../shared/diagnostics";
import { SUPPORTED_OPENCODE_VERSION, isSupportedOpenCodeVersion } from "../opencode-version";

/** What Palot was doing when the error happened. */
export type ConnectionStage = "redeem" | "connect";

const GATEWAY_STATUSES = new Set([502, 503, 504, 520, 521, 522, 523, 524, 525, 526, 530]);
const REFUSED = new Set(["ECONNREFUSED", "ECONNRESET", "EPIPE"]);
const NOT_FOUND = new Set(["ENOTFOUND", "EAI_AGAIN", "EAI_NONAME", "EAI_FAIL"]);
const UNREACHABLE = new Set([
  "ETIMEDOUT",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EHOSTDOWN",
  "ENETDOWN",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
]);

interface ErrorFacts {
  codes: string[];
  status: number | null;
  timeout: boolean;
  unauthorized: boolean;
}

/** Collect codes and statuses through the cause chain without keeping messages that may echo URLs. */
function errorFacts(error: unknown): ErrorFacts {
  const facts: ErrorFacts = { codes: [], status: null, timeout: false, unauthorized: false };
  let current: unknown = error;
  for (let depth = 0; depth < 8 && current; depth += 1) {
    if (typeof current !== "object") break;
    const value = current as Record<string, unknown>;
    if (value._tag === "UnauthorizedError") facts.unauthorized = true;
    if (typeof value.code === "string") facts.codes.push(value.code);
    if (typeof value.status === "number") facts.status ??= value.status;
    if (value.name === "TimeoutError" || value.name === "AbortError") facts.timeout = true;
    // Node reports a host with several addresses as an AggregateError of per-address errors.
    if (Array.isArray(value.errors)) {
      for (const inner of value.errors as unknown[]) {
        const code = (inner as { code?: unknown } | null)?.code;
        if (typeof code === "string") facts.codes.push(code);
      }
    }
    current = value.cause;
  }
  if (facts.status === 401 || facts.status === 403) facts.unauthorized = true;
  return facts;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "the server";
  }
}

/** Add that the one-time code is gone, so the fix starts with a new one. */
export function withSpentCode(problem: OpenCodeConnectionProblem): OpenCodeConnectionProblem {
  if (problem.codeSpent) return problem;
  return {
    ...problem,
    fix: `${problem.fix} The pairing code was used, so create a new one before trying again.`,
    codeSpent: true,
  };
}

/**
 * Say which part of reaching an OpenCode server failed and how to fix it. The input error is never
 * echoed whole: redemption URLs carry the one-time code.
 */
export function connectionProblem(
  error: unknown,
  input: { url: string; stage: ConnectionStage; codeSpent?: boolean; status?: number | null },
): OpenCodeConnectionProblem {
  const problem = classify(error, input);
  return input.codeSpent ? withSpentCode(problem) : problem;
}

function classify(
  error: unknown,
  input: { url: string; stage: ConnectionStage; status?: number | null },
): OpenCodeConnectionProblem {
  const facts = errorFacts(error);
  // Proxies answer with HTML the client can't decode, so the response status is passed in too.
  if (facts.status === null && input.status && input.status >= 400) {
    facts.status = input.status;
    if (input.status === 401 || input.status === 403) facts.unauthorized = true;
  }
  const host = hostOf(input.url);
  const https = input.url.startsWith("https://");
  if (facts.unauthorized) {
    return input.stage === "redeem"
      ? {
          step: "code",
          title: "The pairing code was already used, has expired, or is wrong.",
          fix: "Codes work once and expire after 5 minutes. On the other computer, create a new pairing code and paste it here.",
          codeSpent: true,
        }
      : {
          step: "credentials",
          title: `${host} didn't accept Palot's saved sign-in.`,
          fix: "Paired sign-ins last up to 30 days, and changing the server's password ends them. Pair again with a new code; Palot keeps this connection and its tasks.",
        };
  }
  if (facts.status === 404 && input.stage === "redeem") {
    return {
      step: "version",
      title: `${host} doesn't accept pairing codes.`,
      fix: `Update OpenCode on the other computer to ${SUPPORTED_OPENCODE_VERSION} (pairing codes need 2.0.17 or newer). If that address isn't OpenCode, check it.`,
    };
  }
  if (facts.status !== null && GATEWAY_STATUSES.has(facts.status)) {
    return {
      step: "tunnel",
      title: `${host} answered, but OpenCode behind it didn't.`,
      fix: "OpenCode may have stopped on the other computer, or its remote access tunnel or proxy is down. Start OpenCode there (opencode service start), check that remote access is still on (opencode service get remote), then try again.",
    };
  }
  if (
    facts.codes.some(
      (code) =>
        code.startsWith("CERT_") ||
        code.startsWith("ERR_TLS") ||
        code.includes("SELF_SIGNED") ||
        code.startsWith("UNABLE_TO_") ||
        code === "DEPTH_ZERO_SELF_SIGNED_CERT",
    )
  ) {
    return {
      step: "certificate",
      title: `${host}'s security certificate isn't trusted.`,
      fix: "Use the computer's Tailscale or remote access address, or a proxy with a valid certificate.",
    };
  }
  if (facts.codes.some((code) => NOT_FOUND.has(code))) {
    return {
      step: "address",
      title: `Couldn't find ${host}.`,
      fix: https
        ? "Check the address. If it's a remote access address, remote access may be off or its address changed; create a new pairing code on the other computer."
        : "Check the address, and that this computer is on the same network or tailnet as the other one.",
    };
  }
  if (facts.codes.some((code) => REFUSED.has(code))) {
    return {
      step: "address",
      title: `Nothing answered at ${host}.`,
      fix: "Make sure OpenCode is running on the other computer. If it only accepts connections from itself, run opencode service set hostname 0.0.0.0 there, or use remote access (opencode pair --remote).",
    };
  }
  if (facts.timeout || facts.codes.some((code) => UNREACHABLE.has(code))) {
    return {
      step: "address",
      title: `${host} didn't answer in time.`,
      fix: "Check that the other computer is awake and on the same network or tailnet, and that no firewall blocks the port.",
    };
  }
  if (facts.status !== null) {
    return {
      step: "server",
      title: `${host} answered with an error (HTTP ${facts.status}).`,
      fix: "Check that the address points at OpenCode and not another service, then try again.",
    };
  }
  const message = error instanceof Error ? actionableErrorMessage(error, "") : "";
  return {
    step: "server",
    title: `Couldn't connect to ${host}.`,
    fix: message && !message.includes("/auth/connect/") ? message : "Try again.",
  };
}

export function unsupportedVersionProblem(version: string): OpenCodeConnectionProblem {
  return {
    step: "version",
    title: `The other computer runs OpenCode ${version}, which Palot doesn't support.`,
    fix: `Update OpenCode there to ${SUPPORTED_OPENCODE_VERSION}, then try again.`,
  };
}

export function plainHttpProblem(sendsSecret: boolean): OpenCodeConnectionProblem {
  return {
    step: "security",
    title: sendsSecret
      ? "Palot won't send a pairing code or password over plain HTTP without your consent."
      : "This address uses plain HTTP.",
    fix: "Use the computer's HTTPS address, or allow plain HTTP if you trust every network in between.",
  };
}

export type ProbeResult =
  | { ok: true; url: string; version: string; supported: boolean }
  | { ok: false; problem: OpenCodeConnectionProblem };

// Problems that prove the server was reached explain more than ones that didn't get there.
const SPECIFICITY: Record<OpenCodeConnectionProblem["step"], number> = {
  credentials: 6,
  code: 6,
  version: 5,
  tunnel: 4,
  certificate: 3,
  server: 2,
  security: 1,
  address: 0,
};

/** A fetch that remembers the last response status, for errors that lose it. */
export function statusRecordingFetch(base: typeof fetch = globalThis.fetch) {
  const state = { status: null as number | null };
  const recording: typeof fetch = async (request, init) => {
    const response = await base(request, init);
    state.status = response.status;
    return response;
  };
  return { fetch: recording, state };
}

/** Ask each address for its server info with the given sign-in, in order. Redirects are refused. */
export async function probeOpenCodeServer(
  urls: string[],
  headers: Record<string, string> | undefined,
  options: { fetch?: typeof fetch; timeoutMs?: number } = {},
): Promise<ProbeResult> {
  const baseFetch = options.fetch ?? globalThis.fetch;
  let best: OpenCodeConnectionProblem | null = null;
  for (const url of urls) {
    const recorder = statusRecordingFetch((request, init) =>
      baseFetch(request, { ...init, redirect: "error" }),
    );
    try {
      const client = OpenCode.make({ baseUrl: url, headers, fetch: recorder.fetch });
      const info = await client.server.info({
        signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
      });
      return {
        ok: true,
        url,
        version: info.version,
        supported: isSupportedOpenCodeVersion(info.version),
      };
    } catch (error) {
      const problem = connectionProblem(error, {
        url,
        stage: "connect",
        status: recorder.state.status,
      });
      if (!best || SPECIFICITY[problem.step] > SPECIFICITY[best.step]) best = problem;
    }
  }
  return { ok: false, problem: best ?? connectionProblem(null, { url: "", stage: "connect" }) };
}
