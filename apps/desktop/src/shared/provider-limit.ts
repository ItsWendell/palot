/**
 * OpenCode's provider limit failures (`Session.StructuredError` with a `provider.*` type), read
 * once so the turn row, the composer notice, the task list and notifications name them the same
 * way. OpenCode 2.4 tells apart the free tier, OpenCode Go windows, Console budgets (all models or
 * one model), ChatGPT plan limits and the limit a ChatGPT workspace admin sets.
 */

const DAY = 86_400_000;
/** Waits longer than this are bogus provider data; Go's monthly window is the longest real one. */
const MAX_RETRY_AFTER_MS = 45 * DAY;

export type ProviderLimitKind =
  | "free-limit"
  | "go-limit"
  | "budget-limit"
  | "model-budget-limit"
  | "chatgpt-limit"
  | "chatgpt-workspace-limit"
  | "out-of-credits"
  | "quota"
  | "rate-limit";

/** The fields of OpenCode's structured error a limit reads. */
export interface ProviderLimitError {
  type?: string | null;
  status?: number | null;
  retryAfterMs?: number | null;
  /** The provider's response body (`response.body`), where Console names windows and resets. */
  body?: string | null;
}

export interface ProviderLimitLink {
  label: string;
  url: string;
}

export interface ProviderLimit {
  kind: ProviderLimitKind;
  /** "OpenCode Go 5 hour limit reached". */
  title: string;
  /** When the limit lifts, or null when OpenCode did not say. */
  resetsAt: number | null;
  /** The limit lifts on its own, so waiting for it means something. An empty balance does not. */
  resets: boolean;
  /** Where to raise the limit, when the error names a page for it. */
  link: ProviderLimitLink | null;
  /** Only an admin can raise it: a message to send them. */
  adminRequest: string | null;
}

const CHATGPT_USAGE_URL = "https://chatgpt.com/settings/usage";
const CONSOLE_URL = "https://opencode.ai/console";

const ADMIN_REQUEST =
  "I've hit our ChatGPT workspace's usage limit for using my ChatGPT plan in other apps (OpenCode). Could you raise my limit? It's under admin.openai.com → Workspace → Usage limits. Thanks!";

type UnknownRecord = Record<string, unknown>;
const record = (value: unknown): UnknownRecord =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value : null;
const finite = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

/** Reads a raw `Session.StructuredError` (or an older `{ name, data }` error) into the fields above. */
export function providerLimitError(value: unknown): ProviderLimitError | null {
  const error = record(value);
  const type = text(error.type) ?? text(error.name);
  if (!type) return null;
  const body = text(record(error.response).body) ?? text(error.body);
  const status = finite(error.status);
  const retryAfterMs = finite(error.retryAfterMs);
  return {
    type,
    ...(status === null ? {} : { status }),
    ...(retryAfterMs === null ? {} : { retryAfterMs }),
    ...(body === null ? {} : { body }),
  };
}

/** A string field OpenCode Console puts in its refusal's metadata, in any protocol's envelope. */
function bodyField(body: string | null | undefined, field: string): string | null {
  if (!body) return null;
  return new RegExp(`"${field}"\\s*:\\s*"([^"]+)"`).exec(body)?.[1] ?? null;
}

function retryReset(failedAt: number, retryAfterMs: number | null | undefined): number | null {
  if (
    typeof retryAfterMs !== "number" ||
    !Number.isFinite(retryAfterMs) ||
    retryAfterMs < 0 ||
    retryAfterMs > MAX_RETRY_AFTER_MS ||
    !Number.isFinite(failedAt)
  )
    return null;
  return failedAt + retryAfterMs;
}

/** The Console Go page of the workspace the refusal names, where Extra Usage is turned on. */
function goPage(body: string | null | undefined): string {
  const workspace = bodyField(body, "workspace");
  return workspace && /^(?:org|wrk)_[\w-]+$/.test(workspace)
    ? `${CONSOLE_URL}/${workspace}/go`
    : CONSOLE_URL;
}

/**
 * The limit a failure hit, or null for other failures. `failedAt` is when the failure was
 * recorded, which a provider's `retryAfterMs` counts from; budgets carry their own reset time.
 * `modelName` names the model a per-model budget paused.
 */
export function providerLimit(
  error: ProviderLimitError | null | undefined,
  failedAt: number,
  options: { modelName?: string | null } = {},
): ProviderLimit | null {
  const type = error?.type;
  if (!type || !error) return null;
  const retry = retryReset(failedAt, error.retryAfterMs);
  const base = { resetsAt: retry, resets: true, link: null, adminRequest: null };
  switch (type) {
    case "provider.free-limit":
      return { ...base, kind: "free-limit", title: "Free usage limit reached" };
    case "provider.go-limit": {
      const window = bodyField(error.body, "limitName");
      return {
        ...base,
        kind: "go-limit",
        title: window ? `OpenCode Go ${window} limit reached` : "OpenCode Go usage limit reached",
        link: { label: "Turn on Extra Usage", url: goPage(error.body) },
      };
    }
    case "provider.budget-limit":
    case "provider.model-budget-limit": {
      const at = Date.parse(bodyField(error.body, "resetsAt") ?? "");
      const resetsAt = Number.isNaN(at) ? retry : at;
      if (type === "provider.budget-limit")
        return { ...base, resetsAt, kind: "budget-limit", title: "Workspace usage limit reached" };
      return {
        ...base,
        resetsAt,
        kind: "model-budget-limit",
        title: options.modelName
          ? `${options.modelName} spend limit reached`
          : "Model spend limit reached",
      };
    }
    case "provider.chatgpt-limit":
      return {
        ...base,
        kind: "chatgpt-limit",
        title: "ChatGPT usage limit reached",
        link: { label: "ChatGPT usage", url: CHATGPT_USAGE_URL },
      };
    case "provider.chatgpt-workspace-limit":
      return {
        ...base,
        kind: "chatgpt-workspace-limit",
        title: "ChatGPT workspace limit reached",
        adminRequest: ADMIN_REQUEST,
      };
    case "provider.quota":
      // OpenCode types an empty balance as a quota too, but answers it with HTTP 402; it never resets.
      return error.status === 402
        ? {
            ...base,
            resetsAt: null,
            resets: false,
            kind: "out-of-credits",
            title: "Out of credits",
          }
        : { ...base, kind: "quota", title: "Usage limit reached" };
    case "provider.rate-limit":
      return { ...base, kind: "rate-limit", title: "Rate limited" };
    default:
      return null;
  }
}

/** "18:00" today, "Dec 1, 18:00" another day, just "Dec 1" when it resets at midnight. */
export function formatLimitReset(at: number, now = Date.now(), locale?: string): string {
  const date = new Date(at);
  if (date.toDateString() === new Date(now).toDateString())
    return new Intl.DateTimeFormat(locale, { timeStyle: "short" }).format(at);
  const midnight = date.getHours() === 0 && date.getMinutes() === 0;
  return new Intl.DateTimeFormat(
    locale,
    midnight
      ? { month: "short", day: "numeric" }
      : { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" },
  ).format(at);
}

/** One line for lists and notifications: "OpenCode Go 5 hour limit reached · resets 18:00". */
export function providerLimitSummary(limit: ProviderLimit, now = Date.now(), locale?: string) {
  return limit.resetsAt !== null && limit.resetsAt > now
    ? `${limit.title} · resets ${formatLimitReset(limit.resetsAt, now, locale)}`
    : limit.title;
}
