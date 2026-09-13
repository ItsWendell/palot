import path from "node:path";
import { readExternalOpenCodeRuntimePolicy } from "../src/main/opencode-runtime-release";

/** Public packages acquire OpenCode separately; reject stale bundled payloads. */
export function verifyExternalRuntimePackage(resources: string): void {
  if (!readExternalOpenCodeRuntimePolicy(path.join(resources, "opencode")))
    throw new Error("Public packages require an explicit external OpenCode runtime policy.");
}
