export interface ErrorDiagnostic {
  name: string;
  message: string;
  code?: string;
  cause?: ErrorDiagnostic;
}

function errorCode(value: object): string | undefined {
  if (!("code" in value)) return undefined;
  const code = value.code;
  return typeof code === "string" || typeof code === "number" ? String(code) : undefined;
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
      ...(value.cause !== undefined ? { cause: errorDiagnostic(value.cause, depth + 1) } : {}),
    };
  }
  return { name: "Error", message: typeof error === "string" ? error : String(error) };
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
  return current.message && current.message !== "undefined" ? current.message : fallback;
}
