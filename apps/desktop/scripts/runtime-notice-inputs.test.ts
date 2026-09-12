import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import inputs from "../resources/licenses/RUNTIME_NOTICE_INPUTS.json";
import { verifyRuntimeNoticeInputs } from "./runtime-notice-inputs";

const directories: string[] = [];
const licenseDirectory = path.resolve(import.meta.dirname, "../resources/licenses");
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

it("retains all recorded notice bytes", async () => {
  for (const notice of Object.values(inputs.notices)) {
    const bytes = await readFile(path.join(licenseDirectory, notice.file));
    expect(createHash("sha256").update(bytes).digest("hex"), notice.file).toBe(notice.sha256);
  }
});

it("rejects unknown artifacts and changed executable bytes before accepting notices", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "palot-runtime-notices-"));
  directories.push(directory);
  const artifactPath = path.join(directory, "runtime");
  await writeFile(artifactPath, "not the reviewed runtime");
  const input = { artifactId: "unknown", artifactPath, licenseDirectory: directory };
  await expect(verifyRuntimeNoticeInputs(input)).rejects.toThrow("Unknown runtime artifact");
  await expect(
    verifyRuntimeNoticeInputs({ ...input, artifactId: "ghostty-web-wasm" }),
  ).rejects.toThrow("SHA-256 changed");
});

it("validates the actual pinned WASM and rejects missing or altered retained notices", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "palot-runtime-notices-"));
  directories.push(directory);
  await mkdir(path.join(directory, "upstream"));
  const artifactPath = path.resolve(
    import.meta.dirname,
    "../../../node_modules/ghostty-web/ghostty-vt.wasm",
  );
  const input = { artifactId: "ghostty-web-wasm", artifactPath, licenseDirectory: directory };
  await expect(verifyRuntimeNoticeInputs(input)).rejects.toThrow();
  for (const notice of Object.values(inputs.notices)) {
    await writeFile(
      path.join(directory, notice.file),
      await readFile(path.join(licenseDirectory, notice.file)),
    );
  }
  expect(await verifyRuntimeNoticeInputs(input)).toContain("upstream/z2d.COPYING.txt");
  await writeFile(path.join(directory, "upstream/z2d.COPYING.txt"), "modified notice");
  await expect(verifyRuntimeNoticeInputs(input)).rejects.toThrow(
    "Runtime notice changed: upstream/z2d.COPYING.txt",
  );
});
