export interface ErrorDiagnostic {
  name: string;
  message: string;
  code?: string;
  /** The error tag OpenCode declared for a failed request (`UnknownError`, `SessionBusyError`). */
  tag?: string;
  /** OpenCode's reference for an unexpected failure, which finds it in the server log. */
  ref?: string;
  cause?: ErrorDiagnostic;
}

function errorCode(value: object): string | undefined {
  if (!("code" in value)) return undefined;
  const code = value.code;
  return typeof code === "string" || typeof code === "number" ? String(code) : undefined;
}

/** OpenCode's declared tag and log reference; the promise client merges them into the thrown `Error`. */
function openCodeFields(value: object): { tag?: string; ref?: string } {
  const tag = "_tag" in value && typeof value._tag === "string" ? value._tag.trim() : "";
  const ref = "ref" in value && typeof value.ref === "string" ? value.ref.trim() : "";
  return { ...(tag ? { tag } : {}), ...(ref ? { ref } : {}) };
}

function objectMessage(value: object): string {
  if ("message" in value && typeof value.message === "string") return value.message;
  if ("status" in value && typeof value.status === "number") return `HTTP status ${value.status}`;
  return "Unknown error";
}

export function errorDiagnostic(error: unknown, depth = 0): ErrorDiagnostic {
  if (depth >= 5) return { name: "Error", message: "Cause chain truncated" };
  if (error instanceof Error) {
    const code = errorCode(error);
    return {
      name: error.name || "Error",
      message: error.message || "Unknown error",
      ...(code ? { code } : {}),
      ...openCodeFields(error),
      ...(error.cause !== undefined ? { cause: errorDiagnostic(error.cause, depth + 1) } : {}),
    };
  }
  if (error && typeof error === "object") {
    const value = error as { name?: unknown; message?: unknown; cause?: unknown };
    const code = errorCode(error);
    return {
      name: typeof value.name === "string" ? value.name : "Error",
      message: objectMessage(error),
      ...(code ? { code } : {}),
      ...openCodeFields(error),
      ...(value.cause !== undefined ? { cause: errorDiagnostic(value.cause, depth + 1) } : {}),
    };
  }
  return { name: "Error", message: typeof error === "string" ? error : String(error) };
}

/**
 * "UnknownError · ref 01J…": the declared tag and log reference of the first error in the cause
 * chain that carries an OpenCode reference, or null when none does. Shown beside an error's
 * message so it can be found in OpenCode's server log; a tag alone stays in the logged diagnostic.
 */
export function openCodeErrorReference(error: unknown): string | null {
  for (let current: ErrorDiagnostic | undefined = errorDiagnostic(error); current;) {
    if (current.ref) return [current.tag, `ref ${current.ref}`].filter(Boolean).join(" · ");
    current = current.cause;
  }
  return null;
}

export function actionableErrorMessage(error: unknown, fallback: string): string {
  const diagnostic = errorDiagnostic(error);
  let current = diagnostic;
  while (
    current.cause &&
    (["Transport", "UnexpectedStatus", "UnsupportedContentType", "MalformedResponse"].includes(
      current.message,
    ) ||
      current.message.toLowerCase() === "fetch failed")
  ) {
    current = current.cause;
  }
  // Some servers put their stack trace in the message; people need only the sentence above it.
  const message = current.message.split(/\n\s+at\s/, 1)[0]!.trim();
  return message && message !== "undefined" ? message : fallback;
}
