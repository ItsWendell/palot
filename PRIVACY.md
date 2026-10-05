# Privacy

This policy describes the Palot 0.16.0 source. It may change as pre-release
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

Runtime release preferences and explicitly downloaded OpenCode executables are
stored in Palot's application data directory. Resetting the prepared runtime
clears the active downloaded selection; cached files can remain on disk. This
does not uninstall or change a separate global OpenCode installation.

Connection credentials use Electron's operating-system-backed secure storage
when it is available. Palot refuses to save them when secure storage is not
available.

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
