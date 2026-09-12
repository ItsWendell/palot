import { createHash, timingSafeEqual } from "node:crypto";
import type { SshPrompt } from "../../shared/ssh-contract";

export function quote(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function requireVersion(version: string) {
  if (!/^0\.0\.0-beta-\d+(?:\.\d+)?$/.test(version)) {
    throw new Error("SSH requires an exact published OpenCode beta version");
  }
  return version;
}

export interface Registration {
  url: string;
  password: string;
  version: string;
  pid: number;
}

/** Match status to its own registration, not another installed service's credentials. */
export function parseRegistration(output: string): Registration | undefined {
  const status = output
    .split(/\r?\n/)
    .findLast((line) => line.startsWith("OPENCODE_SSH_STATUS="))
    ?.slice(20);
  if (!status) return;
  for (const match of output.matchAll(
    /OPENCODE_SSH_REGISTRATION_BEGIN\r?\n([\s\S]*?)\r?\nOPENCODE_SSH_REGISTRATION_END/g,
  )) {
    try {
      const value = JSON.parse(match[1]!) as Registration;
      if (
        value.url === status &&
        typeof value.password === "string" &&
        value.password.length > 0 &&
        typeof value.version === "string" &&
        Number.isInteger(value.pid) &&
        value.pid > 0
      )
        return value;
    } catch {
      /* Ignore unrelated or partial registration files. */
    }
  }
}

export function connectionAddress(registration: Registration) {
  const url = new URL(registration.url);
  if (
    url.protocol !== "http:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    !["127.0.0.1", "localhost", "0.0.0.0", "[::]", "[::1]"].includes(url.hostname)
  ) {
    throw new Error("Remote OpenCode service must listen on a loopback address");
  }
  return {
    host: url.hostname === "[::1]" || url.hostname === "[::]" ? "[::1]" : "127.0.0.1",
    port: Number(url.port || 80),
    password: registration.password,
  };
}

const registrationScript = `status=$("$cli" service status) || exit 0
if [ "$status" = stopped ]; then exit 0; fi
printf 'OPENCODE_SSH_STATUS=%s\\n' "$status"
for file in "\${XDG_STATE_HOME:-$HOME/.local/state}"/opencode/service*.json; do
  if [ ! -f "$file" ]; then continue; fi
  printf 'OPENCODE_SSH_REGISTRATION_BEGIN\\n'
  cat "$file"
  printf '\\nOPENCODE_SSH_REGISTRATION_END\\n'
done
`;

function binaryPath(version: string) {
  return `"$HOME"/${quote(`.opencode/palot-ssh/${requireVersion(version)}/opencode2`)}`;
}

export function discoverScript(version: string) {
  return `set -eu
for candidate in ${cliCandidates(version)}; do
  if [ ! -x "$candidate" ]; then continue; fi
  (cli="$candidate"
${registrationScript})
done
`;
}

function cliCandidates(version: string) {
  return `"$(command -v opencode2 || true)" "$HOME/.opencode/bin/opencode2" ${binaryPath(version)} "$HOME"/.opencode/palot-ssh/*/opencode2 "$HOME"/.opencode/desktop-ssh/*/opencode2`;
}

/** Resolve again before mutation, so a stopped matching installation works offline. */
function selectCliScript(version: string) {
  return `cli=""
for candidate in ${cliCandidates(version)}; do
  if [ ! -x "$candidate" ]; then continue; fi
  actual=$("$candidate" --version 2>/dev/null | awk '{print $NF}' | sed 's/^v//') || continue
  if [ "$actual" = ${quote(requireVersion(version))} ]; then cli="$candidate"; break; fi
done
`;
}

export const probeScript = `set -eu
os=$(uname -s | tr '[:upper:]' '[:lower:]')
arch=$(uname -m)
case "$os" in linux|darwin) ;; *) exit 2 ;; esac
case "$arch" in x86_64|amd64) arch=x64-baseline ;; aarch64|arm64) arch=arm64 ;; *) exit 2 ;; esac
target="$os-$arch"
if [ "$os" = linux ]; then
  if [ -f /etc/alpine-release ] || (ldd --version 2>&1 | grep -qi musl); then target="$target-musl"; fi
fi
printf 'OPENCODE_REMOTE_TARGET=%s\\n' "$target"
`;

export function installScript(version: string) {
  return `set -eu
umask 077
destination=${binaryPath(version)}
mkdir -p "$(dirname "$destination")"
stage=$(mktemp -d "$(dirname "$destination")/.install-XXXXXX")
trap 'rm -rf "$stage"' EXIT HUP INT TERM
cat > "$stage/archive.tgz"
tar -xzf "$stage/archive.tgz" -C "$stage" package/bin/opencode
chmod 700 "$stage/package/bin/opencode"
test "$("$stage/package/bin/opencode" --version | awk '{print $NF}' | sed 's/^v//')" = ${quote(requireVersion(version))}
mv "$stage/package/bin/opencode" "$destination"
`;
}

async function readBounded(response: Response, maxBytes: number) {
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    throw new Error(`OpenCode archive request failed (${response.status})`);
  }
  if (Number(response.headers.get("content-length")) > maxBytes) {
    await response.body.cancel();
    throw new Error("OpenCode download exceeds size limit");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new Error("OpenCode download exceeds size limit");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  return Buffer.concat(chunks);
}

export async function downloadArchive(target: string, version: string, signal: AbortSignal) {
  requireVersion(version);
  if (!/^(?:linux-(?:x64-baseline|arm64)(?:-musl)?|darwin-(?:x64-baseline|arm64))$/.test(target))
    throw new Error("Unsupported remote platform");
  const boundedSignal = AbortSignal.any([signal, AbortSignal.timeout(180_000)]);
  const base = `https://registry.npmjs.org/@opencode/cli-${target}`;
  const metadata = JSON.parse(
    (
      await readBounded(
        await fetch(`${base}/${version}`, { signal: boundedSignal, redirect: "error" }),
        1_048_576,
      )
    ).toString(),
  ) as { version?: string; dist?: { integrity?: string; tarball?: string } };
  const expectedUrl = `${base}/-/cli-${target}-${version}.tgz`;
  if (
    metadata.version !== version ||
    metadata.dist?.tarball !== expectedUrl ||
    !/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(metadata.dist.integrity ?? "")
  )
    throw new Error("Missing trusted OpenCode archive integrity metadata");
  const archive = await readBounded(
    await fetch(expectedUrl, { signal: boundedSignal, redirect: "error" }),
    200 * 1024 * 1024,
  );
  const expected = Buffer.from(metadata.dist!.integrity!.slice(7), "base64");
  const actual = createHash("sha512").update(archive).digest();
  if (expected.length !== actual.length || !timingSafeEqual(actual, expected))
    throw new Error("OpenCode archive integrity check failed");
  return archive;
}

export async function bootstrap(input: {
  version: string;
  signal: AbortSignal;
  run(script: string, archive?: Uint8Array): Promise<string>;
  onStage(stage: string): void;
  prompt(request: SshPrompt): Promise<string | null>;
  download?: typeof downloadArchive;
}) {
  requireVersion(input.version);
  input.signal.throwIfAborted();
  input.onStage("checking");
  const registered = parseRegistration(await input.run(discoverScript(input.version)));
  if (registered?.version === input.version) return connectionAddress(registered);
  const existing = await input.run(
    `set -eu\n${selectCliScript(input.version)}if [ -n "$cli" ]; then printf '%s\\n' ${quote(input.version)}; fi\n`,
  );
  const staged = existing.trim().split(/\s+/).at(-1)?.replace(/^v/, "") === input.version;
  const action = registered ? "replace" : staged ? "start" : "install";
  input.onStage("setup");
  const consent = await input.prompt({
    kind: "setup",
    action,
    version: input.version,
    ...(registered ? { currentVersion: registered.version } : {}),
  });
  input.signal.throwIfAborted();
  if (consent !== "yes") throw new Error("Remote OpenCode setup was cancelled");
  if (!staged) {
    const probe = await input.run(probeScript);
    const target =
      probe
        .split(/\r?\n/)
        .findLast((line) => line.startsWith("OPENCODE_REMOTE_TARGET="))
        ?.slice(23) ?? "";
    input.onStage("downloading");
    const archive = await (input.download ?? downloadArchive)(target, input.version, input.signal);
    input.signal.throwIfAborted();
    input.onStage("uploading");
    await input.run(installScript(input.version), archive);
  }
  input.signal.throwIfAborted();
  input.onStage("starting");
  const result = parseRegistration(
    await input.run(
      `set -eu\n${selectCliScript(input.version)}test -n "$cli"\n"$cli" service ${registered ? "restart" : "start"}\n${registrationScript}`,
    ),
  );
  if (!result || result.version !== input.version)
    throw new Error("Remote OpenCode did not register the required version");
  return connectionAddress(result);
}
