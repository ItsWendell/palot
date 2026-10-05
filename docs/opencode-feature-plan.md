# OpenCode 2 feature plan for Palot

This plan compares Palot with the published OpenCode 2 desktop app, then builds the missing workflows in Palot's existing architecture. It does not treat a release-channel label as a feature set. On 2026-09-22, Palot targets Stable 2.0.14; the npm Beta (`0.0.0-beta-19507`) and the official Beta CLI feed (2.0.1) both lag it. Keep the client and service on the supported Stable release. Recheck the published versions and source before starting a later stage.

## Implementation checkpoint (2026-09-22)

- **Shipped in this workspace, not released:** incompatible Beta offers are suppressed; workspace tabs preview bounded UTF-8 text, safe Markdown, raster images, PDF canvas, and native audio/video; a Files tab browses and searches via the OpenCode file API; completed turns open a separate `session.diff` view; Changes and focused file diffs support same-side line comments that can be edited, removed, and sent as explicit prompt context. The existing Git Changes workflow remains distinct from turn changes.
- **Verified:** desktop typecheck, focused tests, lint, formatting, and OpenCode 2.0.14 contract coverage passed. Isolated native `workspace-preview` and `review-comments` scenarios passed against a real local service, including a nonempty turn diff and persisted review-comment metadata. The larger `streaming-patch` scenario stopped at its pre-existing offscreen “Follow changes” click before its final assertions; it is not the evidence for this turn-diff feature. On the current Node 26 host, Vitest needs `NODE_OPTIONS=--no-experimental-webstorage` so Happy DOM owns `localStorage`.
- **Browser checkpoint:** the opt-in, session-scoped native host now attaches to the 2.0.14 plugin through RPC v4. An isolated native `browser-native` scenario used the real agent browser tool to navigate a localhost fixture through the server proxy, read a snapshot, show the tab in the workbench, reject a file URL outside the workspace, and detach/reattach with its tab URL restored after switching the setting. This proves the local vertical slice, not full desktop parity. SSH/HTTP transport, service reconnect, concurrent windows, profiling teardown, and packaged Lighthouse still need dedicated checks. Saved tab URLs currently remain when the Experimental Browser setting is turned off; upstream's explicit close removes its restore state, so this privacy/control difference needs a separate clear-data action. The browser opt-in gives the agent broad access to sites reachable from the connected server; there is no per-site approval.
- **Still open:** CSV/TSV table, isolated SVG/Mermaid/font views, temporary preview-tab reuse, cross-side comment selections, `/btw`, and server-backed full-history search are not implemented. The preview caps apply after the official whole-file `file.read` response arrives. Native preview/review scenarios cover a local service, not remote SSH/HTTP behavior. Browser dependency notices have reviewed evidence for 13 additional packages, but the full license inventory is still incomplete and packaging is not release-verified.

## Boundaries

- OpenCode owns sessions, messages, file reads, diffs, tool execution, permissions, and browser-tool registration. Palot owns its desktop presentation, tab state, native host, and connection lifecycle. Use the published client/plugin contracts rather than copying a parallel protocol.
- A feature is not done when it merely renders in a mocked browser. Verify local and remote behavior where supported, native Electron security boundaries, loading/error/cancellation states, and a focused isolated E2E scenario.
- Existing worktree, terminal, provider, request, and Changes workflows already exist. Improve specific gaps rather than replacing those surfaces for visual parity.
- Preserve uncommitted workspace changes. This plan does not authorize replacing the shared service, publishing, or installing a channel release.

## Delivery order

### 0. Release-channel truthfulness

Do not display a Beta offer as a usable upgrade if it is below Palot's supported runtime floor. Explain that the selected channel has no compatible release and leave the current runtime untouched. Keep the lower-version rejection in the release manager, not just disabled UI. Test an incompatible Beta response, a compatible future Beta, Stable, and channel switching during a check. This is a small independent fix, not an excuse to downgrade the service.

### 1. Workspace-file previews

**First slice:** keep the current file tab and `file.read` transport. Classify the returned bytes and show raster images and PDFs, with a bounded byte budget, clear unknown-binary/too-large states, and object URL cleanup. Render Markdown with the existing safe Markdown renderer, with a source/preview switch. Keep the code viewer for normal text and existing line navigation. Prove all of this in an isolated native desktop scenario using fixture files. Test remote connections through the same OpenCode file API rather than reading a local path from Electron.

For PDF, use a same-origin PDF.js worker and a bounded canvas renderer. Palot's renderer CSP blocks frames, and enabling Electron's PDF plugin would expand the trusted renderer's plugin surface. Keep `frame-src 'none'`; a sandboxed iframe test alone is not evidence of a working PDF preview.

The published `file.read` API returns a whole `Uint8Array` with no ranged-read or length-probe parameter. A renderer preview budget limits decoding and retained blobs, **not** the response bytes already downloaded by the client. Don't claim streaming or pre-download protection until the official API supports it or a separately reviewed bounded transport exists.

Workbench tabs remain mounted when hidden. Unmount heavy preview viewers while inactive so PDF workers, canvases, playback, and object URLs are released on a tab switch. The file-query cache can still retain returned bytes, so measure aggregate memory with several open media tabs before raising the per-file limits.

**Follow-on formats:** audio/video with native playback controls and cleanup; CSV/TSV with an accessible bounded table; SVG and Mermaid only through an isolated, non-scriptable rendering policy; fonts only if there is a useful inspection view. Untrusted HTML must not execute in the app's renderer. Decide whether an isolated browser-host preview is warranted after the browser security review. For each format, validate large-file behavior, mime/extension mismatch, missing files, refresh, and switching/closing tabs.

**Navigation:** add a workspace file-browser/search tab reusing the existing `file.list`/`file.find` APIs. Temporary preview tabs and pinning should work with the current workbench state. Agent-linked workspace paths should open the same tab, scoped to the owning connection and location. Do not use a local filesystem shortcut for SSH or HTTP profiles.

### 2. Browser host and agent tools

This is its own project, not a new generic `webview`. The published 2.0.14 `@opencode/plugin-browser/rpc` contract and OpenCode desktop's attachment lifecycle are the reference for Palot's service and Electron boundaries. Surface any missing public API before inventing a custom wire format.

1. **Accepted product policy:** match the published OpenCode 2.0.14 desktop behavior, including local and remote service support, off-by-default Experimental Browser opt-in, session-owned private Chromium partitions, blanket `browser` tool permission, explicit tab IDs, HTTP(S)/`about:blank` navigation, denied page permissions, bounded file transfer and server-network tunneling. Do not claim per-URL or server-file approval: upstream explicitly does not enforce those finer permissions yet. Palot's UI must show that limitation clearly. Keep the host detached until enabled; a disabled view must not supply a browser to the agent.
2. **Contract proof:** pin `@opencode/plugin-browser` to the same release as the client and resolve its Effect peer/runtime version with the published `@opencode/client/effect` path. The bundled server plugin uses `experimental.browser` RPC version 4. In Electron main, subscribe to its control event before the long-lived `attach`, wait for the matching `attached` event (not the attach return value), publish acknowledged empty tab state, and answer `tabs.list`. Keep credentials and raw RPC out of preload. Handle `closed`, `replaced`, window teardown and connection disposal without replaying an uncertain command.
3. **Local vertical slice:** attach one local service to a Palot-owned isolated `<webview>`, open a tab, navigate, observe a snapshot, and present the tab in the session's workbench. Focus and every tool call must target an explicit tab and owning session. Use the upstream authenticated proxy and RPC tunnel for the page's network, even on the first visible local slice; never silently fall back to the desktop's direct network. A permission denial or missing plugin gets a usable error, not a silent generic tool result.
4. **Hardening:** navigation and form/input, screenshots and file preview, cancellation, browser crash and reconnect, tab restoration, concurrent sessions/windows, file transfer and network diagnostics. Test SSH/HTTP through the same authenticated proxy with a separate remote-service fixture; no desktop-direct network fallback. Do not silently treat a visible browser tab as permission to run agent tools. A remote page's `localhost` is the server machine, not Palot's desktop; server-local capture/upload paths likewise need explicit handling.

Native E2E should run the real plugin/host connection against an isolated service, prove session and tab ownership, then assert detach/reconnect and a denied unsafe action. Mock-only RPC coverage is insufficient.

### Codex desktop reference (checked 2026-09-22)

The [official Linux latest package](https://persistent.oaistatic.com/codex-app-prod/linux/deb/latest/chatgpt_amd64.deb) was `chatgpt` 26.917.51856 (production build 10492, SHA-256 `4a23c77b6fb27ccf65f8af97ed8c4a9ddd901cd76ecec494ce83856f0f936d8c`) when checked. The decoded copy in `~/Projects/chatgpt-app` is older, 26.908.31748; the installed package on this machine is 26.915.31945. Static inspection of the latest ASAR shows browser history/settings and annotation-permission UI assets. This only proves those assets are packaged, not that each feature is enabled for Linux accounts.

Deeper inspection of the bundled implementation confirms that ordinary browser tabs use DOM
`<webview>` hosts, not `WebContentsView`. Main validates attachment ownership and forces guest
preferences and its browser session. The renderer keeps a host registry with generation leases,
hidden hosts, and staged tab handoffs. A dedicated browser-page preload supports annotations;
it is not the app's preload. Agent control reaches Electron's debugger/CDP through an internal
backend. The manifest declares Electron 42.3.0 and internal `browser-api`,
`browser-backend-common`, and `browser-common` packages, plus `capnweb` and `ws`. The separate
CUA runtime bundles Playwright 1.57.0; the desktop development manifest lists 1.61.1. That is not
evidence that Playwright owns visible tabs. Some adoption APIs belong to OpenAI's Owl build and
cannot be assumed to exist in stock Electron.

[Codex's browser docs](https://developers.openai.com/codex/browser.md) describe a separate browser profile, shared page beside the chat/review surface, element/area comments that become prompt context, browsing history and downloads controls, site-level access and sensitive-action confirmations, and a separately approved developer/CDP mode. Good UX ideas for later: browser comments alongside file/diff comments, visible tab ownership, and data controls. They are **not** the security contract we chose for this slice. OpenCode 2.0.14 has blanket browser permission and server-network tunneling, so Palot must not imply Codex-style per-site or sensitive-action approval until OpenCode provides and Palot implements it. The Codex package was inspected statically, not installed or signed in for this comparison.

### Webview host

The experimental browser now uses `<webview>` in development and packaged builds. The native
`WebContentsView` backend and comparison flag have been removed. Experimental Browser remains
off by default. The host keeps the existing OpenCode RPC v4, CDP operations, main-owned
credentials, private session partition, and server-network proxy. No Codex runtime packages or
proprietary implementation were copied into Palot.

Main issues one-use window/tab leases, forces sandboxing and the network session, and strips
guest preloads. Renderer-owned guests remain mounted while browser tabs or workbench surfaces
switch. Their CSS layer sits above the responsive workbench drawer but below menus and dialogs,
so this path does not need the native-view overlay-hiding workaround. Recoverable page errors
must retain hosts; title/inventory updates must not hide the active page or release its focus.

Electron is pinned to 44.4.4. Its [upstream fix](https://github.com/electron/electron/pull/54099)
removes the `Invalid guestInstanceId` error reproduced when removing a loaded guest in 44.3.0.
Attachments live above the route outlet, so settings and same-connection session switches retain
live pages rather than restoring URLs. Disable, connection changes, and window teardown still
release them. A session location change reattaches against the new workspace.

Renderer loss now fails only the affected tab. Its URL, title, and tab ID stay in inventory with
an error and a newer generation; healthy guests and the browser binding remain live. Focus and
layout do not recreate a failed guest. Explicit reload/navigation does, after permission-target
validation. Inspection itself never loads a replacement, and cancellation during attachment
prevents a late host from starting navigation. Normal navigation errors retry on the existing
guest rather than taking the renderer-loss path.

Primary tabs remain DOM webviews. Page-created HTTP(S) and blank popups use managed native
`BrowserWindow` surfaces, adopting Chromium's existing child through
`setWindowOpenHandler().createWindow`. This preserves the opener and original navigation,
including POST bodies, rather than replaying a URL. Stock Electron still cannot adopt that child
into a DOM webview; Codex's Owl-specific adoption APIs are not a portable substitute.

Popups share their binding's private session and authenticated OpenCode proxy. Main installs
navigation, permission, download, and network hooks before returning the child. Each popup has
a normal OpenCode tab ID, so existing browser tools can inspect and capture it. The workbench
shows a separate-window placeholder and an explicit focus button. The native title shows the
committed origin instead of the site's title. Renderer-only popup metadata
does not change the published OpenCode `Browser.State` contract.

Closing or losing the opener cascades to its popup children. Disabling the browser or tearing
down its binding also disposes them. Nested popups and more than four popups per binding are
denied. Electron's no-existing-child path, observed with middle-click, is refused rather than
synthesizing navigation. Adoption failures start closing the child before returning to Chromium;
the eventual `destroyed` event is asynchronous. Private rejection probes observed no rejected
GET/POST requests and confirmed that the opener could still open a subsequent popup.

The native fixture covers opener messaging, blank-then-navigate, exact POST bodies, cookies,
and a two-origin HTTP login redirect, plus agent snapshot/screenshot operations. This does not
prove real-provider OAuth, HTTPS login, or arbitrary cross-site authentication. No real accounts
or extracted Codex code run in these fixtures. A crashed popup retains its URL as a failed tab;
explicit recovery creates an embedded page and cannot restore the original opener relationship.

The isolated scenario checks hidden-tab evaluation, retained page state and guest identity across
settings/session switches, absence of app/Node globals, menu hit-testing, resize and page zoom,
managed popup flows, unsafe navigation, teardown without renderer errors,
and URL restoration after disabling/re-enabling. It can still record a two-page switching/idle
sample. The HTTP variant runs the same checks against a paired profile for the harness-owned
service. SSH, external networks, cross-window stress, and the full operation inventory still need
dedicated checks. Site permissions, persistent browser data controls, annotations, prewarming, and
arbitrary detached-window adoption remain separate work.

The earlier comparison pilot used two runs per backend, the same 789×1020 visible window, two fixture
pages, and a production-mode harness build with glass disabled. All four scenario assertion sets
passed and cleaned up. Renderer rAF p95 was 16.7–16.8 ms for both hosts; total Electron working
set after the idle sample was 956–967 MiB for webview and 943–950 MiB for native. This does not
establish a performance winner. Those pre-migration runs logged the teardown error and showed
clipped guest paint in the narrow drawer. The prototype's demonstrated benefit was menu
composition without hiding the page. Raw comparison
evidence is retained locally in `.local/browser-host-comparison.json` with its four run paths.

Follow-up verification traced the apparent clipping to CDP's default surface screenshot,
not the live page layout. Viewport capture (`fromSurface: false`) shows correct wrapping;
native checks also verify guest dimensions after resizing and zooming. The final browser
scenario passes on a private headless Weston display using native Wayland. This is functional
and visual evidence, not a GPU performance measurement or a Hyprland-specific check.

#### Retained-tab policy

Keep live state across ordinary route switches. Don't silently evict a page just because its
session is off-screen or no browser command is currently running. An agent can still be reasoning
between calls, and restoring a URL cannot restore arbitrary JavaScript state or unsaved forms.
The installed OpenCode 2.0.14 `Browser.Control` contract has only `attached`, `command`, and
`cancel`; it provides no browser-idle or page-release signal between operations. Published tab
state describes navigation and generation, not a restorable execution context. This is an API
gap for transparent suspension, not permission to infer inactivity from an empty request queue.

The retention measurement uses 2, 6, and 10 same-origin tabs, a switch away from their session,
and explicit closure back to 2. It records guest counts and three spaced Electron process
snapshots per phase. Summed working sets include shared memory and are not unique physical
memory; post-close working set is not a leak test. This is an accumulating workload, not an
independent-run comparison or a performance improvement claim.

Two complete production-mode harness runs on private Weston/pixman, with glass disabled and
performance collection enabled, produced these ranges of per-run median summed Electron
working sets (MiB):

| Workload phase                  | MiB         |
| ------------------------------- | ----------- |
| 2 tabs                          | 1,041–1,051 |
| 6 tabs                          | 1,467–1,483 |
| 10 tabs                         | 1,900–1,913 |
| 10 tabs, session off-screen     | 1,903–1,909 |
| Explicitly close back to 2 tabs | 1,075–1,088 |

Guest renderer counts followed tab counts; switching sessions did not release them. This
supports adding deliberate resource controls, not a universal tab limit or a claim that each
page uniquely consumes 100 MiB. The complete runs are retained under
`.local/desktop-e2e/2026-09-23T00-06-51-967Z-browser-native-1qn2eb` and
`.local/desktop-e2e/2026-09-23T00-07-48-426Z-browser-native-TZonB3`.

A future budget belongs in main alongside page ownership, not in a React route cache. It must
protect visible pages, in-flight or pending-approval operations, active agent sessions, downloads,
profiling, dialogs, and media. Inactive secondary tabs should be considered before the last-selected
page in another session, with a grace period for quick switching. Suspension must be explicit
about losing live state and invalidate document generations/references when restoring. Until a
safe lifecycle contract and user-facing release behavior exist, measure retention and keep
explicit tab closure as the release mechanism rather than adding automatic LRU eviction.

### 3. Review context and comments

Keep working-tree and branch Changes views. Add `session.diff` as a separate turn/range view so a reviewer can answer “what did this turn change?” without confusing it with VCS state. The published operation's `from`/`to` anchors are **user message IDs**, not assistant response IDs; no `from` means the latest turn. Scope diff queries and cache keys to session, message range and connection. Handle a turn with no changes, disappeared files, and a switch of worktree or review base. The server rejects a range spanning a location change.

Add line selection and editable comments to existing file/diff components with `@pierre/diffs` annotations. Review comments should become explicit, inspectable composer context for the next prompt, never a silent mutation or a second source of truth. Test selection on both sides of a diff, comment editing/removal, prompt serialization, navigation and restoration. Preserve current scroll, keyboard and split-pane behavior.

### 4. Smaller workflows after the large gaps

- Evaluate `/btw` as an explicit, ephemeral no-tools answer using OpenCode's `session.generate`. Do not represent it as a durable message or grant it normal tool permissions. Verify interruption and model selection before exposing it.
- Improve file/prompt navigation based on actual use. Palot's prompt-history search currently covers loaded prompts only; a global full-history promise needs server-backed paging/search evidence, not a local filter over a partial list.
- Compare pairing, provider settings and terminal workflows by concrete friction and E2E evidence. They already have Palot counterparts and should not displace previews, browser security, or review context just because upstream's layout differs.

## Checks and release gates

After each slice, batch lint with `vp check --no-fmt <touched files>`, run the final `vp fmt --check --ignore-path .formatignore <touched files>`, desktop typecheck, focused unit tests, and the smallest native scenario exercising the changed renderer/preload/IPC behavior. Re-run `bun run opencode:coverage:check` when client operations or event ownership change; a passing analyzer proves contract references, not feature parity. No broad suite by default. Record remaining limitations in the relevant product documentation before calling a stage complete.

Source baseline: [OpenCode V2 release feed](https://opencode.ai/update/api/latest/cli/opencode), [Beta feed](https://opencode.ai/update/api/beta/cli/opencode), [2.0.14 artifact kinds](https://github.com/anomalyco/opencode/blob/v2.0.14/packages/app/src/workspaces/files/artifact.ts), [published browser plugin](https://github.com/anomalyco/opencode/blob/v2.0.14/packages/plugin-browser/README.md), and Palot's `apps/desktop/opencode-coverage-baseline.json`.
