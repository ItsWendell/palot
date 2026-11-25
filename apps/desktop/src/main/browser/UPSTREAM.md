# Adapted OpenCode browser host

Source: [OpenCode](https://github.com/anomalyco/opencode) desktop app, tag `v2.0.14`,
`packages/desktop/src/main/`. MIT, Copyright (c) 2025 opencode. Each adapted file keeps a header
naming its source file at that tag.

Adapted files:

| Palot (`apps/desktop/src/main/`) | OpenCode v2.0.14 (`packages/desktop/src/main/`) | Kind    |
| -------------------------------- | ----------------------------------------------- | ------- |
| `browser-chromium.ts`            | `browser-chromium.ts`                           | Derived |
| `browser-pane.ts`                | `browser-pane.ts`                               | Adapted |
| `browser/analysis.ts`            | `browser/analysis.ts`                           | Derived |
| `browser/cdp.ts`                 | `browser/cdp.ts`                                | Derived |
| `browser/diagnostics.ts`         | `browser/diagnostics.ts`                        | Derived |
| `browser/errors.ts`              | `browser/errors.ts`                             | Derived |
| `browser/files.ts`               | `browser/files.ts`                              | Derived |
| `browser/lighthouse.ts`          | `browser/lighthouse.ts`                         | Derived |
| `browser/network.ts`             | `browser/network.ts`                            | Derived |
| `browser/policy.ts`              | `browser/policy.ts`                             | Derived |
| `browser/profiling.ts`           | `browser/profiling.ts`                          | Derived |
| `browser/restore.ts`             | `browser/restore.ts`                            | Adapted |

The other files in `browser/` (`artifact-access`, `input`, `permissions`, `popup-surface`,
`surface`, `tab-shortcuts`, `webview-host`) are Palot's own.

## Where the code lives upstream now

On OpenCode `dev` (packages at 2.2.7, checked 2026-11-10) the browser host is no longer under
`packages/desktop/src/main/`. It moved to `packages/gui-plugins/src/browser/` and was restructured
around state machines (`pane-machine.ts`, `page-machine.ts`, `main-machine.ts` and others). The
files above still have namesakes there (`chromium.ts`, `pane.ts`, `cdp.ts`, `network.ts`, ...),
but they are not drop-in replacements. Palot has not ported any change made after v2.0.14.

## Deliberate differences

Palot's host renders pages in a renderer-owned `<webview>`, not OpenCode's native
`WebContentsView`; see "Webview host" in `docs/opencode-feature-plan.md`. Main still owns
credentials, CDP, the private session partition and the server-network proxy, issues one-use
window and tab leases, and strips guest preloads.

## Wire contract

The only contract shared with upstream is the `@opencode/plugin-browser` RPC (`/rpc`, `/proxy`).
`browser-pane.ts` attaches with protocol `version: 4`, which the plugin's `rpc.ts` declares as a
literal. A new RPC version is what forces a port; a refactor of upstream's host does not.

## Updating

Compare the files above with their namesakes in `packages/gui-plugins/src/browser/` at an explicit
OpenCode revision and port fixes that apply to a `<webview>` host. Keep the MIT headers and update
this record with the revision you compared.
