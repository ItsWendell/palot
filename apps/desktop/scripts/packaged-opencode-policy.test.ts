import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { verifyExternalRuntimePackage } from "./packaged-opencode-policy";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "palot-runtime-policy-"));
  roots.push(root);
  await mkdir(path.join(root, "opencode"));
  await writeFile(path.join(root, "opencode/policy.json"), '{"schemaVersion":1,"bundled":false}');
  return root;
}

it("accepts the external policy without carrying an executable", async () => {
  const root = await fixture();
  expect(() => verifyExternalRuntimePackage(root)).not.toThrow();
});

it("rejects stale runtime payloads instead of silently distributing them", async () => {
  const root = await fixture();
  await writeFile(path.join(root, "opencode/opencode2"), "stale executable");
  expect(() => verifyExternalRuntimePackage(root)).toThrow("must not ship a runtime");
});

it("requires the policy even though legacy runtime discovery allows its absence", async () => {
  const root = await fixture();
  const file = path.join(root, "opencode/policy.json");
  await rm(file);
  expect(() => verifyExternalRuntimePackage(root)).toThrow("require an explicit");
});
