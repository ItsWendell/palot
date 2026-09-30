# Security policy

Palot 0.15.0 is pre-release software. Public packages are experimental, not
supported stable releases. Security fixes target the current `main` branch.
Older commits and locally built packages may not receive fixes.

## Report a vulnerability

Report vulnerabilities privately through
[GitHub Security Advisories](https://github.com/ItsWendell/palot/security/advisories/new).
Do not open a public issue for a suspected vulnerability.

Include the affected commit or version, operating system version and architecture,
OpenCode version, reproduction steps, impact, and a minimal proof of concept if
one is safe to share. Remove prompts, credentials, private source, repository
paths, tokens, and unrelated logs.

There is no guaranteed response or remediation timeline while the project is
pre-release. Please allow time for the report to be reproduced and assessed
before public disclosure.

## Security boundaries

Palot is a desktop client, not a sandbox for model output or developer tools.
OpenCode, model providers, plugins, MCP servers, shell commands, and tools may
read or change files and access networks according to their own configuration
and the permissions you approve.

The Electron renderer is sandboxed and context isolated, with privileged work
owned by the main process. These controls reduce renderer risk but do not make
an opened repository, OpenCode server, model provider, plugin, or tool trusted.

Treat remote OpenCode server URLs and credentials as sensitive. Only connect to
servers you trust, and review permission requests before allowing file, shell,
network, or Git operations.

### Experimental browser

The task browser is off by default and requires the connected OpenCode server's
browser plugin. Enabling it gives the browser tool access to sites reachable
from that server, including localhost and private networks. HTTP(S) page traffic
is tunneled through the server; a remote task's localhost is not this desktop.
There is no per-site approval or separate sensitive-action confirmation boundary.
Treat enabling browser access as a broad permission, not approval of one URL.

Browser pages and managed popups are sandboxed and context isolated, without
Node integration or the app's privileged preload bridge. Each task attachment
uses a separate in-memory Chromium partition for cookies and site storage.
These controls do not make page content trustworthy or prevent the agent from
interacting with accounts signed in within that task's browser.

Saved tab URLs and inventory persist locally after disabling or detaching the
browser. Captures and downloads use local temporary storage. Use **Clear task
browser data** in Browser settings to close its pages, remove saved inventory and
temporary files, and clear site storage and cache. This does not revoke server
credentials or delete files already exported to the server. See
[browser privacy and retention](PRIVACY.md#experimental-browser).

## Current distribution status

Developer ID signing and Apple notarization are not currently offered. Local
macOS builds can be ad-hoc signed or signed with a local development certificate;
neither establishes Palot publisher identity or Apple notarization. Do not treat
a locally produced app, ZIP file, or disk image as an official verified release.
