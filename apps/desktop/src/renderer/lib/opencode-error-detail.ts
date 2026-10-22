import type { PalotCapabilityError } from "../../shared";

/** One field-level problem OpenCode reported, keyed by its dotted path. */
export interface OpenCodeErrorIssue {
  path: string;
  message: string;
}

/**
 * The typed error OpenCode declared for a failed request. The promise client throws the
 * declared response body merged into an `Error`, so its tag and fields survive here instead
 * of collapsing into one message.
 */
export interface OpenCodeErrorDetail {
  /** OpenCode's error tag, such as `LocationNotFoundError` or `ServiceUnavailableError`. */
  tag: string;
  message: string;
  /** The file or directory OpenCode named. */
  path: string | null;
  issues: OpenCodeErrorIssue[];
  /** The unavailable OpenCode service, such as `plugin`. */
  service: string | null;
  /** The request field OpenCode rejected. */
  field: string | null;
  /** OpenCode's log reference for an unexpected failure. */
  reference: string | null;
}

/** A capability failure that keeps OpenCode's typed error next to its readable message. */
export interface OpenCodeCapabilityError extends PalotCapabilityError {
  detail?: OpenCodeErrorDetail;
}

type UnknownRecord = Record<string, unknown>;

const record = (value: unknown): UnknownRecord | null =>
  value !== null && typeof value === "object" ? (value as UnknownRecord) : null;
const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

function issues(value: unknown): OpenCodeErrorIssue[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const issue = record(item);
    const message = text(issue?.message);
    if (!issue || !message) return [];
    const path = Array.isArray(issue.path)
      ? issue.path.map(String).join(".")
      : (text(issue.path) ?? "");
    return [{ path, message }];
  });
}

/**
 * Finds the error OpenCode declared anywhere in a thrown value's cause chain. Returns
 * `null` for transport failures and other errors OpenCode did not describe.
 */
export function readOpenCodeErrorDetail(error: unknown): OpenCodeErrorDetail | null {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current != null; depth += 1) {
    const value = record(current);
    if (!value) return null;
    const data = record(value.data);
    // V2 errors carry `_tag`; named errors such as `WorktreeError` carry `name` plus `data`.
    const tag = text(value._tag) ?? (data ? text(value.name) : null);
    if (tag) {
      return {
        tag,
        message: text(value.message) ?? text(data?.message) ?? tag,
        path: text(data?.path) ?? text(value.path) ?? text(record(value.location)?.directory),
        issues: issues(data?.issues ?? value.issues),
        service: text(value.service),
        field: text(value.field),
        reference: text(value.ref),
      };
    }
    current = value.cause;
  }
  return null;
}

/** OpenCode's message with the path and each field issue it named, one per line. */
export function describeOpenCodeError(detail: OpenCodeErrorDetail): string {
  const head =
    detail.path && !detail.message.includes(detail.path)
      ? `${detail.message} (${detail.path})`
      : detail.message;
  return [
    head,
    ...detail.issues.map((issue) =>
      issue.path ? `${issue.path}: ${issue.message}` : issue.message,
    ),
  ].join("\n");
}

export function capabilityErrorDetail(error: PalotCapabilityError): OpenCodeErrorDetail | null {
  return (error as OpenCodeCapabilityError).detail ?? null;
}
