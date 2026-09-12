import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import inputs from "../resources/licenses/RUNTIME_NOTICE_INPUTS.json";

/** Verify artifact identity and the bytes of each associated notice. */
export async function verifyRuntimeNoticeInputs(input: {
  artifactId: string;
  artifactPath: string;
  licenseDirectory: string;
}): Promise<string[]> {
  const artifact = inputs.artifacts.find((candidate) => candidate.id === input.artifactId);
  if (!artifact) throw new Error(`Unknown runtime artifact: ${input.artifactId}`);
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(input.artifactPath)) digest.update(chunk);
  const sha256 = digest.digest("hex");
  if (!artifact.sha256.includes(sha256)) {
    throw new Error(`Runtime artifact ${artifact.id} SHA-256 changed: ${sha256}`);
  }
  const files: string[] = [];
  for (const id of artifact.notices) {
    const notice = inputs.notices[id as keyof typeof inputs.notices];
    if (!notice) throw new Error(`Unknown runtime notice: ${id}`);
    const bytes = await readFile(path.join(input.licenseDirectory, notice.file));
    if (createHash("sha256").update(bytes).digest("hex") !== notice.sha256) {
      throw new Error(`Runtime notice changed: ${notice.file}`);
    }
    files.push(notice.file);
  }
  return files;
}
