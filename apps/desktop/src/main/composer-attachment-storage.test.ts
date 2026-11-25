import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, symlink, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  configureAttachmentStorage,
  persistComposerAttachments,
  releaseComposerAttachments,
  restoreComposerAttachments,
  stageClipboardText,
  sweepComposerAttachments,
} from "./file-attachments";

let userData: string;
const uriFile = (uri: string) => fileURLToPath(uri);

beforeAll(async () => {
  userData = await mkdtemp(path.join(os.tmpdir(), "palot-durable-attachments-"));
  configureAttachmentStorage(userData);
});
afterAll(() => rm(userData, { recursive: true, force: true }));

async function stagedText(text: string): Promise<string> {
  return (await stageClipboardText(text)).files[0]!.uri;
}

describe("durable composer attachments", () => {
  test("pasted files are staged under userData, so saved drafts keep them across a restart", async () => {
    const uri = await stagedText("survives");
    expect(uriFile(uri)).toBe(
      path.join(userData, "composer-attachments", "staged", path.basename(uriFile(uri))),
    );
  });

  test("stashing copies pasted files and leaves picked files and remote uploads alone", async () => {
    const staged = await stagedText("stash me");
    const picked = pathToFileURL(path.join(userData, "picked.txt")).href;
    const remote = "file:///srv/opencode/tmp/palot-upload.txt";
    const [copy, ...rest] = await persistComposerAttachments([staged, picked, remote]);
    expect(rest).toEqual([picked, remote]);
    expect(copy).not.toBe(staged);
    expect(path.dirname(uriFile(copy!))).toBe(path.join(userData, "composer-attachments", "stash"));
    expect(await readFile(uriFile(copy!), "utf8")).toBe("stash me");
  });

  test("restoring stages the stashed copy again and reports files that are gone", async () => {
    const [copy] = await persistComposerAttachments([await stagedText("restore me")]);
    const [gone] = await persistComposerAttachments([await stagedText("gone")]);
    await rm(uriFile(gone!));
    const legacy = pathToFileURL(
      path.join(os.tmpdir(), "palot-2", "clipboard-attachments-1", "screenshot-x.png"),
    ).href;
    const outcomes = await restoreComposerAttachments([copy, gone, legacy, "file:///elsewhere"]);
    expect(outcomes.map((outcome) => outcome.status)).toEqual([
      "restored",
      "missing",
      "missing",
      "kept",
    ]);
    const restored = outcomes[0] as { uri: string };
    expect(path.dirname(uriFile(restored.uri))).toBe(
      path.join(userData, "composer-attachments", "staged"),
    );
    expect(await readFile(uriFile(restored.uri), "utf8")).toBe("restore me");
    // The stashed copy stays until the stash entry is gone.
    expect(existsSync(uriFile(copy!))).toBe(true);
  });

  test("releasing deletes stashed copies only", async () => {
    const staged = await stagedText("staged");
    const [copy] = await persistComposerAttachments([staged]);
    await releaseComposerAttachments([copy, staged]);
    expect(existsSync(uriFile(copy!))).toBe(false);
    expect(existsSync(uriFile(staged))).toBe(true);
  });

  test("refuses symlinks and malformed input instead of copying what they point to", async () => {
    const secret = path.join(userData, "secret.txt");
    await writeFile(secret, "secret");
    const link = path.join(userData, "composer-attachments", "staged", "pasted-text-link.txt");
    await symlink(secret, link);
    await expect(persistComposerAttachments([pathToFileURL(link).href])).rejects.toThrow(
      "could not be stashed",
    );
    await expect(persistComposerAttachments("file:///x")).rejects.toThrow("invalid");
    await expect(persistComposerAttachments(Array(21).fill("file:///x"))).rejects.toThrow(
      "invalid",
    );
    await expect(persistComposerAttachments([42])).rejects.toThrow("invalid");
    await rm(link);
  });

  test("a sweep removes old pasted files nothing references and keeps the rest", async () => {
    const referenced = await stagedText("referenced");
    const orphan = await stagedText("orphan");
    const fresh = await stagedText("fresh");
    const [stashedOrphan] = await persistComposerAttachments([await stagedText("stashed")]);
    const old = new Date(Date.now() - 2 * 60 * 60 * 1_000);
    for (const uri of [referenced, orphan, stashedOrphan!]) await utimes(uriFile(uri), old, old);
    await sweepComposerAttachments([referenced]);
    expect(existsSync(uriFile(referenced))).toBe(true);
    expect(existsSync(uriFile(fresh))).toBe(true);
    expect(existsSync(uriFile(orphan))).toBe(false);
    expect(existsSync(uriFile(stashedOrphan!))).toBe(false);

    // Only the first sweep of a launch runs: a later window must not delete a queued paste.
    const queued = await stagedText("queued");
    await utimes(uriFile(queued), old, old);
    await sweepComposerAttachments([]);
    expect(existsSync(uriFile(queued))).toBe(true);
  });
});
