import log from "electron-log/main";
import path from "node:path";

const SENSITIVE_KEY = /(authorization|cookie|password|secret|token|api[-_]?key)/i;
const BEARER_OR_BASIC = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi;
const URL_USER_INFO = /(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi;
const SENSITIVE_ASSIGNMENT =
  /\b(authorization|cookie|password|secret|token|api[-_]?key)\s*([:=])\s*([^\s&,;]+)/gi;

export function redactLogValue(value: unknown, seen = new WeakSet<object>()): unknown {
  if (typeof value === "string") {
    return value
      .replaceAll(BEARER_OR_BASIC, "$1 [REDACTED]")
      .replaceAll(URL_USER_INFO, "$1[REDACTED]@")
      .replaceAll(SENSITIVE_ASSIGNMENT, "$1$2[REDACTED]");
  }
  if (!value || typeof value !== "object") return value;
  if (seen.has(value)) return "[Circular]";
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => redactLogValue(item, seen));
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactLogValue(value.message),
      stack: redactLogValue(value.stack),
    };
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      SENSITIVE_KEY.test(key) ? "[REDACTED]" : redactLogValue(item, seen),
    ]),
  );
}

export function initializeLogging(development: boolean, logDirectory?: string): void {
  if (logDirectory) {
    log.transports.file.resolvePathFn = ({ fileName }) =>
      path.join(logDirectory, fileName ?? "main.log");
  }
  log.transports.file.level = development ? "debug" : "info";
  log.transports.file.maxSize = 5 * 1024 * 1024;
  log.transports.console.level = development ? "debug" : false;
  log.hooks.push((message) => ({
    ...message,
    data: message.data.map((value) => redactLogValue(value)),
  }));
  log.initialize({ preload: false, spyRendererConsole: development });
}
