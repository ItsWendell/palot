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

Palot 0.21.0 supports stable OpenCode **2.x starting at 2.0.7**, without a
patch-version override. The client, protocol, schema, browser plugin and isolated
release-smoke runtime are pinned to **2.2.0** for repeatable checks. Stable
releases before 2.0.7 use incompatible API contracts and are refused. The previously
tested beta `0.0.0-beta-19507` is no longer accepted automatically. Recognized V2 beta
versions require explicit consent; V1, unknown majors and malformed versions are
refused. Palot's own Stable/Nightly channel does not change this policy.

This is Palot's compatibility policy, not a claim of a formal upstream warranty.
The official client documentation [demonstrates a 2.x compatibility predicate](https://github.com/anomalyco/opencode/blob/cf4f1fb45e2695d86a4ef8c20a3883f4ac79935a/services/www/src/docs/content/build/client/index.mdx#L162-L174).
The published 2.0.0 client, protocol and schema have the same code and contracts
as beta19507, apart from package version/dependency pins. The 2.0.2 review found
three additive config operations and an additional typed filesystem 404 error,
with no changes to existing event contracts. Palot now uses `location.reload`
from Settings; shell listing and shell configuration updates remain unused.
The 2.0.3 contract adds `session.diff` and projected `idle`
messages that mark completed, failed or interrupted turns. Palot retains those
markers in hydrated history without displaying extra transcript rows, and uses
the turn-diff operation for the separate Turn changes view. Those changes
left existing event contracts intact.

The 2.0.7 migration changes existing API contracts, including server health,
location/worktree management and session form operations. Palot uses the new
contracts rather than maintaining adapters for older runtimes, so 2.0.7 is now
the connection minimum. Gate future additive features on verified API availability
rather than assuming every Beta has extra features. Retained beta publication and
license evidence describes the historical build, not current compatibility.

The 2.0.8 client adds the `permission` action to generated experimental policy
types without removing operations or changing event contracts. The connection
minimum remains 2.0.7; the newer client pin does not require replacing a compatible
running service.

The 2.0.9 contract moves provider transport and compaction into provider settings,
and model compaction into model settings. Compaction policies now use
`{ type: "summary" }` or `{ type: "native" }`. Palot's catalog adapters do not
consume the removed top-level fields, so the connection minimum remains 2.0.7.
Plugins or user configurations that set those policies must migrate before their
service moves to 2.0.9; updating the client alone does not migrate server config.

The published 2.0.11 client declarations, protocol, and schema are unchanged from
2.0.9, apart from package version and dependency pins. No API migration is needed,
and the connection minimum remains 2.0.7. Transport reliability and session
permission fixes require updating the OpenCode service separately.

The published 2.0.14 contract adds `method: "key" | "oauth"` to stored credential
information. The operation inventory and event variants are unchanged from 2.0.11.
Palot does not depend on the new field, so the connection minimum remains 2.0.7.
Code Mode, provider, plugin cancellation and child prompt-cache fixes require
updating the OpenCode service separately.

The 2.0.18 contract adds server pairing and connection endpoints, mutable session
metadata with a durable event, an optional shell exit signal, and a required
`project.time.active` field. Palot maps project activity, retains session metadata
through hydration and live events, and uses one-time pairing links with stable
services starting at 2.0.17. Older compatible services still use the explicit
legacy credentials flow. A link's code expires within five minutes and can only be
redeemed once. The resulting session token is stored in Palot's credential vault,
can last up to 30 days, and is revoked when the server password changes. Non-loopback
plain HTTP still requires explicit consent before sending a code or token.
These additions do not change the 2.0.7 connection
minimum. Streaming fixes and recovery of 2.0.14 media in compaction checkpoints
require updating the running service; upgrading the client alone is not enough.

The published 2.0.19 client, protocol, schema and browser-plugin declarations
are unchanged from 2.0.18. Its service improves context-window output limits,
compaction, prompt-cache reuse, child-session affinity, and transient AI failure
handling. Palot needs no new API integration or higher connection minimum for this
release. Those behavior changes require updating the running service separately.

The published 2.0.23 contract adds credential listing/creation and VCS initialization,
optional connection authentication status and a form cancellation message, a server
persistent-PTY capability hint, and provider timeout options. Existing Palot workflows
do not need to adopt these additions, and the connection minimum remains 2.0.7.

The published 2.0.24 protocol, schema and browser plugin are unchanged from 2.0.23,
apart from package version and dependency pins. Generated client API and event
declarations are unchanged. The client shares its service health probe and startup
attempt bookkeeping, and adds Solid data helpers that Palot does not use. Existing
service lifecycle signatures remain compatible; no API migration or higher
connection minimum is needed. Provider and shell-scanner fixes require updating the
running service separately.

The 2.0.25 contract adds external credential references and
`integration.connect.external`. Palot renders their setup forms and connects them
through the originating server, including AWS profile and Azure CLI methods
advertised by that server. Unknown connection methods show an unsupported state
instead of being treated as environment credentials. Existing event variants and
browser RPC declarations are unchanged; the connection minimum remains 2.0.7.

OpenCode 2.0.25 also changes experimental managed-policy actions from `permission`
to `tool.use` and `integration.use`, alongside `provider.use`. Review configurations
using those experimental policies before upgrading the service. Its default
permissions no longer ask for external-directory access. Palot does not rewrite
user permissions or duplicate those server policies; its Defaults approval preset
continues to use the connected server's rules. Provider and tool-execution fixes
require updating the running service separately.

The published 2.0.26 client, protocol, schema and browser-plugin declarations are
unchanged from 2.0.25, apart from package version and dependency pins. Its service
offers Google Cloud credentials (gcloud or environment) as an external Vertex
connection method, which Palot renders through the existing external-method flow.
Remote access through `opencode pair --remote` now uses a random, unguessable
subdomain. Snapshot and diff performance fixes require updating the running service
separately. The connection minimum remains 2.0.7.

The 2.0.27 and 2.0.28 packages move to stable Effect 4.0.1, whose HTTP and encoding
modules leave `effect/unstable/*`; Palot pins the same Effect release. The contract
changes are additive: `project.list` takes an optional `archived` filter and hides
archived projects (all directories missing) by default, projects report `archived`,
idle messages can carry a structured `error`, and providers and models gain
`encoding` and `compatibility` settings. Event payloads are unchanged. The service
also adds per-project permission auto-accept, includes subagent sessions in costs,
and asks before `opencode pair --remote` exposes it (`--yes` skips the prompt).
Those and the streaming fixes require updating the running service separately. The
connection minimum remains 2.0.7.

The 2.0.29 client declarations and event payloads are unchanged from 2.0.28. The
protocol exports `PTY_CONNECT_PATH` and `PAIRING_CONNECT_PATH`, and the schema
stabilizes top-level `policies` (`provider.use`, `tool.use`, `integration.use`), which
deprecates `experimental.policies`. The service continues a response after an
output-token limit with a synthetic instruction that has no description; Palot keeps
such synthetic messages out of the transcript. Plugins can assert permissions, and
managed configuration takes precedence. These require updating the running service
separately. The connection minimum remains 2.0.7.

The 2.0.32 packages add one operation, the experimental `voice.session` route, which
Palot's voice chat uses. Voice is offered only on services reporting 2.0.32 or later; the
connection minimum remains 2.0.7. The route starts GPT-Live with an OpenAI API key stored
on the OpenCode server (or `OPENAI_API_KEY`); ChatGPT sign-in can't start voice sessions.

The 2.0.30 and 2.0.31 packages keep the operation inventory unchanged. Model
capabilities add optional temperature support, and model configuration accepts
reasoning controls and a release-date override. Palot preserves temperature support
and labels models that explicitly reject it as **Fixed temperature**; an absent
value stays unknown. Reasoning variants and release dates use the existing catalog
mapping. The retired `session.share` TUI command is no longer suggested. The
connection minimum remains 2.0.7. Instruction loading, managed-service environment,
MCP timeout and provider fixes require updating the running service separately.

The 2.1.0 packages make small breaking renames to message and event data. Provider
replay data is now always `native`: text and reasoning parts (was `state`), assistant,
tool and compaction messages (was `providerState`), and step, tool and compaction
events (was `state`, `providerState` or `resultState`). A tool's call and result data
share one shallow-merged `native`; Palot merges result events into it, result keys
winning. Summary compactions no longer store `recent`; they reference the first kept
message with `metadata.keepID`. Context history and older compactions carry the kept
text in `metadata.recent`, which Palot shows when present. Compactions without it
show only the summary, because the kept messages are already in the transcript.
`Credential.Key.configuration` moved into `metadata` and the unused `session.compacted`
event was removed; Palot used neither.

The 2.1.0 contract adds `permission.saved.update` and restores session archiving:
`session.update` accepts `archived`, `session.list` accepts an `archived` filter, and
the durable `session.archived` and `session.unarchived` events set and clear
`time.archived`. Palot projects those events onto cached sessions, but does not yet
archive sessions or edit saved permissions. Plugins gain `session.list`, which the
voice coordinator does not use yet.

The 2.1.1 and 2.1.2 packages keep the operation and event inventory unchanged. Session
errors gain an optional `retryAfterMs` (how long the provider asked to wait), and
configuration accepts `experimental.location_idle_timeout`; Palot uses neither yet.
Service fixes, such as keeping locations with running sessions loaded, require
updating the running service separately.

The 2.1.3 packages add two experimental voice operations: `voice.models` lists the
voice models, their transports and whether the server can start each one (including
models a connected OpenCode Console hosts), and `voice.instructions` replaces a hosted
session's instructions. Agent configuration ignores unsupported colors instead of
dropping the agent. Palot does not use the new voice operations yet.

The 2.1.4 packages add `debug.heapDump`, which Palot's heap snapshot capture uses, and the
experimental client-hosted MCP endpoint (`mcp.client`, `mcp.clientToken` and the
`@opencode/client/mcp` helper). Palot's main process uses that endpoint to serve its agent
tools as the `palot` MCP server, with the connection's own credentials. OpenCode scopes each
attachment to one location, so Palot attaches only where tasks need the tools: directories a
window shows, and directories with a running task (kept for 15 minutes after the turn ends).
Against servers older than 2.1.4, or when "Palot tools for agents" is off in Settings, Palot
does not attach the tools. Development (unpacked) builds default to off: OpenCode serves the
most recently attached `palot` server, so two Palot builds on one server would compete. Location-wide MCP
elicitation forms (`sessionID: "global"`) appear in Palot's request dock.

The 2.2.0 packages move `generate.text` to `/api/experimental/generate/text` and keep the
original `/api/experimental/generate` as `generate.textLegacy`, which the client does not
expose. Palot retries the original address when the new one returns 404, so older servers
still generate commit messages and review guides. 2.2.0 removes `voice.instructions`, which
Palot never used, and adds `usage.limits`, `fs.watch`/`fs.unwatch`, `media.get` (opt-in
server-stored attachments), image and decision generation, and `plugin.gui` for OpenCode
Desktop's Solid GUI plugins, which Palot does not host. `experimental.background_compaction`
is a config option only; OpenCode's config API writes just the shell, so Palot cannot set it.

OpenCode checks each tool call against the permission action `palot_<tool>`. Like ChatGPT's
app tools, Palot's tools follow the task's approvals. Full access (`*: allow`) allows them all.
Defaults adds rules that allow reading and organizing tasks and ask for `palot_schedule_task`,
`palot_update_automation` and `palot_delete_automation`. "Always allow for this project" saves
OpenCode's own project rule, which applies after session rules. With "Ask before agents
schedule tasks" off, Palot approves those prompts itself, including for tasks created before
the setting changed and Full access tasks that still carry older ask rules. In a Defaults task
with asking on and no saved rule, the tool handler fails closed: when the task's own rules would
not make OpenCode ask, it adds the ask rules and has the model retry.

Agents organize tasks with `settle_task`, `snooze_task`, `pin_task` and `archive_task`,
named after the verbs because Code Mode's `search` ranks tool paths far above descriptions;
renaming uses OpenCode's own `session_rename`. Settling records the task's latest activity,
and a running turn's end is newer activity, so a task settling itself mid-turn would return
at once. Like T3 Code, `settle_task` on the caller's own running task waits for
`session.execution.succeeded` and then settles through the later of the family's activity
and that event's time; a failed or interrupted turn, or moving the task back to the Inbox
first, cancels it. The wait is in memory and ends when the tools detach. Settling another
task that is running or waiting on a request is refused with `task_busy`.

Against a 2.0.x service, Palot reads the renamed fields as absent: reasoning
presentation hints, provider-structured web search results and compaction `recent`
text are not shown. Copying a task from a 2.0.x server to a 2.1 server can fail
transcript verification after an otherwise successful import, because the
destination returns the renamed fields. The connection minimum remains 2.0.7.

### One-time pairing and OpenTunnel

Palot accepts one-time links and OpenCode's `{ code, urls }` QR payloads. Import
previews the advertised addresses, prefers HTTPS, and lets you choose the address
that receives the code. It redeems only that address, without automatic retries
against other hosts. Non-loopback plain HTTP still requires explicit consent.
Exported one-time QR codes include the service's reachable addresses, excluding
loopback addresses that would point to the scanning device itself.

An active OpenTunnel address is used when OpenCode advertises it. OpenCode has no
published tunnel-management API, so Palot does not provision a separate tunnel.
Starting with 2.0.25, `opencode pair --remote` enables remote access through the official CLI.
That action exposes the service through OpenTunnel and can restart the shared
service. Run it only when intended, then generate fresh pairing details in Palot.

## Project-free chats

OpenCode has no session without a directory, and every directory resolves to a
project (a non-VCS folder becomes a directory project). Palot's chats therefore
each get their own folder, `<default>/.palot/chats/<date>-<slug>-<id>`, where
`<default>` is the folder `location.get` returns without a location: the server's
working directory, which is the home folder for Palot's local service. Palot
creates the folder by writing a `.palot-chat` marker with `file.write`, which
creates parent directories on local and remote servers, then calls
`session.create` there. Both operations exist since 2.0.7.

OpenCode resolves a folder to the nearest enclosing `.git` or `.hg`, so a chat folder
inside a repository would join that repository's project. Palot therefore refuses
to start chats when the default folder is inside a repository or is one (its
`location.get` project is rooted elsewhere, or that project has a VCS), as T3
Code does for its scratch folders. Desktop E2E runs live inside the checkout, so
the `project-free-chat` scenario sets `homeOutsideCheckout`, which links the
isolated home to a temporary folder outside it.

Palot recognizes chats by that path alone. It shows their sessions as chats and
removes their directory projects from project lists and pickers, and the tray labels them "Chat".
"Move to project…" uses `session.move`, after which the session is an ordinary
task in that project. Archiving or moving a chat leaves its folder on the server.

## Experimental browser

The browser is off by default and requires the browser plugin on the connected
service. A compatible OpenCode connection alone does not guarantee browser
availability. Palot attaches through the published plugin contract; it does not
start a separate service or silently fall back to desktop-direct networking.

HTTP(S) browser traffic, including localhost and private-network requests, uses
the connected server. Browser tool permission is broad, without per-site approval.
Saved tab inventory remains on the desktop after disabling or detaching the
browser; clearing task browser data is a separate action. Read the
[privacy and retention details](../PRIVACY.md#experimental-browser) before enabling it.
The [native browser scenarios](desktop-testing.md#browser-scenarios) describe
scenario assertions and remaining packaging/transport limits.

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
