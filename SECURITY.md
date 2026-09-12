# Security policy

Palot is pre-release software and does not currently publish supported binary
releases. Security fixes target the current `main` branch. Older commits and
locally built packages may not receive fixes.

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

## Current distribution status

Developer ID signing and Apple notarization are not currently offered. Local
macOS builds can be ad-hoc signed or signed with a local development certificate;
neither establishes Palot publisher identity or Apple notarization. Do not treat
a locally produced app, ZIP file, or disk image as an official verified release.
