# palot-native: Rust + GPUI implementation plan

Research date: 2026-10-02; updated 2026-10-03 with user-provided visual references. Status: proposed architecture and implementation plan, not an implemented app.

## Recommendation

Build `palot-native` as a new Rust desktop frontend alongside the existing Electron app. Use **GPUI Kit 0.7.0**, which packages Zed Industries' GPUI with GPUI Base, GPUI Component, and assets. Keep **OpenCode 2 as the execution backend and source of truth**.

The product should still feel like Palot: a quiet task inbox, project navigation, readable streaming conversations, a capable composer, and an optional review/workbench pane. Borrow native interaction patterns from existing GPUI apps, without importing their agent orchestration or persistence models.

Start with Linux and macOS as first-class development targets. Compile and smoke-test Windows early, then qualify it for release separately. This is a proposed rollout order, not a framework limitation or a decision to drop Windows.

The main decisions:

- A native GPUI interface, not React inside a Rust wrapper.
- Direct Rust HTTP/SSE/WebSocket integration with OpenCode's official V2 contracts.
- No new agent engine, provider runtime, MCP client, or fleet coordinator.
- No permanent JavaScript service bridge. Development-time Bun tooling can export official contracts and reuse the existing scripted test provider.
- No embedded browser in the first useful release. Browser parity is a separate, gated project.
- Preserve the Electron app while native reaches measured feature parity. No forced migration or replacement during development.

The first milestone should prove a real vertical slice: connect to an isolated OpenCode service, open a project, submit a prompt, stream a reply, answer a request, stop execution, reconnect, and recover the authoritative state.

## 1. Research findings

### 1.1 GPUI and its ecosystem

GPUI is indeed Zed Industries' framework. It combines retained entities with declarative per-frame element trees, GPU rendering, CSS-like layout/styling, focus/action dispatch, and foreground/background executors. It is pre-1.0 and its upstream documentation explicitly warns about breaking changes. [S1]

The ecosystem now has several distinct tracks. Older examples are not necessarily compatible with current releases.

| Track                  | What the research established                                                                                                                                                                                                                   | Decision for Palot                                                                                    |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Zed's upstream GPUI    | Official source, Apache-2.0 framework, active development. Current source separates `gpui_platform` from core GPUI and documents macOS, Linux/FreeBSD, and Windows backends.                                                                    | Architectural reference and upstream issue target. Do not depend on floating `main`.                  |
| Longbridge GPUI Kit    | Published `0.7.0` on September 28. Re-exports matching GPUI, Base, Component, and assets. Includes controls, semantic themes, docking, variable-height virtualization, Markdown, editor primitives, AccessKit integration, and UI-test helpers. | Preferred application dependency, pinned to `=0.7.0` for the initial spike.                           |
| GPUI Base              | Unstyled behavior/state underlying Component, available through Kit.                                                                                                                                                                            | Use where Palot needs custom presentation while retaining difficult interaction behavior.             |
| GPUI Component         | Styled application controls, inspired partly by shadcn. Older `longbridge/gpui-component` links now lead into the Kit ecosystem.                                                                                                                | Reuse buttons, inputs, menus, dialogs, selection, docking, and rich text before building equivalents. |
| GPUI Community Edition | Independent Apache-2.0 fork. README says it is mostly API-compatible, but divergence is increasing.                                                                                                                                             | Track, but do not mix with Kit's upstream snapshot graph. Reconsider only for a demonstrated blocker. |
| Other forks            | Some applications maintain GPUI patches for browser compositing or mobile platforms.                                                                                                                                                            | Evidence that advanced integration is possible, not a reason to fork on day one.                      |

Kit `v0.7.0` pins its GPUI snapshot family to `gpui-pre-* =0.3.7`. Those are snapshots of Zed's framework, not an independent Palot rendering framework. Use Kit's re-exports so the dependency graph has one coherent set of GPUI types. Do not combine that graph with a separate `gpui` Git dependency. [S2]

Kit's README reports use in Longbridge Pro and lists substantial functionality. This is useful ecosystem evidence, not proof that Palot's workload or every platform works correctly. Claims such as 120 FPS and large editor capacity must be measured in Palot, not adopted as release promises.

### 1.2 Existing GPUI agent apps

| App                      | Verified evidence                                                                                                                                                                                     | Useful inspiration                                                                                                                                               | What not to inherit                                                                                                                                                                                      |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Waku**                 | Active Rust/GPUI agent control plane. Source separates UI, client, protocol, core, and daemon. Its Rust OpenCode integration adopts the shared V2 service and fans out SSE events. GPL-3.0-only. [S3] | Quiet transcript-first workspace, keyboard queue/steer/stop, variable-height list anchoring, workbench separation, cached rendering, explicit service ownership. | GPL source cannot simply be copied into MIT Palot. Do not inherit a provider-neutral runtime or a second task database. Its browser path uses a GPUI fork.                                               |
| **Fintwind**             | Windows-focused GPL-3.0-only Waku fork, specifically OpenCode 2, pinned to 2.0.19. Projects, session tabs, streaming tools/reasoning, files/diffs, terminal, and optional WebView2. [S4]              | Closest backend/product comparison; Windows packaging, native transcript and review interaction, capability/version clarity.                                     | Private per-app OpenCode server and app-owned task/daemon model differ from Palot. Reported memory is a snapshot excluding OpenCode, not a comparative benchmark.                                        |
| **Ghostex**              | Active MIT repo with a Rust/GPUI desktop app, native chat code, Rust domain/client packages, libghostty VT integration, CEF helpers, and native worktree/modals. [S5]                                 | Session organization, splits, worktree controls, task attention, native UI parity work, terminal cell-model separation.                                          | CEF, embedded VS Code, remote daemon/mobile stack, account switching, vendored GPUI dependencies, and its broad agent orchestration model. Its manifests show significant integration complexity.        |
| **Lumi**                 | MIT Rust workspace with a GPUI + Component app, dedicated bridge/event bus, transcript/composer/sidebar/views, and engine crates. Last visible repository update was May 11. [S6]                     | Entity boundaries, event-to-view bridge, workspace navigation, compact request/budget/status surfaces.                                                           | Its policy, dispatch, memory, pricing, and provider engines. The observed event bus polls every 16 ms and has blocking work inside foreground updates; use as a comparison, not a performance blueprint. |
| **AgentX / agentstudio** | Public source uses GPUI, a Component fork, `gpui_term`, Tokio, ACP, and worktree/service crates. Its source manifests demonstrate real native agent UI integration. [S7]                              | Component composition, ACP UI, code/terminal/worktree separation.                                                                                                | ACP as Palot's primary backend, floating/forked dependencies, or assuming packaging claims prove current platform support. Licensing and dependency revisions need review before reuse.                  |

**OpenSquirrel** also appeared in search results as an archived GPUI tiling agent manager. Both its GitHub page and API returned 404 during this research. Search snippets describe grid/delegation/SSH functionality and an abandonment note, but current source and status could not be verified. Do not make it a dependency or claim its implementation was reviewed.

Zedra is an adjacent GPUI example for remote terminal/editor/diff/mobile interaction, rather than a desktop Palot replacement. Its mobile framework and QUIC daemon would expand this project substantially. Keep it as a future interaction reference, not a starting architecture. [S8]

**Practical conclusion:** Waku/Fintwind are the closest interaction references; Ghostex is the strongest permissively licensed example of the integration costs; GPUI Kit is the most useful reusable application layer. Use Palot's own design and OpenCode ownership as the deciding constraints.

This research inspected documentation, manifests, and selected implementation files. It did not build or run these apps, and it does not claim screenshot-level visual comparison or production-readiness validation.

### 1.3 Important limitations

1. **GPUI is not a browser.** React, Tailwind, DOM selection, Shiki, Pierre diffs/trees, Ghostty Web, PDF.js, Mermaid JS, and KaTeX do not move into GPUI unchanged.
2. **Native controls still need integration work.** Input state/subscriptions must survive redraws; focus, IME, accessibility, cross-row selection, and virtualization need product-specific checks.
3. **Browser embedding is a separate subsystem.** Kit's `gpui-wry` README explicitly calls it experimental, currently macOS/Windows only, with native views covering GPUI content inside their bounds. It recommends a separate window/popup. [S9]
4. **Terminal libraries are not plug-and-play.** `gpui-term` uses floating upstream GPUI, and its manifest comments out Component because of API incompatibility. A successful example build does not establish compatibility with Kit 0.7. [S10]
5. **Rust OpenCode support has gaps.** Official documentation provides JavaScript clients and a Node service API, not an official Rust client. The documented HTTP contract is suitable for Rust, but local discovery and event payload generation need deliberate adapters.
6. **Native does not guarantee lower total resource use.** OpenCode and provider/tool processes remain. Measure frontend-only and full-stack totals separately.

## 2. Product scope and parity

The current architecture is explicit: OpenCode owns sessions, execution, messages, permissions, agents/models, and server-relative files/worktrees. Palot owns presentation, profiles, credentials, drafts, appearance, triage, and local automation state. Keep that split. [P1]

Native should reproduce behaviors, not React's component tree or Electron IPC API.

| Surface          | First useful native alpha                                                                         | Daily-driver beta                                                                                    | Later / separately gated                                                         |
| ---------------- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Shell/navigation | Inbox, Projects, new task, settings, command palette                                              | Search/filter/shelves, unread and attention behavior, remembered navigation                          | Advanced layouts and tray workflows                                              |
| Connections      | Existing local service; explicit missing-service state; configured remote HTTP(S)                 | Monitoring multiple connections, pairing, explicit local start/recovery, SSH                         | Runtime download/update UI and Tailscale management                              |
| Task lifecycle   | Create/open/resume, rename, prompt, interrupt, basic child visibility                             | Queue/steer, fork, revert/restore, compaction, session history/move                                  | Broader experimental operations as contracts permit                              |
| Composer         | Multiline input, agent/model/reasoning, draft retention, file/image attachment, permission preset | Commands/skills/mentions, queued prompt edits, context inspector, attachment progress/cancel         | Specialized composer extensions                                                  |
| Transcript       | Streaming text/reasoning/tools, native Markdown, collapsed long output, pagination                | Parent/child activity, nested Code Mode, turn navigation/search, copy/selection, request ownership   | Native math/Mermaid and uncommon rich-content renderers                          |
| Requests         | Permission and all currently supported form/question fields                                       | Descendant requests surfaced in parent, origin labels, dismiss/recovery                              | Future form variants with explicit capability support                            |
| Review/workbench | Read-only files, changed-file list, unified diffs, turn changes                                   | Split diffs, range-to-composer, branch/worktree context, terminal, usage                             | Full editor/IDE capabilities                                                     |
| Appearance       | Palot light/dark/system, UI/code sizing, solid fallback                                           | Theme catalog, separate code palette, platform material, contrast, read-only Omarchy theme following | Exact theme/syntax equivalence where engines differ                              |
| OS integration   | File dialogs, clipboard, links, window state, basic notifications                                 | Multiple windows, drag-out task, menus, credential vault, deep links                                 | Global shortcuts, advanced tray/background features                              |
| Automations      | Not enabled                                                                                       | Manual runs only if independently safe                                                               | Scheduled execution and imported schedules after single-host ownership is solved |
| Browser          | External browser handoff                                                                          | External browser remains supported                                                                   | Optional native host only after plugin transport/security parity is proven       |

The alpha is not full parity. Beta should be usable for the normal task/review loop. Browser, scheduled automation, and runtime management must remain explicitly marked as missing until delivered, not hidden behind misleading buttons.

### Non-goals

- Rewriting OpenCode in Rust.
- Running Claude/Codex/other CLIs directly alongside OpenCode.
- Adding a second authoritative agent/session database.
- Building an IDE, LSP platform, plugin runtime, mobile app, or custom remote daemon.
- Replacing the current public/web experience with GPUI WebAssembly.
- Shipping CEF or a JavaScript extension runtime to recreate Electron features by default.

## 3. Visual and interaction direction

`DESIGN.md` remains the product contract. Translate its relationships and behaviors into native tokens and primitives. References to Tailwind, shadcn, and Electron describe the current implementation, not a requirement to recreate those dependencies. [P2]

### Shell

#### Visual baseline from the supplied screenshots

The user supplied four current Palot screenshots during planning: a new-task screen, two active transcript states, and a transcript beside the Changes workbench. These are the primary visual references, ahead of other apps' screenshots. They show one dark/translucent configuration, not every theme or platform.

- **Translucent continuous shell:** dark blue/purple and warm background tones remain visible across sidebar and content. Fine separators define the panes without turning every region into an opaque card. Preserve the effect where the OS/compositor supports it, with a visually coherent opaque fallback. A screenshot does not establish whether the underlying blur comes from the app or compositor.
- **Sidebar:** roughly 17–19% of the 2000-pixel-wide captures, with top navigation, compact utility controls, rich three-line task entries, a restrained selected fill, and a bottom connection footer. Treat these as observed proportions, not hard-coded responsive widths or logical-pixel measurements.
- **New task:** the Palot mark and project-aware question sit above a centered composer. The main area is intentionally spacious. Do not replace it with a dashboard, metric cards, or a full-width editor.
- **Conversation:** a thin full-pane task header sits above a narrower readable content column. Tool activity is rendered as quiet icon/label rows with right-aligned duration/result metadata and disclosure controls. Expanded code/output gets a bounded, lightly bordered surface. Assistant prose is not forced into chat bubbles.
- **Composer:** a broad, softly rounded floating input is wider than the transcript text. Its toolbar remains inside the input surface, while a slightly inset project/checkout/branch strip sits directly below it. New-task destination selection and existing-session destination display retain their different behaviors.
- **Active work:** Working status appears just above the composer; stop/steer/send controls reflect execution state. Attached files form compact cards inside the composer without displacing its bottom controls.
- **Workbench:** when Changes opens, the layout becomes sidebar + conversation + a substantial review pane, not a narrow inspector. In the supplied split capture, these occupy approximately 17% / 44% / 39% of the window. The chat column and composer adapt to their allocation, and the review pane has its own tab/header, working/branch controls, file summary, and independently scrolling diffs.

The proposed shell below is schematic. Its footer is not a new mandatory full-window status bar: the screenshots' sidebar connection footer and composer context strip are the default placement. The workbench is closed by default unless restored from the user's layout.

Keep the screenshot attachments as session-local research evidence; do not commit real task names, conversation contents, or desktop imagery into public fixtures. Before implementation's visual acceptance pass, recreate these four states with synthetic data at matching window dimensions and record the display scale. Compare sidebar density, content width, composer layering, header alignment, selected states, output expansion, and review-pane proportions. Repeat with opaque/reduced-transparency, light mode, large text, and narrow windows. Exact background imagery is not a product requirement.

```text
┌───────────────────────────────────────────────────────────────────────┐
│ Native titlebar / workspace controls                                  │
├──────────────────┬────────────────────────────┬───────────────────────┤
│ Inbox / Projects │ Task header                │ Workbench header      │
│                  ├────────────────────────────┤ Files | Changes | ... │
│ Pinned           │                            │                       │
│ Rich task cards  │ Virtualized conversation   │ File / diff / request │
│                  │ Text, tools, reasoning     │ detail / terminal     │
│ Inbox            │ Child activity             │                       │
│ Rich task cards  │                            │                       │
│                  ├────────────────────────────┤                       │
│ Snoozed / Settled│ Pending requests           │                       │
│ Compact shelves  │ Composer + context toolbar │                       │
├──────────────────┴────────────────────────────┴───────────────────────┤
│ Optional recovery notice only; normal status stays in existing controls│
└───────────────────────────────────────────────────────────────────────┘
```

- Preserve rich Pinned/Inbox cards and compact Projects/Snoozed/Settled rows.
- Keep connection visibility in the existing Inbox filtering/options language. Do not add a new fleet dashboard as the default screen.
- Keep connection context beside project/branch controls. Connected local destinations stay quiet; remote destinations get the compact cloud treatment; offline ownership is explicit.
- Preserve the composer grouping: attachments/agent/approvals on the left; model+reasoning, context, and submission on the right.
- Use aligned pane headers, restrained borders/radii, tonal separation, and ordinary Lucide-style icons. No mandatory Zed color scheme or terminal-grid aesthetic.
- Make right-pane content optional. At constrained widths, collapse the workbench, then provide explicit sidebar reveal. Minimum pane sizes determine breakpoints.
- Start with a constrained shell split, not a freely dockable everything-everywhere workspace. Kit's docking can support later tabs/splits without changing product ownership.

### Design tokens and controls

Create a Rust `PalotTheme` adapter for existing semantic palettes and preferences. Preserve light/dark availability rather than synthesizing unsupported variants. Keep named typography roles (`sm`, `compact`, `meta`, `micro`, `tag`, `page_title`, `code`) and bounded icon sizes. Defaults currently use UI 14, code 12, terminal 13; import these rather than choosing an unrelated native scale. [P3]

Reuse Kit controls for behavior and override themes/sizes centrally. Build custom task cards, tool rows, child summaries, composer chrome, and diff rows from Base/GPUI when their layout is uniquely Palot. Avoid a generic wrapper for every Kit component.

Theme exports should be generated from Palot's authoritative data into versioned JSON. GPUI consumes the JSON; it does not evaluate TypeScript or CSS. Syntax engines differ, so map semantic code colors and document fidelity limits instead of promising identical Shiki tokens.

Native material support sits in a small platform module. Reduce Transparency always forces readable solid surfaces. macOS vibrancy/Liquid Glass, Windows material, and Linux compositor transparency are separate capabilities; do not use private APIs to make them look identical. Omarchy support reads theme/font data only and does not modify desktop configuration.

### Keyboard, selection, and accessibility

- Port the current user-facing shortcuts into typed GPUI actions and focus contexts. Verify actual bindings from source instead of assuming every reference app's shortcuts should win.
- Retain composer input state, caret, undo history, attachment ownership, and per-task drafts across navigation and redraws.
- Test Unicode, CJK/IME composition, dead keys, emoji/graphemes, paste, undo/redo, and large multiline prompts early.
- Keyboard and assistive activation dispatch the same application commands as pointer actions.
- Use stable element IDs derived from connection/session/message identities. Expose roles, names, selected/expanded/value states, and error/status semantics.
- Check cross-block text selection and copy through virtualized transcripts. If Kit's native text support cannot meet it, implement a dedicated selection model rather than silently reducing copy to whole-message buttons.
- Return focus after menus/dialogs; never steal it when streaming or a background task completes.
- Verify VoiceOver, Narrator, and Linux AT-SPI behavior on real supported platforms. Headless AccessKit assertions do not prove native announcements. [S11, P4]

## 4. Architecture

### 4.1 Repository layout

Add an independently buildable Cargo workspace in `apps/native/`, within the existing repository. Keep the executable/package name `palot-native`. Do not reorganize existing JS packages to make room.

```text
apps/native/
  Cargo.toml                  # workspace, profiles, coherent dependency pins
  Cargo.lock                  # committed application lockfile
  rust-toolchain.toml          # exact tested stable toolchain
  crates/
    palot-native/             # GPUI app, windows, views, actions, OS integration
    palot-core/               # identities, projections, reducers, local preferences
    palot-opencode/           # wire contracts, transport, service/connection actors
  assets/                     # icons, licensed fonts, exported themes
  contracts/opencode/         # pinned schema/event manifests, version, provenance
  tests/fixtures/             # synthetic event traces, rich content, performance data
  xtask/                      # checks, isolated E2E, packaging, release verification
```

These are three substantive boundaries, not one crate per view. Keep terminal and platform code as modules initially. Split them into crates only when build isolation or a real second consumer justifies it.

Dependency direction:

```text
palot-native ───────→ palot-core
      │                   ↑
      └────────────→ palot-opencode
                         │
                         └── official OpenCode HTTP / SSE / PTY WebSocket
```

`palot-core` has no GPUI, platform keyring, network, or process-launch dependency. `palot-opencode` uses core identities/projection commands but no GPUI entities. The application bridges transport results into view state on the GPUI foreground thread.

### 4.2 State ownership

| Owner                | State                                                                                                                              |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| OpenCode service     | Sessions/messages, execution, child relationships, forms, permissions, provider/auth/config/MCP/skills, files, Git/worktrees, PTYs |
| Connection actor     | Endpoint/credentials, compatibility, connection and stream generations, request scheduling, subscription, retry/reconciliation     |
| In-memory projection | Task summaries, attention index, requested transcripts, catalogs, current request state, file/diff results                         |
| Palot local store    | Profiles and monitoring preferences, pin/snooze/settle, drafts, layout/appearance, local automation definitions when enabled       |
| GPUI entities        | Window navigation, focused controls, input models, scroll/layout state, visible projections, open panes/popovers                   |

Never key a session, request, draft, or query by a bare session ID. Core keys should include `ProfileId` plus native session identity; network results also carry a connection generation. Location-scoped keys include the owning profile and server location. Equal IDs and paths on different servers are unrelated. [P5]

### 4.3 Concurrency and the UI bridge

Use a dedicated Tokio runtime for HTTP, WebSocket, timers, async filesystem/process operations, and connection actors. GPUI remains responsible for its foreground entities and rendering. Parsing/highlighting/diff layout and database work run off the UI thread.

Each monitored profile gets one connection actor and one event stream, shared by that app's windows. The actor owns the secret-bearing HTTP client and command queue. Views get typed commands and projection snapshots, not credentials, raw SQL access, or arbitrary shell execution.

The application-facing boundary should stay small:

- `connect(profile, intent)` and `disconnect(profile)` for lifecycle.
- `dispatch(owned_command)` for user operations, with completion/error state.
- `observe(scope)` for summary/transcript/catalog projections.

These are proposed interface roles, not claimed upstream API method names. Internally, transport methods follow the generated OpenCode operations. A mock wire server and real service provide the actual substitution seam; do not add a speculative multi-agent provider abstraction.

Use bounded queues and wake-driven delivery, not foreground polling forever. Preserve ordered lifecycle/request events. Coalesce text updates only when equivalence is proven: concatenate deltas in order or publish the latest fully reduced message. Never drop an append delta because a newer delta exists. If ingestion capacity is exceeded, mark the projection stale, close the stream, and reconcile; do not silently discard events or let memory grow indefinitely.

Notify only affected entities, at most once per frame-sized batch where appropriate. A background summary update should not reconstruct the active transcript. Hidden windows and inactive transcripts should not keep animation loops alive.

Retain tasks/subscriptions deliberately and use weak references back to views. Closing a window cancels its view work; it does not stop OpenCode sessions or a shared service. Multiple windows can observe the same projection without duplicating streams.

### 4.4 Rust is a new security boundary

A single native process does not recreate Electron's main/preload/renderer isolation. This is acceptable for trusted Rust UI code, but should be stated plainly. Credentials remain private to connection/platform modules, excluded from UI snapshots, tracing, `Debug`, crash reports, and clipboard actions unless an explicit credential-sharing operation requires them.

Untrusted transcript/tool/file content remains data. It cannot select an execution connection, send approval commands, invoke shell processes, fetch arbitrary local files, or call platform APIs by being rendered. If an embedded webview arrives later, it requires a real isolated process/IPC boundary, not access to application internals.

## 5. OpenCode 2 integration

### 5.1 Contract baseline and generation

Palot currently pins client/protocol/schema/browser-plugin packages to **2.0.19**, with an existing product compatibility policy for stable 2.x from 2.0.7. Use 2.0.19 as the initial native development and isolated-test baseline. Do not upgrade the user's running service as part of scaffolding. [P6]

Initially certify native against that exact test baseline. Widen native's advertised compatibility to the current Palot policy only after fixtures and integration checks establish it; do not claim older/newer service support just because Electron has it. An unsupported running service gets an explanatory state, not an automatic downgrade/replacement.

Generate request/response types and operation descriptors from the OpenAPI document produced by the pinned runtime, with upstream package provenance and a content hash. Treat the public `https://opencode.ai/v2/openapi.json` as a research source, not an immutable version pin. Validate a candidate generator against actual unions, encoded numbers, null/optional fields, wildcard filesystem routes, cursors, and documented error envelopes before committing to it.

**OpenAPI alone is insufficient.** The current event schema exposes `V2EventEncoded` as a JSON-encoded string rather than a complete discriminated event union. The researched public spec also has empty security declarations even though authentication is required. Rust generation must supplement it with the official `@opencode/protocol` / `@opencode/schema` event definitions and verified authentication behavior. Do not generate a client that accidentally omits auth or decodes SSE as ordinary response JSON. [S12]

Use a development-only Bun export tool against pinned official packages to emit a deterministic event/schema manifest and licensed notices. Implement Rust event enums/decoders from that artifact. Keep generated wire types separate from Palot projections. Unknown additive events can be retained as an `Unknown` wire variant and logged by type only; unknown permission/form variants disable unsupported controls and require refresh/error handling, not guessed approvals.

`reqwest` with streaming and native/system certificate verification is a reasonable transport candidate; verify proxy and corporate CA behavior. Use a small typed adapter around generated operations. A third-party Rust OpenCode crate is not automatically V2-compatible; one search result, `scalar0/opencode-rs`, had a March update and no V2 qualification established in this research.

### 5.2 Local service discovery: explicit upstream gap

The official documented `Service.discover/ensure/stop/headers` interface is Node-specific. There is no official Rust equivalent identified here. This is the first integration gap to resolve, not a reason to parse OpenCode's database. [S13]

The installed **official 2.0.19** package exposes registration types and implements discover by reading the configured XDG registration file, constructing authentication, and probing `/api/info` with PID/version/state checks. It distinguishes discovery from ensure, which can start or replace services. [P7]

Preferred native approach:

1. Ask/check upstream for a supported language-neutral discovery/launch contract, including registration schema, channel/path rules, and credential handling.
2. In the Phase 0 spike, implement a small Rust discovery adapter from the pinned official service contract/source. Read registration only, authenticate, reject redirected/invalid/nonlocal local endpoints, and verify PID/version/readiness. Keep this adapter isolated and provenance recorded.
3. Run conformance fixtures against official `Service.discover`, plus real isolated service tests. Do not copy Waku's GPL implementation.
4. If the contract cannot safely be reproduced, block default local discovery and ship the spike against an explicit endpoint. A temporary official-client helper can investigate the gap, but a permanent JS helper is not the selected architecture.

Discovery on app launch must not start, stop, replace, or repair the service. Reconnect also remains non-mutating. Explicit Start/Restart needs a scoped confirmation, revalidation immediately before action, and preservation of a healthy service that appears during the race.

Use documented OpenCode lifecycle commands for confirmed control after verifying their exact pinned behavior. Do not reproduce all of Node `Service.ensure` by guesswork: it includes contention, recovery, and persistent-terminal handoff. If the CLI cannot express the necessary safe operation, surface the gap and defer that control. Do not manually delete/change service registration/config or signal a PID merely because it appeared in a file.

Local CLI detection runs bounded `--version` probes, off-thread, against explicit/user-selected paths. Never assume the executable version equals the connected service version. V1 is rejected before any service-launch command.

### 5.3 Streaming, hydration, and reconnect

Official subscriptions are live-only. They have no event replay or automatic reconnection, and slow consumers can overflow the stream. Client code must recover authoritative state. [S12, S13]

Implement:

1. One shared SSE reader per monitored profile, parsing UTF-8 chunk boundaries, multiline `data`, comments/heartbeats, named failure events, and bounded frame sizes.
2. Establish subscription before initial snapshots. Capture local connection/hydration generations and buffer relevant events while reads are in flight.
3. Reconcile snapshots and buffered events using verified per-resource semantics. Event IDs are not a replay cursor. Preserve tombstones/removals and reject old responses.
4. For additive text deltas, do not blindly append everything buffered over a snapshot. Use available resource versions/identity semantics; when a resource lacks an ordering fence, refetch that resource or reconcile a full message rather than risk double text.
5. On interruption, invalidate the stream epoch, reconnect with backoff/jitter, and refresh summaries, activity, forms, permissions, inbox, and visible transcript tails. Keep older transcript pages lazy.
6. On unresolved overlap/overflow, show a recovering/stale state. After quiescence the projection must equal a fresh authoritative read. If upstream supplies no usable ordering/version boundary, record that limitation instead of claiming transactional snapshots.

The event routing table comes from official typed payloads. Session IDs are not uniformly at one JSON path, and catalog events can be location-scoped. Missing session identity is not permission to broadcast a request to every task. Ignore client-specific remote-control events unless deliberately supported and ownership-checked.

Background monitoring reduces summaries/attention/catalogs only. It does not parse every background transcript into view rows. OpenCode currently has no summary-only event stream, so this saves app work, not necessarily network bandwidth. [P5]

### 5.4 Operations and user safety

- Sessions: list/create/get/update, prompt/command, interrupt, fork, agent/model switching, move, compaction, inbox, history, context, diff, and revert operations as supported by the pinned contract.
- Requests: forms and permission requests, including descendant origins and stale/already-settled errors.
- Catalog/settings: agents, models/providers, integrations, credentials, MCP, commands, skills, references, config and location reload. OpenCode retains provider secrets/auth state.
- Workbench: filesystem, VCS, worktree, shell, PTY/persistent PTY, with capability gates for experimental/prototype routes.
- Browser: only through its published plugin contract if/when implemented.

Every action captures its owning profile/session/location at invocation. Connection changes invalidate pending results and attachment staging. Offline rows never fall back to the focused/local server.

Approval presets update authoritative session rules. Defaults clears overrides; Full access needs explicit confirmation; new drafts never inherit Full access accidentally. Selecting a preset does not answer existing requests. Needs input outranks Working in attention summaries. [P2]

Never blindly retry prompt submission, permission replies, or destructive operations after a timeout. Reconcile the result first, then expose an explicit retry when the contract lacks idempotency. Queue and steer use OpenCode's inbox semantics, not a competing local delivery queue.

Remote HTTP requires explicit insecure-transport consent except trusted loopback/tunneled contexts. Disable authenticated cross-origin redirects. Pairing credentials/tokens go into the OS vault. Server filesystem paths stay on that server; opening a remote path never means reading the same string from the local disk.

## 6. Native replacements for web surfaces

### Transcript and Markdown

Use Kit's native Markdown/text facilities first, with `MessageScroller` or its Base/GPUI list machinery. The inspected 0.7 source supports caller-owned message data, tail following, prepend/splice, targeted remeasurement, scrollbars, and jump-to-latest behavior. Validate that against Palot's turn grouping before committing to the higher-level wrapper. [S14]

Rows use stable message/part/turn identities. Completed Markdown blocks are cached; only the active streaming tail is reparsed, off-thread where useful. Huge tool output gets bounded inline height with an explicit full viewer. Initial hydration fetches recent pages, not all history.

Cache keys include content revision, wrap width, font/theme, and presentation state. Prepending history, expanding reasoning/tools, and resizing must preserve the reader's anchor. Tail following is a user intent, not something restored on every streamed token. Tests must cover reading old content while a new reply grows.

Sanitize/interpret Markdown and limited HTML without executing scripts. Resolve file references against the owning server location and gate remote images/resources so rendering does not silently fetch tracking URLs. Open external links only through explicit user activation and safe scheme handling.

Math, Mermaid, HTML previews, and PDF previews need separate candidate evaluation. Prefer permissively licensed native renderers or external-open fallbacks. Do not add a webview just to make the transcript renderer easier.

### Files, tree, and diffs

Pierre and Shiki remain Electron-only. Native uses its own flat visible-tree projection, semantic status icons, and a virtualized read-only code/diff surface.

- Read directory/file/VCS data through OpenCode for both local and remote workspaces.
- Start with unified diffs, hunk headers, line numbers, additions/deletions, binary/rename/no-newline states, and copying.
- Distinguish turn changes from working/branch/committed diffs. Do not present repository changes as belonging to a particular agent turn without evidence.
- Parse/highlight off-thread. Use Kit/Tree-sitter for initial language support; enable only the tested grammar feature set to control compile/binary size.
- Add side-by-side synchronized scrolling and range-to-composer once unified review is stable.
- Keep a selected path/range bound to connection, location, and content revision. Stale selections are refreshed rather than submitted against unrelated files.
- Treat oversized/binary files explicitly; never block rendering with a whole-repository read.

A native read-only review surface is in scope. A complete editor and LSP stack are not required to replace Palot's review workflow.

### Terminal

Preserve OpenCode as PTY owner and use its authenticated connection-token/WebSocket contract. A terminal renderer is not permission to create local PTYs for remote sessions.

Evaluate two implementations in an isolated spike:

1. `alacritty_terminal` as a Rust VT model with a small GPUI cell renderer. Likely the simplest initial build graph; requires audit of license, version, selection, and rendering behavior.
2. `libghostty-vt` with a safe Rust wrapper and GPUI cell renderer, inspired by Ghostex's separation. Better continuity with today's Ghostty surface, but adds Zig/native build and packaging work.

Do not adopt `gpui-term` wholesale until it compiles against the selected GPUI graph and supports server-owned byte streams without taking over PTY lifecycle.

Acceptance covers cursor/selection, resize, Unicode width, colors, alternate screen, bracketed paste, scrollback, reconnect/cursors, and disposal. OSC clipboard/links require policy and user activation; terminal escape sequences cannot gain unrestricted platform access. Bound scrollback and never log terminal bytes by default.

Choose one renderer after the spike. Keep external terminal handoff as an explicit interim fallback, not a claim of terminal parity.

### Browser

Browser parity is high-risk because Palot's current browser has per-task storage, server-mediated networking, plugin control, downloads/popups, and lifecycle ownership. A plain Wry widget would silently change that privacy/transport contract. [P6]

The default plan is external browser handoff. A later native browser must pass a separate design review for:

- Official browser-plugin RPC and attachment behavior.
- Server-mediated HTTP(S), including private-network/localhost targeting, without desktop-direct fallback.
- Storage partitions, navigation, redirects, popups/downloads, certificate handling, and permissions.
- Compositing, overlays, clipping, DPI, focus, input, accessibility, and platform support.
- Process isolation, bounded authenticated IPC, plugin/UI ownership, and packaging size.

Kit Wry is a candidate for a separate-window prototype, not the chosen cross-platform embedded solution. CEF can be evaluated only if its deployment and maintenance cost is justified. Browser-enabled memory/startup figures must be reported separately.

## 7. Persistence, migration, and platform integration

Use SQLite for Palot-owned triage/drafts and later automation state, with `rusqlite` as the initial candidate. Keep profile/appearance/layout documents versioned; either atomic JSON or SQLite is sufficient. DB/file work runs on a dedicated worker, not inside `render`.

Use a new native application data root and identifiers for Dev/Nightly/Stable. Do not open the Electron app's store for concurrent writes. Keep logs bounded and redact secrets, prompts, file contents, and terminal data by default.

Migration is an explicit, one-way import into native-owned storage:

1. Preview profiles, appearance, triage, and drafts to import.
2. Read a consistent export/snapshot, not a live SQLite main file without its WAL.
3. Preserve profile IDs or map them transactionally so triage remains connection-scoped.
4. Import vault credentials only through a supported secure export/re-entry flow. Do not try to decode Electron `safeStorage` ciphertext as ordinary configuration.
5. Do not import OpenCode sessions/messages. Native connects to the same service and hydrates them.
6. Import automation definitions disabled. The two desktop apps must not both schedule the same job.
7. Leave the original app data untouched and keep a recoverable import report without secrets.

OS keychain/credential manager/Secret Service integration needs explicit locked/unavailable behavior. No plaintext credential fallback. Test Linux desktop/session keyring availability independently from renderer support.

Platform modules own file pickers, clipboard, external-open, notifications, menus, appearance preferences, window bounds, deep links, and optional tray. Prefer GPUI platform facilities; use narrow native APIs only for verified gaps. Validate deep links and never let them execute a prompt/approval without confirmation.

SSH should reuse the user's OpenSSH configuration/agent where feasible. Forwarding, host-key confirmation, credential prompts, known-host handling, owned-process cleanup, and remote runtime selection need their own bounded service. Never mutate SSH trust automatically or stop a remote service when closing a window.

For later scheduling, define one automation-host lease/identity and occurrence idempotency before enabling imported jobs. Sleeping/waking, DST/time zones, interrupted launch, permission requests, crash recovery, and app exit behavior must match the documented product contract. Do not introduce an always-on Palot daemon only to solve this prematurely.

## 8. Dependency and licensing policy

Initial candidates, to be resolved and locked during implementation:

| Need          | Candidate / policy                                                                       |
| ------------- | ---------------------------------------------------------------------------------------- |
| UI            | `gpui-kit = "=0.7.0"`, use re-exports; test support only in tests                        |
| Async         | Tokio + cancellation tokens; wake-driven channels to GPUI                                |
| HTTP / SSE    | Reqwest with streaming/system trust; tested SSE parser, named failure support            |
| PTY WebSocket | Tokio Tungstenite or equivalent, matched TLS/trust policy                                |
| Wire types    | Serde, Serde JSON, contract generator selected after real schema trial                   |
| Local DB      | Rusqlite, migrations, one serialized worker                                              |
| Secrets       | OS-backed keyring candidate, explicit backend/locked-state checks                        |
| Errors/logs   | Thiserror at module interfaces; Anyhow at application boundaries; tracing with redaction |
| Search        | Nucleo matcher candidate for native palette/session filtering                            |
| Highlighting  | Kit Tree-sitter features; no automatic full grammar bundle                               |
| Terminal      | Alacritty VT vs libghostty VT, choose after spike                                        |
| Browser       | None by default; Wry/CEF only in gated prototype                                         |
| Packaging     | Small `xtask` orchestrating native OS tooling; evaluate cargo-packager where useful      |

Pin the tested Rust stable version, commit Cargo.lock, and perform `--locked` CI builds. Rust 1.98.1 is installed on the research machine; that is an environment observation, not a verified Kit minimum. Validate all platforms before selecting the toolchain pin.

Kit/framework code is Apache-2.0, with license/notice obligations. Zed's broader application has different licensing, so audit individual crates before reuse. Ghostex/Lumi are MIT, but their transitive/vendor dependencies still need inspection. Waku/Fintwind are GPL-3.0-only: take interaction ideas and general lessons, not source, assets, or close code adaptations into MIT Palot without an explicit licensing decision. Do not treat a missing GitHub license badge as permission to copy.

Track upstream patches separately with rationale and a removal condition. Prefer contributing fixes upstream. No floating branches in release builds, no mixed GPUI forks, and no silent vendoring of whole applications.

## 9. Implementation sequence

Estimates below are rough **engineering effort**, assuming Rust/GPUI familiarity, not delivery dates. Work is ordered by dependency and uncertainty; multiple contributors can parallelize only after the interfaces stabilize. Browser work is excluded from the normal sequence.

### Phase 0: feasibility and contract spikes (1–2 weeks)

Deliverables:

- Minimal Kit 0.7 app using one dependency graph, exact toolchain/lockfile, Linux Wayland/X11 and macOS runs, Windows compile/smoke where a runner is available.
- Retained multiline composer, Unicode/IME checks, menu/dialog focus, semantic tree, variable-height streaming transcript, theme/font sizing, and a small docking example.
- OpenCode 2.0.19 contract snapshot; generator trial including event/auth gaps.
- Direct Rust HTTP/SSE connection to an isolated service; local discover conformance fixtures.
- Tiny file/diff rendering and terminal VT candidate spike. Browser excluded.
- Baseline build time, idle memory/CPU, input/scroll behavior, and unresolved platform issues.

Exit gate: a reproducible real service connection and responsive native input/transcript on target platforms, with no permanent JS bridge or unexplained framework fork. Stop and revise the dependency choice if that fails. Local discovery/lifecycle gaps are recorded explicitly; do not fake completion with a hard-coded personal port.

### Phase 1: application foundation (1–2 weeks)

- Add the Cargo workspace and three crate boundaries, typed ownership keys, actions, error surfaces, local store, and isolated data roots.
- Build shell/sidebar/task header/composer/workbench frame and a component gallery using Palot tokens.
- Implement connection profiles, OS vault, status/retry UI, command palette, focus scopes, window state, and local read-only discovery.
- Add theme export tooling and initial Palot light/dark/system behavior.

Exit gate: opening/closing/settings/navigation cannot affect OpenCode execution, UI state survives redraws, and secret-bearing data stays out of projections/logs.

### Phase 2: OpenCode data plane (2–3 weeks)

- Generated/typed wire adapter, request queues, connection actors, auth/TLS policy, SSE, catalog hydration, session/project summaries, attention/request projections.
- Paginated transcripts, stale-response guards, buffered hydration, reconnect reconciliation, unknown event handling.
- Connection-scoped tests with duplicate IDs and paths; missing/offline/unsupported service UX.

Exit gate: two isolated servers update independently; disconnect/reconnect converges without duplicate text, lost requests, cross-server mutations, or service restarts.

### Phase 3: task loop and native alpha (3–5 weeks)

- New task/create/resume/rename, model+reasoning/agent selection, prompt/interrupt, queue/steer, attachments, draft switching/undo.
- Streaming text/reasoning/tools, child activity, forms/permissions with parent-origin handling, turn navigation and basic Markdown/copy.
- Triage pin/snooze/settle, search/filter/shelves, notifications, and recoverable failure states.
- Confirmed local Start only after the lifecycle spike establishes safe official control.

Exit gate: the first useful alpha workflow passes against real isolated OpenCode with the scripted provider, including pending requests and interrupted/reconnected streams. UI does not leak local Full access choices between tasks.

### Phase 4: review/workbench and daily-driver beta (3–5 weeks)

- File tree/read views, unified and split diffs, turn changes, selected-range context, worktree create/list/remove with confirmation, branch context, usage.
- Session fork/revert/restore, compaction/history/context and richer nested tool presentation.
- Selected terminal backend integrated with server-owned PTY/persistent PTY and reconnect.
- Theme catalog and typography fidelity, multi-window/drag-out task, keyboard/accessibility fixes.

Exit gate: native is usable for the task → review → steer loop, including remote files and terminal, without needing Electron for routine work. Missing advanced preview/browser/scheduler features remain documented.

### Phase 5: connection/settings parity (2–4 weeks)

- Full monitoring behavior, pairing import/show, SSH, connection diagnostics/recovery, integration/OAuth, MCP/config/agents/models/commands/skills/reference settings.
- Explicit Start/Restart/runtime capability handling; broaden certified runtime compatibility based on evidence.
- User-triggered data import with secure credential handling and rollback-safe native storage.

Exit gate: all supported destinations preserve ownership across navigation, uploads, background monitoring, window detachment, reconnect, and auth renewal. No remote-to-local fallback.

### Phase 6: remaining non-browser parity (4–6 weeks, scope-dependent)

- Runtime release check/download/verify/upgrade flows with separate startup consent.
- Scheduled automations, host exclusivity, occurrence recovery, attention/run history; optional tray/background behavior.
- Tailscale web-access controls only through explicit owned configuration actions.
- Advanced preview formats/math/Mermaid, system appearance/Omarchy parity, diagnostics and remaining native OS integration.

Exit gate: a reviewed parity checklist lists every remaining difference. No duplicate schedules, unsafe runtime replacement, or changes to desktop/SSH/network configuration without explicit action.

### Phase 7: release qualification (2–3 weeks, partly continuous)

- Clean-machine packages, signed/notarized macOS when credentials are authorized, Windows installer/portable checks, Linux packages and desktop integration.
- Signed update artifact verification, channel isolation, backward-safe app-data migrations, crash/log privacy.
- Real GPU performance and accessibility qualification on supported OS/compositor/hardware combinations.
- Electron/native side-by-side fixtures and a user-reviewed daily-driver acceptance pass.

Exit gate: native has a stated support matrix, reproducible builds, tested upgrade/rollback behavior, and explicit feature gaps. Electron remains available until a separate replacement decision.

Phases 0–3 total roughly 7–12 engineering weeks for a useful alpha. Phases 0–5 total roughly 12–21 for a broader beta. The full listed non-browser sequence is roughly 18–30, with significant uncertainty in native input/terminal/platform and settings/scheduler parity. These are planning ranges, not promises; re-estimate after Phase 0.

### Separately gated browser track

Begin only after daily-driver beta, unless browser parity becomes a requirement for launch. First produce a transport/security/platform prototype and cost estimate. Integration can require a GPUI patch or dedicated browser process; it is not included as a small final UI task.

## 10. Verification and performance

### Test layers

1. **Core behavior tests:** ownership routing, attention priority, triage, turn projection, stale generations, overlapping hydration, queue/steer results, migration, and scheduler behavior when introduced.
2. **Transport contract tests:** generated adapter against synthetic wire fixtures and a local HTTP/SSE/WebSocket server. Include auth, response envelopes, encoded values, schema drift, stream failures, malformed frames, chunk splitting, cursor pagination, and cancellation.
3. **GPUI interaction tests:** retained composer, keyboard/focus, disabled mutations, request reply routing, scroll anchoring, split resize, native selection, accessibility properties.
4. **Isolated real-service E2E:** reuse the current scripted OpenAI-compatible provider and scenario intent. Start a real pinned OpenCode with disposable XDG/database/workspace/vault state, then drive the native app through its GPUI test bridge or OS accessibility automation.
5. **Real-platform acceptance:** pixels, IME, clipboard, file dialogs, screen readers, materials, DPI, GPU/compositor behavior, install/update, and process cleanup.

Keep the existing service/provider harness where useful, but replace Electron/Playwright assumptions. Native has no DOM or CDP. A development-only scenario bridge may dispatch typed UI actions and inspect rendered semantic state; it must be loopback/owner-authenticated and excluded from shipping binaries. Real native input checks remain necessary. [P8]

Prioritize the existing regression scenarios: multi-connection, subagent requests/status stability, composer drafts/pending edits/undo, compaction steer, permission presets, worktree lifecycle, model/provider identity, transcript paging/scrolling, settings failures, and attachment cancellation.

### Planned commands

These are commands to introduce with the workspace/xtask, not commands run during this planning task:

```sh
cargo fmt --manifest-path apps/native/Cargo.toml --all --check
cargo check --manifest-path apps/native/Cargo.toml --workspace --locked
cargo clippy --manifest-path apps/native/Cargo.toml --workspace --all-targets --locked -- -D warnings
cargo test --manifest-path apps/native/Cargo.toml -p palot-core --locked
cargo test --manifest-path apps/native/Cargo.toml -p palot-opencode --locked
cargo test --manifest-path apps/native/Cargo.toml -p palot-native --locked
cargo run --manifest-path apps/native/Cargo.toml -p xtask -- e2e smoke
cargo run --manifest-path apps/native/Cargo.toml -p xtask -- e2e multi-connection
cargo run --manifest-path apps/native/Cargo.toml -p xtask -- contract check
```

Enable Kit `test-support` only in test/dev dependency paths. Its test harness can change redraw behavior, so performance/package builds must not accidentally inherit that feature. Check the release feature graph, not just debug screenshots. [S3]

### Measurement plan

Benchmark Electron and native with the same synthetic workload, service version, display/hardware, appearance, and instrumentation settings. Report cold/warm app launch separately from OpenCode service start and initial hydration.

Workloads:

- Idle empty workspace and idle populated Inbox.
- Thousands of summary rows across two monitored connections, no full background transcripts.
- A long conversation with at least 10,000 mixed text/tool/reasoning rows and lazy older pages.
- Several simultaneous streams while typing, scrolling old history, resizing, and switching tasks.
- Large diff/file content and terminal output with bounded scrollback.
- Reconnect, pagination, and repeated task/window opening to detect retained memory.

Record frontend RSS/private memory and GPU/child helpers where observable, total agent-stack memory separately, idle CPU/wakeups, frame-time distribution, input latency, stream-to-paint latency, hydration time, and build size/startup.

Initial target budgets, to calibrate after Phase 0: p95 visible UI work within a 16.7 ms frame on the agreed 60 Hz reference machine; p95 input-to-paint under 50 ms during concurrent streams; p95 stream-to-visible update under 100 ms under the fixture load; no continuous repaint loop when idle; bounded memory after repeated navigation. These are proposed engineering gates, not measured results or universal device guarantees.

Keep frontend-only memory improvement as a measured comparison, not an arbitrary MB promise. GPUI logical/headless tests and private software-compositor E2E do not establish native GPU performance.

## 11. Risks and decision gates

| Risk                                                 | Mitigation / gate                                                                                                                                            |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| GPUI/Kit API churn or incompatible forks             | Pin one snapshot graph; compile every platform; isolate framework-facing code; upgrade intentionally.                                                        |
| No official Rust service/client SDK                  | Direct official HTTP contracts, official event export, small discovery conformance adapter; escalate unsupported lifecycle behavior instead of inventing it. |
| Missing event/auth schema detail in OpenAPI          | Supplement from pinned official packages/source; test against real service; retain provenance.                                                               |
| Snapshot/live overlap loses or duplicates content    | Generation fences, per-resource reconciliation, tombstones, overlap fixtures, targeted authoritative refresh; do not claim replay support.                   |
| Remote ownership regression                          | Typed profile/session/location keys from day one, duplicate-ID E2E, fail closed on offline/switch.                                                           |
| Native input or cross-row selection gap              | Phase 0 IME/selection spike; use Base interaction primitives; treat a failure as a product blocker.                                                          |
| Terminal native build/API complexity                 | Compare two VT models early; server PTY ownership invariant; lock the chosen renderer and test packaging.                                                    |
| Browser recreates Electron's cost and attack surface | Separate gate, default external handoff, explicit server networking and process isolation requirements.                                                      |
| Accessibility appears in tests but fails on OS       | Actual screen reader/native inspection per platform, alongside semantic/focus tests.                                                                         |
| Automation migration duplicates execution            | Import disabled; single host/occurrence ownership before schedule enablement.                                                                                |
| Themes look similar but code colors/layout diverge   | Shared semantic exports, fixture-based review, document syntax-engine differences.                                                                           |
| Scope turns into a second agent platform             | Keep OpenCode authoritative; no daemon/provider-neutral engine without a new requirement.                                                                    |
| Licensing contamination                              | Ideas-only GPL references; source/dependency/license review before reuse.                                                                                    |

## 12. First implementation batch

After implementation is authorized, start with one bounded batch:

1. Add `apps/native/` with Kit 0.7.0, a tested Rust pin, Cargo.lock, and the three crates.
2. Add a Palot-themed shell fixture, retained multiline composer, message scroller, and focus-managed model picker.
3. Export pinned OpenCode request/event contracts and document the generator's uncovered cases.
4. Connect Rust to an isolated 2.0.19 service and implement read-only local discovery from official evidence.
5. Demonstrate prompt → streamed reply → permission/form reply → interrupt → reconnect with deterministic fixtures.
6. Capture Linux/macOS behavior and Windows build evidence, dependency/license graph, and initial performance/input issues.

Do not start by porting the whole sidebar/settings catalog, building a custom terminal/browser, or deleting Electron. The vertical slice decides whether the selected foundation is worth scaling.

## Sources and evidence

External sources were checked on 2026-10-02. Commit links freeze the researched source where possible; release/source claims are distinguished from build/run verification.

### External

- **[S1] Official GPUI:** [site](https://gpui.rs/), [README at researched Zed commit](https://github.com/zed-industries/zed/blob/c83abe7d0e060de08db386fbf86f7e95bfe6cb09/crates/gpui/README.md), [GPUI manifest/license](https://github.com/zed-industries/zed/blob/c83abe7d0e060de08db386fbf86f7e95bfe6cb09/crates/gpui/Cargo.toml).
- **[S2] GPUI Kit:** [v0.7.0 release](https://github.com/longbridge/gpui-kit/releases/tag/v0.7.0), [release manifest](https://github.com/longbridge/gpui-kit/blob/v0.7.0/Cargo.toml), [Kit API/features](https://github.com/longbridge/gpui-kit/blob/v0.7.0/crates/kit/Cargo.toml), [current researched README](https://github.com/longbridge/gpui-kit/blob/3467e647600290343885b500bd7464057e334d18/README.md), [crates.io publication](https://crates.io/crates/gpui-kit/0.7.0), [Community Edition](https://github.com/gpui-ce/gpui-ce/blob/c6b17e616a35271183ab49f0da1890ee81953a99/README.md).
- **[S3] Waku:** [website](https://waku.sh), [manifest](https://github.com/egoist/waku/blob/10bcd728c9b2f07d664cfece3c8c870d3418ddd2/Cargo.toml), [transcript implementation](https://github.com/egoist/waku/blob/10bcd728c9b2f07d664cfece3c8c870d3418ddd2/src/app/transcript_view.rs), [Rust V2 discovery/event ownership comparison](https://github.com/egoist/waku/blob/10bcd728c9b2f07d664cfece3c8c870d3418ddd2/crates/waku-core/src/opencode_service.rs).
- **[S4] Fintwind:** [README / platform, V2 pin, architecture and licensing](https://github.com/roketskiy/fintwind/blob/5a6885badf3c2a7c0739cac7b8be0025ac22f69b/README.md).
- **[S5] Ghostex:** [repo](https://github.com/maddada/Ghostex/tree/270da410af86aa4d7875bdc8637cc0795ffa581c), [desktop manifest and native integration choices](https://github.com/maddada/Ghostex/blob/270da410af86aa4d7875bdc8637cc0795ffa581c/apps/desktop/Cargo.toml).
- **[S6] Lumi:** [repo](https://github.com/CES-Ltd/Lumi/tree/a5e829cdd0eda7eab26b2d1f31095f64fdcff5d7), [desktop dependencies](https://github.com/CES-Ltd/Lumi/blob/a5e829cdd0eda7eab26b2d1f31095f64fdcff5d7/apps/lumi-gpui/Cargo.toml), [event bus](https://github.com/CES-Ltd/Lumi/blob/a5e829cdd0eda7eab26b2d1f31095f64fdcff5d7/apps/lumi-gpui/src/event_bus.rs).
- **[S7] AgentX:** [manifest at researched commit](https://github.com/linlumos-ai/agentstudio/blob/4fb3424521c1f11f9e6503639d2b9be7edeaf5dc/Cargo.toml). The GitHub metadata's last push predates some repository/search wording; use source dependencies as evidence, not freshness claims.
- **[S8] Zedra:** [product/platform description](https://zedra.dev), [source repository](https://github.com/tanlethanh/zedra). Adjacent mobile inspiration only.
- **[S9] Kit Wry limitations:** [v0.7.0 webview README](https://github.com/longbridge/gpui-kit/blob/v0.7.0/crates/webview/README.md).
- **[S10] GPUI terminal candidate:** [gpui-term manifest](https://github.com/sxhxliang/gpui-term/blob/ui/Cargo.toml). Floating branch reference; recheck revision/license/build compatibility during spike.
- **[S11] Native accessibility:** [Kit guide at v0.7.0](https://github.com/longbridge/gpui-kit/blob/v0.7.0/website/docs/accessibility.md), [Zed accessibility source guide](https://github.com/zed-industries/zed/blob/c83abe7d0e060de08db386fbf86f7e95bfe6cb09/crates/gpui/src/_accessibility.rs).
- **[S12] Official OpenCode V2 HTTP contract:** [API](https://opencode.ai/v2/docs/api), [public OpenAPI](https://opencode.ai/v2/openapi.json). Inspected event description, `V2EventEncoded`, SSE failure metadata, auth declarations, session creation and message pagination.
- **[S13] Official OpenCode V2 client/service:** [client guide](https://opencode.ai/v2/docs/build/client), [service diagnostics and file locations](https://opencode.ai/v2/docs/troubleshooting). No official Rust SDK found in these guides.
- **[S14] Kit message scrolling and tested consumer patterns:** [MessageScroller source](https://github.com/longbridge/gpui-kit/blob/v0.7.0/crates/component/src/message_scroller.rs), [executable recipes](https://github.com/longbridge/gpui-kit/blob/v0.7.0/examples/ai_recipes/README.md).

### Palot and installed official package evidence

- **[P1]** [Current architecture](architecture.md), `apps/desktop/src/shared/opencode-contract.ts`, `apps/desktop/src/main/opencode-runtime-lifecycle.ts`.
- **[P2]** [Palot design](../DESIGN.md), especially sidebar density, composer grouping, descendant requests, approval presets, and connection context.
- **[P3]** `apps/desktop/src/shared/appearance-contract.ts`, `apps/desktop/src/renderer/lib/theme-catalog.ts`.
- **[P4]** [Current accessibility scope](../ACCESSIBILITY.md). No full conformance claim is made for Electron or this proposed native app.
- **[P5]** [Multi-connection behavior](multi-connection-overview.md), including summary-only background processing and connection-scoped ownership.
- **[P6]** [Current runtime/compatibility/browser policy](opencode-runtime.md), `apps/desktop/package.json`.
- **[P7]** Installed official `@opencode/client` **2.0.19**: `node_modules/@opencode/client/dist/service.d.ts`, `dist/promise/service.js`; official events: `node_modules/@opencode/protocol/dist/groups/event.js`. The available upstream reference checkout was `1ddb0873aee50d209d1a8d7f91b89c5daf692d49` and has older client layout/contracts, so installed pinned artifacts and current official V2 docs take priority for this plan.
- **[P8]** [Existing isolated desktop harness/scenarios](desktop-testing.md), [development loop](agent-development.md), `apps/desktop/test/e2e/`.

No app code, dependencies, service settings, desktop configuration, or user data were changed for this research. Existing unrelated work stays in place.
