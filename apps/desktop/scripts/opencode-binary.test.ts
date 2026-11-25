// @vitest-environment node

import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  findOpenCodeBinary,
  findOpenCodeBinarySync,
  openCodeCandidates,
} from "./opencode-binary.ts";

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "palot-opencode-binary-"));
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

async function fakeOpenCode(file: string, version: string) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `#!/bin/sh\necho "opencode2 v${version}"\n`);
  await chmod(file, 0o755);
}

describe("OpenCode binary", () => {
  it("prefers OPENCODE_BIN, then the primary checkout's copy, then install locations", () => {
    const candidates = openCodeCandidates({
      version: "2.2.7",
      primaryCheckout: "/checkout",
      environment: { OPENCODE_BIN: "/custom/opencode", PATH: "/bin" },
      home: "/home/me",
    });
    expect(candidates.slice(0, 3)).toEqual([
      "/custom/opencode",
      "/checkout/.local/opencode-bin/2.2.7/opencode",
      "/home/me/.opencode/bin/opencode2",
    ]);
    expect(candidates.at(-1)).toBe("/bin/opencode2");
  });

  it.skipIf(process.platform === "win32")(
    "skips a candidate whose version differs and finds the primary checkout's copy",
    async () => {
      const wrong = path.join(directory, "wrong/opencode");
      await fakeOpenCode(wrong, "2.2.70");
      const local = path.join(directory, ".local/opencode-bin/2.2.7/opencode");
      await fakeOpenCode(local, "2.2.7");
      const previous = process.env.OPENCODE_BIN;
      process.env.OPENCODE_BIN = wrong;
      try {
        const options = { version: "2.2.7", primaryCheckout: directory };
        expect(await findOpenCodeBinary(options)).toBe(local);
        expect(findOpenCodeBinarySync(options)).toBe(local);
        expect(() => findOpenCodeBinarySync({ ...options, version: "2.2.8" })).toThrow(
          "OpenCode 2.2.8 is required",
        );
      } finally {
        if (previous === undefined) delete process.env.OPENCODE_BIN;
        else process.env.OPENCODE_BIN = previous;
      }
    },
  );
});
