# OpenCode Runtime Packaging

Palot Linux and macOS packages bundle the exact OpenCode 2 runtime that matches
the pinned client and protocol contract. Packaging downloads the official
architecture-specific npm artifact and checks its version and pinned source
SHA-256 before staging it. Linux uses `resources/opencode`; macOS uses
`Contents/Resources/opencode` and additionally verifies the Mach-O architecture.
The macOS ad-hoc signing pass changes the executable, so source and post-sign
packaged SHA-256 values are pinned and verified separately.

The current 2.0.2 Linux and macOS arm64 and x64-baseline archives were checked
against npm integrity metadata before extraction. Both macOS signed hashes were
reproduced from the original npm bytes using the packaging entitlements and
hardened runtime. Isolated `--version` execution passed on Linux x64 and macOS
arm64 (both original and Palot-signed bytes); Linux arm64 and macOS Intel
qualification is static only. These artifact checks do not constitute full app
packaging or native integration verification for 2.0.2.

Historically, beta19507 Apple Silicon runtime execution, native integration, and
isolated package smoke passed on macOS 26.6.2. That result does not qualify the
current release, an Intel installation, or every macOS version back to the
declared macOS 13 floor. No Intel binary or Rosetta smoke was run.
Do not substitute unsigned source hashes for signed hashes on future updates.

`bun run package:mac` stages the current host architecture. Passing an explicit Electron Builder
architecture stages only that target. The first qualified release target is Apple Silicon.
`bun run package:nightly:linux` stages and verifies the Linux host architecture.
Packaging uses `--publish never` and fails before creating a release if an artifact is absent or differs from the pinned contract in
`apps/desktop/src/main/opencode-runtime-release.ts`.

## Compatibility

Palot supports stable OpenCode **2.x**, starting at 2.0.0, without a patch-version
override. The bundled runtime and generated client remain pinned to 2.0.2 for
reproducible builds. The previously tested beta `0.0.0-beta-19507` is also accepted.
Other recognized V2 beta versions require explicit consent; V1, unknown majors
and malformed versions are refused. Palot's own Stable/Nightly channel does not
change this policy.

This is Palot's compatibility policy, not a claim of a formal upstream warranty.
The official client documentation [demonstrates a 2.x compatibility predicate](https://github.com/anomalyco/opencode/blob/cf4f1fb45e2695d86a4ef8c20a3883f4ac79935a/services/www/src/docs/content/build/client/index.mdx#L162-L174).
The published 2.0.0 client, protocol and schema have the same code and contracts
as beta19507, apart from package version/dependency pins. The 2.0.2 review found
three additive config operations and an additional typed filesystem 404 error,
with no changes to existing event contracts. The new config operations are not
yet used by Palot. Gate a future feature on verified API availability rather than
blocking the whole connection or assuming every Beta has extra features.

## Preferred release and local startup

Existing registered services are always discovered first. For an explicitly
confirmed local start/restart, **Installed OpenCode** is the default preference:
Palot uses the selected compatible user installation before its app-owned
fallback. Choosing **Palot runtime** explicitly opts into the prepared/bundled
path. Service version and installed executable version can differ after an
executable update; neither is inferred from the other.

Installation inspection is local and bounded (`--version`, no network or package
manager queries). OpenCode exposes no machine-readable installation-method plan.
The confirmed update action therefore delegates to the selected executable's
official `upgrade <exact-version>` command, optionally with `--method npm`, `bun`,
`pnpm`, `yarn` or `curl`. Automatic detection is performed by OpenCode itself and
is not prefix-specific when several global installations coexist. Palot verifies
the selected executable again after the command rather than treating exit zero
as proof that the intended installation changed.

No sudo, silent reinstall, package-manager substitution or automatic service
restart is performed. The official upgrade command may contact its compiled-in
update feed and package registry, even with an explicit version. Curl upgrades
execute the official installer. V1 and unsupported installations receive manual
migration guidance rather than being passed an unverified V2 command contract.

Setup and local connection settings offer **Stable** (default) and **Beta**.
The preferred update channel, prepared next-start runtime, and actual connected
service version are separate. Changing the channel never changes a running
service. Checks are user-triggered, not startup requests or polling.

OpenCode's client has no runtime-channel management RPC or capability manifest.
Palot uses the official public update feed
`https://opencode.ai/update/api/{latest|beta}/cli/opencode` and a small main-process
download/cache layer. The feed, not npm's package tag, determines the offered
version. Beta can lag Stable or offer a stable-numbered release; the UI shows the
actual version instead of promising Beta is newer.

Preparing a release verifies its official URL, archive size and SHA-256 before
extracting and checking the executable. Downloads stay in Palot-owned application
data, never a global executable directory. Unreviewed beta execution needs an
explicit confirmation scoped to that version and Palot's client baseline.
An offline or failed check does not replace the prepared runtime. **Use bundled
runtime** restores the bundled next-start selection without restarting anything.

On an explicit **Start OpenCode** action, Palot verifies the selected cached
runtime or the bundled manifest, executable permission, SHA-256, architecture,
and `opencode2 --version` before asking the official `Service.ensure` contract to
start it. Restart verifies the selected binary before stopping a working service.
Opening Palot only discovers an existing service; it does not silently start,
downgrade or replace one. Startup also preserves a healthy service that appears
during discovery rather than treating a race as replacement authorization.

The shared service can be used by other OpenCode clients. Applying a prepared
runtime requires a separately confirmed start/restart that may interrupt their
work. Remote HTTP servers remain owned by their operator. Managed SSH retains
its exact authentication/runtime contract and does not use the local release
selection. `OPENCODE_BIN` remains an explicit development/recovery installation
candidate; it never grants permission to update or restart the task-host service.

Continuing with an unreviewed service records approval for the connection profile,
Palot's client baseline and detected service version, not a blanket opt-in to
all future betas. Known API errors remain errors; compatibility never means
silently substituting another server or answering permission requests.
