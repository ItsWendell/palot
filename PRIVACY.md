# Privacy

This policy describes the Palot 0.22.0 source. It may change as pre-release
features evolve.

## Data sent by Palot

Palot does not currently include usage analytics, crash reporting, advertising,
or telemetry that sends data to Palot maintainers.

Palot connects to the OpenCode service you select. Prompts, attachments,
repository context, model requests, tool activity, and related session data may
pass through that service and the model providers, plugins, MCP servers, or
other integrations you configure. Their privacy terms and retention policies
are separate from Palot's.

Remote OpenCode servers can expose the same data to the operator of that
server. Do not connect to a remote server unless you trust its operator and
transport setup.

Checking for an OpenCode runtime release is a user action in setup or connection
settings. It contacts OpenCode's official update service at `opencode.ai` with
the selected Stable or Beta channel. Preparing a release downloads its binary
from the same official host. These requests expose normal network metadata,
including your IP address and request headers, to OpenCode's operator. They do
not include prompts, project paths, credentials, or session contents. Opening
Palot or changing the preferred channel does not itself check for releases.

When you confirm an update to a user-installed OpenCode executable, Palot invokes
that executable's official upgrade command with the selected version and method.
OpenCode and the package manager or official installer contact their own update
servers/registries according to their policies. Palot does not silently run this
command during installation discovery or restart the shared service afterward.

## Experimental browser

The task browser is off by default. Enabling it lets the OpenCode browser tool
inspect and interact with pages. HTTP(S) page traffic goes through the connected
OpenCode server, including requests to localhost and private networks. Localhost
refers to that server's machine, not necessarily the computer running Palot.
The server operator and visited sites can observe the traffic they handle.
Browser-tool results and exported captures or downloads can also reach OpenCode
and the model providers or integrations used by the task.

Element comments capture the selected element's description, page URL and a page
preview. The preview can include content outside the selected element. Attached
comment drafts and previews are saved locally with the task's composer. Sending
them adds that context to the OpenCode prompt and, for image-capable models, sends
the preview as an attachment. Clearing browser data does not remove pending
composer comments or comments already sent; remove those drafts separately.

Browser permission is broad. Palot does not provide per-site approval or a
separate sensitive-action confirmation boundary. Do not enable it for a server,
task or browsing session you don't trust.

Pages in the browser can't use your microphone or camera until you allow it in the
prompt Palot shows above the page; pages and agents cannot answer that prompt.
Palot remembers your answer for that site until you reset it from the address bar
or the task's browser closes. Screen capture, location, notifications and USB or
other devices stay refused.

Tab IDs, URLs and the selected tab are saved locally by connection profile and
task so pages can be restored. Saved URLs can contain sensitive query parameters;
they are not stored in the encrypted credential vault. Cookies and site storage
use a separate in-memory Chromium partition for each task attachment, shared by
its tabs and managed popups. They do not use the app renderer's partition or your
external browser's profile. Captures and downloads use owner-only temporary
directories on the computer running Palot.

Disabling the browser or detaching a task closes its pages but retains the saved
tab inventory. It is not a browser-data reset. Switching to another task can
leave the previous task's browser attached in the background. **Settings → Browser
→ Clear task browser data** closes that task's pages, removes saved tab URLs and
temporary browser files, and clears its site storage and cache. Close that task's
browser in other Palot windows before clearing. This does not remove other tasks'
data or files already exported to the OpenCode server. Interrupted cleanup or an
app crash can leave temporary files behind; review local app and temporary data
before disposing of a machine or sharing it.

## Agent tools

With an OpenCode 2.1.4 or later server, Palot gives tasks tools to schedule work, list and
read other tasks, wait for them, and pin, settle, snooze or archive them. Palot's main
process serves these tools to the connected server over its existing connection. When a task
reads another task, that task's title, status and recent messages enter the reading task's
conversation, so they reach its model provider like any other context. Scheduling, changing or
deleting a scheduled task asks you first in tasks with Defaults approvals, unless you chose to
always allow it; Full access tasks do not ask.

## Guest links (beta)

Guest links are off by default. Enabling the setting alone does not open a
listener or publish anything. Creating a link starts an HTTP server on a random
`127.0.0.1` port. Anyone holding that link can see the selected task's title,
recent user and assistant text, simple tool-name/status rows, and live updates.
Attachments, reasoning, tool inputs/output, other tasks, and workspace files are
not exposed. Text already in a message can still contain private code or secrets.

Guest names are self-reported, not verified. Submitted names, messages, and
receipt statuses stay in memory until you end the share or quit Palot. Only
**Send** forwards a guest message, prefixed with its name, through OpenCode to
the task's model and integrations like any normal prompt. A guest's private
submission receipt reveals only that submission's approval status. Shares and
pending messages are not restored after restart; the beta setting is saved locally.

Publishing is a separate, explicit action. Tailscale Serve uses HTTPS port 8443
and makes the link reachable to allowed tailnet devices. OpenTunnel makes it
reachable from the public internet through its relay, using the dedicated
`palot-guests` CLI profile. These providers handle network metadata according to
their own policies. OpenTunnel terminates TLS locally; its relay forwards encrypted
traffic. The CLI may create a persistent identity and login service. Palot removes
its guest route when the last share ends, but does not delete that identity or
stop a shared CLI service. A crash or failed route cleanup can leave proxy
configuration behind; check the provider CLI before reusing it.

The URL is a bearer credential. Browser history, copied links, QR codes, proxy
logs, and recipients can retain it. No Palot account is needed, and guests can
copy anything they see. Expiry, **Stop sharing**, disabling the beta, archiving
or deleting the task, and quitting Palot end access, but cannot erase copies
already made by guests or providers.

## Event-triggered scheduled tasks

Event triggers are opt-in per task in Scheduled. GitHub triggers reuse the existing
outbound polling of linked or watched PRs, including CI checks and other people's
reviews/comments. Repository and head-branch filters limit which links match.
Selected payload fields enter the task's prompt and reach OpenCode and its model
provider, just like a time-triggered run. There is no inbound GitHub webhook.

Creating an active local-webhook task opens an HTTP listener on **127.0.0.1 only**,
on a random port while Palot is open. The port changes after restart. Each task
has its own random secret URL, stored in owner-only automation files and the local
database, not the encrypted credential vault. Anyone who has that URL and local
access can trigger model work and its costs. Keep it private; delete the task to
revoke it. Pausing every webhook task closes the listener. Browser-origin requests
are refused. Requests must POST a JSON object, capped at 32 KiB, with global and
per-task rate limits. No remote tunnel or public listener is created.

Webhook payloads and PR event cursors are saved in owner-only local automation
state. A busy/offline task retains only its latest pending event. Payload values
referenced as `{{payload.field}}` are quoted and length-limited, but remain untrusted
content: do not template secrets or instructions from an untrusted sender. Run
prompts and substituted values remain in OpenCode's transcript and Palot's run
snapshot. Webhook request headers and secret URLs are not included in prompts or
logged by the listener. Idempotency keys are stored only as hashes.

## Voice chat

Voice chat (Beta) starts only when you start a call. Palot then asks the connected
OpenCode server to create a GPT-Live session with the OpenAI API key stored on that
server, and streams your microphone audio from this computer to OpenAI over WebRTC
for the rest of the call. OpenAI receives the audio and produces its transcript and
spoken replies. Requests you make by voice are sent to the task like typed prompts,
so they also reach OpenCode and the model providers or integrations the task uses.

The call transcript is kept in memory for the current call and is not saved. Voice
settings, such as the voice, microphone and greeting, are saved locally. The
optional system-wide shortcut starts or ends a call from any app. No audio is
captured while no call is active.

## Slack links

When you open a Slack archive link without a workspace ID, Palot reads the Slack
desktop app's local workspace list (`Slack/storage/root-state.json` in the system
application-data folder) to find the workspace for that link. It reads only that
public workspace directory, never Slack's sign-in or session data, keeps no copy,
and sends nothing to a server. The link then opens in Slack or your browser.

## Spelling

Chromium checks spelling in Palot's text fields on this computer. It does not send
what you type or the words it checks to any service. On macOS, Palot uses the system
spellchecker and downloads no dictionaries.

On Linux and Windows, Chromium uses Hunspell dictionaries. Palot does not set its own
dictionary server, so the first time Chromium needs a language's dictionary, it
downloads it from Google (`redirector.gvt1.com`). That request reveals the language
and normal network metadata, such as your IP address. Downloaded dictionaries stay in
Palot's app data folder for later launches. Palot checks your system's preferred
languages, plus US English when none of them is English. **Settings → General →
Spelling languages** changes that list, and **Check spelling** turns checking off.
While it is off, Palot clears the list, so Chromium downloads no dictionaries for
Palot's windows.

**Add to Dictionary** saves the word in Palot's app data. On macOS and Windows, the
operating system's custom dictionary gets it too. Turning off Check spelling doesn't
delete downloaded dictionaries or added words. Pages in the task browser use their
own sessions with Chromium's defaults: your system language, unaffected by these
settings, and fetched the same way when its dictionary isn't already on disk.

## Source control

Palot's desktop process contacts GitHub, GitLab, configured Forgejo/Gitea hosts,
or Bitbucket Cloud directly, including for tasks on remote OpenCode servers.
GitHub tokens still come from `GH_TOKEN`, `GITHUB_TOKEN` or `gh auth token`, and
requests go only to `github.com` or `GH_HOST`.

For other hosts, Settings → Source control saves tokens using the same encrypted
credential vault as connection credentials. Saving is refused when secure storage
is unavailable. Only the host URL, provider type and vault reference go into normal
settings storage; saved tokens are never returned to the interface. Removing a
saved host deletes its saved token, but does not revoke it at the provider or
remove environment variables or CLI sign-ins. Palot can also read `GITLAB_TOKEN`
or `GL_TOKEN`, `FORGEJO_TOKEN` or `GITEA_TOKEN`, and `BITBUCKET_TOKEN`. These are
scoped to their configured host, never tried against arbitrary Git remotes.
GitLab can use `glab auth token --hostname` for a known GitLab host.

Host requests use HTTPS, do not follow redirects, and send the token only to the
configured API origin (Bitbucket Cloud uses `api.bitbucket.org`). Adding a host
trusts that server with its token and repository requests. Host tokens are not
sent to OpenCode or model providers. See [Source control](docs/source-control.md)
for supported operations, environment host selection and required permissions.

While a pull request is linked to a task, Palot reads its status from its host in
the background (open pull requests about once a minute). The Pull requests screen
reads lists, details, checks, comments and changed files when you open them.
Merging, reviewing, commenting, requesting reviewers, closing or reopening, and
marking files viewed happen only when you choose them. Watching a pull request
lets Palot queue a prompt into that task when checks fail or pass, someone
comments or reviews, or the branch conflicts; that prompt goes through OpenCode
to the task's model like any other message. The code host's terms apply to these
requests.

Avatar images load from `avatars.githubusercontent.com`, which exposes normal
network metadata such as your IP address to GitHub.

Writing a review guide sends the pull request's title, description, branch names,
and changed-file patches (within a size limit) through OpenCode to the model you
choose for the guide. The finished guide
is stored in Palot's local app storage on this device.

Generating a commit message sends the staged files' changes through OpenCode to
the task's model. Committing and pushing run your local `git` with your own Git
configuration and credentials. For remote tasks, Git runs on the selected
OpenCode server through its public shell API, over the existing HTTP connection
or SSH tunnel. It does not create agent transcript messages. Paths, Git arguments,
commit messages and command output reach that server, which uses its own Git
configuration, hooks and credentials. Palot does not forward desktop code-host
tokens to remote Git. Use only servers and repositories you trust: commits can
run repository hooks, and pushes/fetches contact the configured Git remotes.

Remote commands use private temporary output files, bounded execution times and
bounded response reads. Palot asks OpenCode to remove the shell record and output
after each command and removes its temporary files on normal exit. Interrupted
connections or crashes can leave server-side artifacts; the server operator's
logging and retention policies still apply. Remote Git needs OpenCode 2.2's shell
API and POSIX tools. Palot never falls back to running remote paths on this device.

Generating a pull request draft sends the committed branch diff, commit subjects,
and recent task context through OpenCode to the task's model. Creating the pull
request sends the title, description, base/head branches and draft choice to
the selected code host, then links it locally. Palot also recognizes supported
PR/MR URLs in settled tool and shell output, verifies the repository and branch with the host, and links
them to the task if it has no PR link yet. Fetch, pull, sync and push use your
selected server's Git configuration and credentials; sync pulls before pushing. Divergent
pulls require an explicit rebase or merge choice, and default-branch pushes ask
for confirmation.

Editing a pull request sends its title and description to its host. Supported label,
auto-merge and branch-update actions contact that host only when you choose them.
Enabling auto-merge can merge immediately if the host's requirements already pass.
Branch creation, switching and renaming use the selected connection's Git without discarding or
stashing uncommitted changes. Naming a new worktree branch is optional.

Automatic worktree retirement is off by default, configured on Worktrees. When
enabled, Palot checks the current local connection's projects about once a minute
while its workspace is open, including refreshing linked PRs from GitHub. Run
cleanup now performs the same checks on demand. Retirement removes only managed
worktrees with merged PRs, no running tasks, no uncommitted changes and a HEAD
matching the merged PR; it never forces removal or removes the main checkout.
Task histories and branches remain. A local log retains the last 100 automatic
or on-demand retirements, including directory, PR URL and time.

Agent tools can link and watch pull requests. The create-pull-request tool asks
for approval under Defaults, independently of the scheduling approval setting;
Full access tasks do not ask. Creating a PR never pushes a branch implicitly.

## Data stored on the device

`/btw` side questions send the current conversation context through OpenCode for
a transient answer, without adding a normal conversation turn or running tools.
Their questions and answers are saved locally in task-scoped workbench tabs until
you close them. Closing a tab removes it from the saved workbench and cancels a
pending request, but does not delete provider records or service logs.

Depending on the features used, Palot stores local settings, window and
appearance preferences, OpenCode connection profiles, encrypted connection
credentials, app logs, diagnostics history, automation definitions and runs,
and a local SQLite database for Palot-owned state.

Linked pull requests, their last known status, and watch state are stored in
that local database until you unlink them. Notification sound choices and edited
keyboard shortcuts are local preferences. Project scripts are stored in the
local database and run on this device, with your user account, in the task's
directory after the task settles. Palot's app log records each run's script name,
task, directory, and result; the script's output is shown in the result notice
and is not saved. Draft review comments stay in memory
until you submit the review or quit Palot.

Runtime release preferences and explicitly downloaded OpenCode executables are
stored in Palot's application data directory. Resetting the prepared runtime
clears the active downloaded selection; cached files can remain on disk. This
does not uninstall or change a separate global OpenCode installation.

Connection credentials use Electron's operating-system-backed secure storage
when it is available. Palot refuses to save them when secure storage is not
available.

Starting a chat without a project creates a folder for it under `.palot/chats`
in the OpenCode server's default folder (your home folder for a local server),
so the agent has somewhere to work. The folder holds a small `.palot-chat` marker
and any files the agent writes there. Palot does not delete these folders when you
archive a chat or move it into a project; remove them yourself if you no longer
need them.

Pasted clipboard images are written to a Palot directory under the operating
system's temporary directory before they are sent as attachments. Palot uses
private directory and file permissions, removes the current process's staged
images at shutdown, and removes stale staging entries after 24 hours. Log
retention remains pre-release work.

OpenCode remains the source of truth for its projects, sessions, messages,
configuration, authentication, and model-provider activity. Removing Palot
does not remove data owned by OpenCode or a provider.

## Diagnostics and bug reports

Diagnostics are generated locally. Copying or attaching a report is a user
action. Review reports and screenshots before sharing them because logs and
diagnostics may reveal paths, project names, server URLs, operational details,
or rendered content.

## Deletion and retention

Palot provides recovery actions to reset settings or remove Palot-owned data.
It does not yet provide a qualified uninstall cleanup flow, and retention rules
for every log and diagnostic artifact remain pre-release work. Before deleting
local app data, make sure you understand which state belongs to Palot and which
belongs to OpenCode.

Report privacy bugs through
[GitHub Issues](https://github.com/ItsWendell/palot/issues). If a privacy bug
could expose sensitive data or credentials, use a private
[GitHub Security Advisory](https://github.com/ItsWendell/palot/security/advisories/new)
instead.
