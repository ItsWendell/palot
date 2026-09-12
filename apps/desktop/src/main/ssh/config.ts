import { isIP } from "node:net";
import type { SshConfig } from "../../shared/ssh-contract";

/** Accept only a destination and individual argv values, never SSH options or a command. */
export function normalizeSshConfig(input: unknown): SshConfig {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("SSH configuration is required");
  }
  const value = input as Record<string, unknown>;
  if (typeof value.target !== "string" || !isSafeTarget(value.target)) {
    throw new Error("SSH target must be a host or user@host without whitespace or shell syntax");
  }
  const config: SshConfig = { target: value.target };
  if (value.port !== undefined) {
    if (
      typeof value.port !== "number" ||
      !Number.isInteger(value.port) ||
      value.port < 1 ||
      value.port > 65535
    ) {
      throw new Error("SSH port must be an integer between 1 and 65535");
    }
    config.port = value.port;
  }
  if (value.identityFile !== undefined) {
    if (
      typeof value.identityFile !== "string" ||
      value.identityFile.trim().length === 0 ||
      value.identityFile.length > 4096 ||
      /\p{Cc}/u.test(value.identityFile)
    ) {
      throw new Error("SSH identity file must be a nonempty path without control characters");
    }
    // Keep spaces and ~ intact. The backend expands ~ and passes this as one argv value.
    config.identityFile = value.identityFile;
  }
  return config;
}

function isSafeTarget(target: string): boolean {
  if (target.length === 0 || target.length > 1024) return false;
  const parts = target.split("@");
  if (parts.length > 2) return false;
  if (parts.length === 2 && !/^[a-zA-Z0-9_][a-zA-Z0-9_.-]*$/.test(parts[0]!)) return false;
  const host = parts.at(-1)!;
  if (/^[a-zA-Z0-9_][a-zA-Z0-9_.-]*$/.test(host)) return true;
  const address = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
  // Permit numeric IPv6 destinations, including a safe interface scope, but not host:port.
  return /^[a-fA-F0-9:]+(?:%[a-zA-Z0-9_.-]+)?$/.test(address) && isIP(address) === 6;
}
