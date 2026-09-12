# Privacy

This policy describes the current source version of Palot. It may change before
a public binary release.

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

## Data stored on the device

Depending on the features used, Palot stores local settings, window and
appearance preferences, OpenCode connection profiles, encrypted connection
credentials, app logs, diagnostics history, automation definitions and runs,
and a local SQLite database for Palot-owned state.

Runtime release preferences and explicitly downloaded OpenCode executables are
stored in Palot's application data directory. Selecting the bundled runtime
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
