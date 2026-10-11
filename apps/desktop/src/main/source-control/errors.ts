import type {
  SourceControlErrorCode,
  SourceControlFailure,
  SourceControlResult,
} from "../../shared/source-control-contract";
import { GitHubApiError } from "./github-client";
import { GitCommandError } from "./git";

export class SourceControlError extends Error {
  constructor(
    readonly code: SourceControlErrorCode,
    message: string,
    readonly detail?: string,
  ) {
    super(message);
    this.name = "SourceControlError";
  }
}

const GITHUB_CODES: Record<GitHubApiError["code"], SourceControlErrorCode> = {
  credentials: "github-unauthenticated",
  "unsupported-host": "unsupported-remote",
  auth: "github-auth-failed",
  "rate-limited": "github-rate-limited",
  "not-found": "github-not-found",
  forbidden: "github-forbidden",
  validation: "invalid-input",
  network: "github-unavailable",
  response: "github-unavailable",
};

export function toSourceControlFailure(error: unknown): SourceControlFailure {
  if (error instanceof SourceControlError || error instanceof GitCommandError)
    return {
      code: error.code,
      message: error.message,
      ...(error.detail ? { detail: error.detail } : {}),
    };
  if (error instanceof GitHubApiError)
    return {
      code: GITHUB_CODES[error.code],
      message: error.message,
      ...(error.options.retryAt ? { retryAt: error.options.retryAt } : {}),
    };
  return {
    code: "internal",
    message: error instanceof Error ? error.message : "Source control failed unexpectedly.",
  };
}

export async function sourceControlResult<T>(
  operation: () => T | Promise<T>,
): Promise<SourceControlResult<T>> {
  try {
    return { ok: true, value: await operation() };
  } catch (error) {
    return { ok: false, error: toSourceControlFailure(error) };
  }
}
