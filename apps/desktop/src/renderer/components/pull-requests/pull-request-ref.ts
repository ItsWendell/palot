import type { PullRequestRef } from "../../../shared/source-control-contract";
import { validateConnectionSearch } from "../../lib/route-search";

export interface PullRequestsRouteSearch {
  profileID?: string;
  /** The selected pull request, `host/owner/name/number`, e.g. `github.com/acme/web/12`. */
  pr?: string;
}

/** `github.com/acme/web/12`: readable in the URL and free of `#`, which a route would drop. */
export function formatPullRequestParam(ref: PullRequestRef): string {
  return `${ref.host.toLowerCase()}/${ref.repository.toLowerCase()}/${ref.number}`;
}

export function parsePullRequestParam(value: unknown): PullRequestRef | null {
  if (typeof value !== "string") return null;
  const parts = value.split("/");
  if (parts.length < 4 || parts.some((part) => !part || part === "." || part === "..")) return null;
  const host = parts[0]!;
  const number = parts.at(-1)!;
  if (!/^\d+$/.test(number)) return null;
  const parsed = Number(number);
  if (!Number.isSafeInteger(parsed) || parsed < 1) return null;
  return {
    host: host.toLowerCase(),
    repository: parts.slice(1, -1).join("/").toLowerCase(),
    number: parsed,
  };
}

export function sameRef(left: PullRequestRef | null, right: PullRequestRef | null): boolean {
  return (
    left !== null &&
    right !== null &&
    left.host === right.host &&
    left.repository === right.repository &&
    left.number === right.number
  );
}

export function validatePullRequestsSearch(
  search: Record<string, unknown>,
): PullRequestsRouteSearch {
  const ref = parsePullRequestParam(search.pr);
  return {
    ...validateConnectionSearch(search),
    ...(ref ? { pr: formatPullRequestParam(ref) } : {}),
  };
}
