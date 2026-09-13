# OpenCode runtime management

Palot's desktop installers do not bundle the OpenCode executable. Existing local
installations are preferred, and Palot can connect to a running service without
having its own runtime. A first-time user can install OpenCode using the
[official instructions](https://opencode.ai/v2/docs#install), or explicitly download
an app-private fallback directly from OpenCode's official release feed.

In the disconnected screen, open **OpenCode release settings**, choose Stable or
Beta, then **Check for release** and download the offered runtime. Close setup and
use the separate **Start OpenCode** confirmation. Nothing is downloaded on startup,
and downloading does not start or replace the shared service. First-time download
requires internet access; a previously verified prepared runtime works offline.

Every package carries `opencode/policy.json` declaring this external-runtime
contract. Package verification rejects unexpected runtime executables or manifests
in that directory. A missing or corrupt policy is a packaging error, not permission
to silently acquire an executable. Palot's macOS app remains ad-hoc signed unless
explicitly signed with a local certificate.

## Compatibility

Palot supports stable OpenCode **2.x**, starting at 2.0.0, without a patch-version
override. The generated client and isolated release-smoke runtime remain pinned to
2.0.2 for repeatable checks. The previously tested beta `0.0.0-beta-19507` is also accepted.
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
fallback. Choosing **Palot runtime** explicitly opts into the prepared download
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
An offline or failed check does not replace the prepared runtime. **Reset prepared
runtime** clears the next-start selection without restarting anything or changing
an installed CLI. Check and prepare another offered release to select it later.

On an explicit **Start OpenCode** action, Palot checks the selected installed
executable, or re-verifies the prepared download's hash and version, before asking
the official `Service.ensure` contract to
start it. Restart verifies the selected binary before stopping a working service.
Opening Palot only discovers an existing service; it does not silently start,
downgrade or replace one. Startup also preserves a healthy service that appears
during discovery rather than treating a race as replacement authorization.

The shared service can be used by other OpenCode clients. Applying a prepared
runtime requires a separately confirmed start/restart that may interrupt their
work. Remote HTTP servers remain owned by their operator. Managed SSH retains
its exact authentication/runtime contract: it needs an installed or prepared
OpenCode matching Palot's pinned client version. It never silently downloads a
different version. If the offered release has moved on, install that exact CLI
version separately for SSH. `OPENCODE_BIN` remains an explicit development/recovery installation
candidate; it never grants permission to update or restart the task-host service.

Continuing with an unreviewed service records approval for the connection profile,
Palot's client baseline and detected service version, not a blanket opt-in to
all future betas. Known API errors remain errors; compatibility never means
silently substituting another server or answering permission requests.
