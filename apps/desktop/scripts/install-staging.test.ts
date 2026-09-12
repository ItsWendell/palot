// @vitest-environment node

import { mkdtemp, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { withInstallStaging } from "./install-staging";

describe("installation staging cleanup", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "palot-install-test-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("removes staging after success without deleting the installed bundle", async () => {
    const destination = path.join(root, "Palot Nightly.app");
    await withInstallStaging(root, "Palot Nightly", async (bundle) => {
      await mkdir(bundle);
      await writeFile(path.join(bundle, "contents"), "installed");
      await rename(bundle, destination);
    });

    expect(await readdir(root)).toEqual(["Palot Nightly.app"]);
    expect(await readFile(path.join(destination, "contents"), "utf8")).toBe("installed");
  });

  it("removes a partial bundle when cloning or verification fails", async () => {
    await expect(
      withInstallStaging(root, "Palot Nightly", async (bundle) => {
        await mkdir(bundle);
        await writeFile(path.join(bundle, "contents"), "partial");
        throw new Error("verification failed");
      }),
    ).rejects.toThrow("verification failed");

    expect(await readdir(root)).toEqual([]);
  });

  it("only cleans its own directory while another staging operation is active", async () => {
    await withInstallStaging(root, "Palot Nightly", async (activeBundle) => {
      await mkdir(activeBundle);
      await writeFile(path.join(activeBundle, "contents"), "active");
      await expect(
        withInstallStaging(root, "Palot Nightly", async (otherBundle) => {
          expect(otherBundle).not.toBe(activeBundle);
          await mkdir(otherBundle);
          throw new Error("other install failed");
        }),
      ).rejects.toThrow("other install failed");

      expect(await readdir(root)).toEqual([path.basename(path.dirname(activeBundle))]);
      expect(await readFile(path.join(activeBundle, "contents"), "utf8")).toBe("active");
    });
    expect(await readdir(root)).toEqual([]);
  });

  it.each(["SIGINT", "SIGTERM"] as const)(
    "waits for active work before cleanup on %s and unregisters handlers",
    async (signalName) => {
      const previousListeners = process.listeners(signalName);
      await expect(
        withInstallStaging(root, "Palot Nightly", async (bundle, signal) => {
          await mkdir(bundle);
          const interrupt = process
            .listeners(signalName)
            .find((listener) => !previousListeners.includes(listener));
          expect(interrupt).toBeDefined();
          // Invoke only this installer's handler, not Vitest's signal handlers.
          interrupt!(signalName);
          expect(signal.aborted).toBe(true);
          await writeFile(path.join(bundle, "contents"), "in-flight command finished");
          expect(await readdir(root)).toHaveLength(1);
        }),
      ).rejects.toThrow("Nightly installation interrupted");

      expect(await readdir(root)).toEqual([]);
      expect(process.listeners(signalName)).toEqual(previousListeners);
    },
  );
});
