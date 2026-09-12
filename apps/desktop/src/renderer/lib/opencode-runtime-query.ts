import type { OpenCodeRuntimeStatus } from "../../shared";

export function canFetchOpenCode(runtime: OpenCodeRuntimeStatus | null): boolean {
  return Boolean(runtime?.connected && runtime.connectionID !== "preview");
}
