import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  bootstrap,
  connectionAddress,
  discoverScript,
  downloadArchive,
  installScript,
  parseRegistration,
  quote,
  requireVersion,
} from "./bootstrap";

const version = "0.0.0-beta-19507";
const registration = { url: "http://127.0.0.1:4321", password: "private", version, pid: 123 };
const output = (value = registration) =>
  `banner\nOPENCODE_SSH_STATUS=${value.url}\nOPENCODE_SSH_REGISTRATION_BEGIN\n${JSON.stringify(value)}\nOPENCODE_SSH_REGISTRATION_END\n`;
afterEach(() => vi.unstubAllGlobals());

const fixtureDirectories: string[] = [];
afterEach(async () => {
  await Promise.all(
    fixtureDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function remoteFixture() {
  const directory = await mkdtemp(join(tmpdir(), "palot-ssh-test-"));
  fixtureDirectories.push(directory);
  const home = join(directory, "home with 'quote");
  const state = join(home, ".local/state");
  await mkdir(join(state, "opencode"), { recursive: true });
  const addCli = async (path: string, cliVersion = version) => {
    const filename = join(home, path);
    await mkdir(dirname(filename), { recursive: true });
    await writeFile(
      filename,
      `#!/bin/sh
set -eu
if [ "$1" = --version ]; then printf '%s\\n' ${quote(cliVersion)}; exit 0; fi
test "$1" = service
case "$2" in
  status) if [ -f "$HOME/status" ]; then cat "$HOME/status"; else printf 'stopped\\n'; fi ;;
  start|restart)
    printf '%s\\n' "$2" >> "$HOME/mutations"
    printf '%s\\n' ${quote(registration.url)} > "$HOME/status"
    printf '%s\\n' ${quote(JSON.stringify({ ...registration, version: cliVersion }))} > "$HOME/.local/state/opencode/service.json"
    ;;
  *) exit 2 ;;
esac
`,
      { mode: 0o700 },
    );
  };
  const setRunning = async (cliVersion: string) => {
    await writeFile(join(home, "status"), `${registration.url}\n`);
    await writeFile(
      join(state, "opencode/service.json"),
      JSON.stringify({ ...registration, version: cliVersion }),
    );
  };
  const run = async (script: string) => {
    const result = spawnSync("/bin/sh", ["-s"], {
      input: script,
      encoding: "utf8",
      timeout: 5_000,
      env: { HOME: home, XDG_STATE_HOME: state, PATH: `${join(home, "path")}:/usr/bin:/bin` },
    });
    if (result.error || result.status !== 0) throw result.error ?? new Error(result.stderr);
    return result.stdout;
  };
  return { home, addCli, setRunning, run };
}

describe("SSH bootstrap", () => {
  it.each([version, "0.0.0-beta-19425"])(
    "installs the renamed archive executable only when its version matches (%s)",
    async (archiveVersion) => {
      const fixture = await remoteFixture();
      await fixture.addCli(`.opencode/palot-ssh/${version}/opencode2`);
      const destination = join(fixture.home, `.opencode/palot-ssh/${version}/opencode2`);
      const previous = await readFile(destination, "utf8");
      await fixture.addCli("package/bin/opencode", archiveVersion);
      await writeFile(
        join(fixture.home, "package/bin/opencode"),
        `#!/bin/sh\nprintf 'opencode v${archiveVersion}\\n'\n`,
      );
      const archive = spawnSync("tar", ["-czf", "-", "package/bin/opencode"], {
        cwd: fixture.home,
      });
      expect(archive.status).toBe(0);
      const installed = spawnSync("/bin/sh", ["-c", installScript(version)], {
        input: archive.stdout,
        env: { HOME: fixture.home, PATH: "/usr/bin:/bin" },
        timeout: 5_000,
      });
      if (archiveVersion !== version) {
        expect(installed.status).not.toBe(0);
        expect(await readFile(destination, "utf8")).toBe(previous);
      } else {
        expect(installed.status, installed.stderr.toString()).toBe(0);
        expect(spawnSync(destination, ["--version"], { encoding: "utf8" }).stdout).toBe(
          `opencode v${version}\n`,
        );
      }
    },
  );

  it.each(["palot-ssh", "desktop-ssh"])(
    "discovers a service using an older %s cached CLI without mutating it",
    async (cache) => {
      const fixture = await remoteFixture();
      const oldVersion = "0.0.0-beta-19000";
      await fixture.addCli(`.opencode/${cache}/${oldVersion}/opencode2`, oldVersion);
      await fixture.setRunning(oldVersion);
      expect(parseRegistration(await fixture.run(discoverScript(version)))).toEqual({
        ...registration,
        version: oldVersion,
      });
      await expect(access(join(fixture.home, "mutations"))).rejects.toThrow();
    },
  );

  it.each(["path/opencode2", ".opencode/bin/opencode2"])(
    "starts a stopped exact-version %s installation offline",
    async (path) => {
      const fixture = await remoteFixture();
      await fixture.addCli(path);
      const download = vi.fn().mockRejectedValue(new Error("offline"));
      const prompt = vi.fn().mockResolvedValue("yes");
      await bootstrap({
        version,
        signal: new AbortController().signal,
        run: fixture.run,
        download,
        prompt,
        onStage: vi.fn(),
      });
      expect(prompt).toHaveBeenCalledWith({ kind: "setup", action: "start", version });
      expect(download).not.toHaveBeenCalled();
      expect(await readFile(join(fixture.home, "mutations"), "utf8")).toBe("start\n");
    },
  );

  it("requires replacement consent for an older cached service before restarting it with an exact PATH binary", async () => {
    const fixture = await remoteFixture();
    const oldVersion = "0.0.0-beta-19000";
    await fixture.addCli(`.opencode/palot-ssh/${oldVersion}/opencode2`, oldVersion);
    await fixture.addCli("path/opencode2");
    await fixture.setRunning(oldVersion);
    const prompt = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce("yes");
    const download = vi.fn().mockRejectedValue(new Error("offline"));
    const options = {
      version,
      signal: new AbortController().signal,
      run: fixture.run,
      prompt,
      download,
      onStage: vi.fn(),
    };
    await expect(bootstrap(options)).rejects.toThrow("cancelled");
    await expect(access(join(fixture.home, "mutations"))).rejects.toThrow();
    await bootstrap(options);
    expect(prompt).toHaveBeenNthCalledWith(2, {
      kind: "setup",
      action: "replace",
      version,
      currentVersion: oldVersion,
    });
    expect(download).not.toHaveBeenCalled();
    expect(await readFile(join(fixture.home, "mutations"), "utf8")).toBe("restart\n");
  });
  it("matches the exact status registration and ignores malformed and unrelated files", () => {
    expect(
      parseRegistration(
        `OPENCODE_SSH_REGISTRATION_BEGIN\n{}\nOPENCODE_SSH_REGISTRATION_END\n${output()}`,
      ),
    ).toEqual(registration);
    expect(
      parseRegistration(
        output().replace(
          "OPENCODE_SSH_STATUS=http://127.0.0.1:4321",
          "OPENCODE_SSH_STATUS=http://127.0.0.1:9999",
        ),
      ),
    ).toBeUndefined();
    expect(parseRegistration(output().replace('"pid":123', '"pid":0'))).toBeUndefined();
  });

  it("rejects external service addresses and normalizes wildcard listeners", () => {
    for (const url of [
      "https://127.0.0.1",
      "http://example.com",
      "http://127.0.0.1/path",
      "http://user@localhost",
      "http://localhost/?x=1",
    ]) {
      expect(() => connectionAddress({ ...registration, url })).toThrow();
    }
    expect(connectionAddress({ ...registration, url: "http://0.0.0.0:1234" }).host).toBe(
      "127.0.0.1",
    );
    expect(connectionAddress({ ...registration, url: "http://[::]:1234" }).host).toBe("[::1]");
  });

  it("never mutates the remote without explicit setup consent", async () => {
    const run = vi.fn().mockResolvedValue("");
    const download = vi.fn();
    const prompt = vi.fn().mockResolvedValue(null);
    await expect(
      bootstrap({
        version,
        signal: new AbortController().signal,
        run,
        download,
        prompt,
        onStage: vi.fn(),
      }),
    ).rejects.toThrow("cancelled");
    expect(run).toHaveBeenCalledTimes(2);
    expect(download).not.toHaveBeenCalled();
    expect(prompt).toHaveBeenCalledWith({ kind: "setup", action: "install", version });
  });

  it("reuses a compatible service without setup or download", async () => {
    const run = vi.fn().mockResolvedValue(output());
    const prompt = vi.fn();
    await expect(
      bootstrap({ version, signal: new AbortController().signal, run, prompt, onStage: vi.fn() }),
    ).resolves.toEqual({ host: "127.0.0.1", port: 4321, password: "private" });
    expect(prompt).not.toHaveBeenCalled();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("uploads only the exact version after replacement consent", async () => {
    const old = { ...registration, version: "0.0.0-beta-19000" };
    const run = vi
      .fn()
      .mockResolvedValueOnce(output(old))
      .mockResolvedValueOnce("")
      .mockResolvedValueOnce("OPENCODE_REMOTE_TARGET=linux-x64-baseline-musl\n")
      .mockResolvedValueOnce("")
      .mockResolvedValueOnce(output());
    const archive = new Uint8Array([1, 2]);
    const download = vi.fn().mockResolvedValue(archive);
    const prompt = vi.fn().mockResolvedValue("yes");
    await bootstrap({
      version,
      signal: new AbortController().signal,
      run,
      download,
      prompt,
      onStage: vi.fn(),
    });
    expect(prompt).toHaveBeenCalledWith({
      kind: "setup",
      action: "replace",
      version,
      currentVersion: old.version,
    });
    expect(download).toHaveBeenCalledWith(
      "linux-x64-baseline-musl",
      version,
      expect.any(AbortSignal),
    );
    expect(run.mock.calls[3]?.[1]).toBe(archive);
    expect(run.mock.calls[4]?.[0]).toContain('"$cli" service restart');
  });

  it("checks cancellation after consent before remote mutation", async () => {
    const controller = new AbortController();
    const run = vi.fn().mockResolvedValue("");
    const prompt = vi.fn(async () => {
      controller.abort();
      return "yes";
    });
    await expect(
      bootstrap({ version, signal: controller.signal, run, prompt, onStage: vi.fn() }),
    ).rejects.toThrow();
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("does not allow version shell injection or unpublished fallback", () => {
    for (const value of ["latest", "local", "1;touch /x", "0.0.0-beta-1/../../x"])
      expect(() => requireVersion(value)).toThrow();
    expect(quote("a'b")).toBe("'a'\\''b'");
  });

  it("uses @opencode archives and verifies sha512 before upload", async () => {
    const archive = Buffer.from("archive");
    const url = `https://registry.npmjs.org/@opencode/cli-linux-arm64/-/cli-linux-arm64-${version}.tgz`;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            version,
            dist: {
              tarball: url,
              integrity: `sha512-${createHash("sha512").update(archive).digest("base64")}`,
            },
          }),
        ),
      )
      .mockResolvedValueOnce(new Response(archive));
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      downloadArchive("linux-arm64", version, new AbortController().signal),
    ).resolves.toEqual(archive);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      `https://registry.npmjs.org/@opencode/cli-linux-arm64/${version}`,
    );
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            version,
            dist: { tarball: url, integrity: `sha512-${Buffer.alloc(64).toString("base64")}` },
          }),
        ),
      )
      .mockResolvedValueOnce(new Response(archive));
    await expect(
      downloadArchive("linux-arm64", version, new AbortController().signal),
    ).rejects.toThrow("integrity check failed");
  });
});
