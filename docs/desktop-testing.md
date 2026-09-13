# Desktop Testing

Palot has two desktop test paths. Choose the narrowest one that proves the change.

For setup, worktree isolation, focused checks, and debug attachment, see the
[agent development loop](agent-development.md).

| Path                                       | OpenCode state      | Credentials    | Window            | Use for                           |
| ------------------------------------------ | ------------------- | -------------- | ----------------- | --------------------------------- |
| `bun run test:e2e -- <scenario>`           | Ephemeral           | Dummy          | Hidden            | Agent and CI testing              |
| `bun run test:e2e -- <scenario> --visible` | Ephemeral           | Dummy          | Visible, inactive | Watching a deterministic scenario |
| `bun run dev`                              | Shared user service | Real user auth | Hidden            | Background live integration       |
| `bun run dev:visible`                      | Shared user service | Real user auth | Visible, inactive | Live visual and interaction QA    |
| `bun run dev:focus`                        | Shared user service | Real user auth | Visible, focused  | Focus behavior and human review   |

## Deterministic E2E

The E2E harness builds Palot, then starts:

1. A vendored OpenAI-compatible test LLM.
2. A real OpenCode service with isolated XDG directories and inline test config.
3. A real Electron process with hidden UI and temporary Palot state.

The harness uses the host display and does not provision a private display server.
Linux needs a working display session even for hidden runs. Add `--visible` to
show an inactive window or `--focus` to show and focus it. An inactive window can
still reflow a tiling desktop; `showInactive()` is not display isolation.
`--profile` and `--showcase` also imply visibility.

The harness drives OpenCode through the official client and asserts the rendered Palot state with Playwright. Ordinary successful runs remove all state. Failed runs and runs using `--keep` retain artifacts under the primary checkout's `.local/desktop-e2e/` directory; `perf:e2e` and `perf:trace` retain their reports by default.

```bash
bun run test:e2e --help
bun run test:e2e:list
bun run test:e2e -- smoke
bun run test:e2e -- diagnostics
bun run test:e2e -- diagnostics-react-scan
bun run perf:scan:render
bun run test:e2e -- subagent-success
bun run test:e2e -- subagent-requests --visible --keep
bun run test:e2e -- subagent-card-stability --visible --keep
bun run test:e2e -- composer-draft-switch
bun run test:e2e -- composer-pending-edit-switch
bun run test:e2e -- composer-undo-redo
bun run test:e2e -- compaction-pending-steer
bun run test:e2e -- worktree-lifecycle
bun run test:e2e -- model-provider-identity
bun run test:e2e -- composer-permissions --visible --keep
bun run test:e2e -- composer-context --visible --keep
bun run test:e2e -- theme-presets --visible --keep
bun run test:e2e -- settings-plugin-failure
```

Use `--keep` to retain a successful run's artifacts.

The default isolated service uses the pinned OpenCode client version. To check
backward compatibility with a reviewed beta or another supported stable 2.x
runtime, provide both its exact `OPENCODE_BIN` and
`--opencode-version <version>`. This changes only the isolated test service, not
the generated client or shared service. Unknown prereleases and other majors
are rejected by this harness override.

`opencode-release-channel` verifies native Stable/Beta preference persistence,
reload hydration, actual versus next-start version labels, keyboard interaction
and narrow/wide light/dark layouts. It checks that the isolated service retains
the same PID/version throughout. It does not contact update feeds or download
executables; downloader validation is a separate integration check.

`opencode-runtime-acquisition` is an opt-in network check for public packages that
do not bundle OpenCode. It uses the isolated service and dummy LLM without model
calls. Native settings controls check the official Stable feed, download a
compatible stable 2.x fallback, verify the main-owned prepared selection and reload
hydration, then reset the selection. Service PID/version must stay unchanged.
It refuses unverified offers rather than bypassing consent. The manager verifies
the archive checksum and executable version; the scenario allows 180 seconds for
the bounded 120-second archive fetch plus extraction and verification.

```sh
PALOT_E2E_ALLOW_RUNTIME_DOWNLOAD=1 bun run test:e2e -- opencode-runtime-acquisition \
  --executable /absolute/path/to/packaged-palot --keep
```

Without the explicit opt-in it fails before starting the isolated service. The
download stays in the run's private app cache, never the host CLI installation.
`--keep` retains that cache and `opencode-runtime-acquisition.json`; ordinary
successful cleanup removes them. This does not test starting the downloaded service.

`subagent-requests` creates a real parent → child → grandchild tool chain against
the isolated service. It answers the grandchild's question from the parent,
checks simultaneous child question/permission ownership, reload hydration and
direct child navigation, and verifies all three sessions continue. Light/dark,
wide/narrow screenshots check the request area at 1440×900 and 920×640. Requests are hydrated through the existing
attention cache; this scenario is not a performance benchmark. The unit-level
subagent card probe separately verifies that pending-request badges ignore
transcript deltas while retaining lifecycle updates and the isolated elapsed clock.

`composer-permissions` checks Defaults/Full access confirmation and cancellation,
official session-rule persistence and live Custom updates, reload hydration, and
preservation of already-pending permission requests. It also changes reasoning
through the single model/effort popover and checks the right-side controls at
1440×900 and 920×640, with light/dark screenshots and keyboard dismissal. The
scenario uses an isolated service and no model calls; it does not validate
real-provider behavior or macOS runtime signing.

`composer-context` checks matching rendered typography, height, spacing, and icon
size for the new-task project, checkout, and source-branch controls. It captures
light/dark layouts at 1440×900 and 920×640 and checks picker dismissal and switching
between checkout and worktree modes without creating a session or calling a model.

`theme-presets` hydrates saved Codex preferences and exercises built-in palette
selection and native persistence in both color modes, with screenshots. It is a UI
integration check, not a performance measurement.

For transcript history and responsive navigation:

- `bun run test:e2e -- transcript-prepend-restoration --visible --keep` checks
  automatic older-page loading from an upward wheel gesture, the reading anchor,
  and duplicate requests. Its synchronous request-log/geometry probe is diagnostic
  instrumentation, not a neutral performance benchmark.
- `bun run test:e2e -- transcript-rail --visible --keep` checks bounded prompt
  markers, history navigation, draft retention, and compact-pane hover/focus reveal.
  It also checks that a short latest exchange selects the latest marker at the
  actual bottom while the previous response remains at the reading line, then
  verifies the highlight when scrolling away and returning. The rail reveals
  its complete end; interior following uses a comfort band rather than continuous
  centering. `transcript-rail-streaming --profile --visible --keep` exercises this
  navigation during a real isolated stream and retains a rail-specific smoke report.
  Narrow and wide renderer viewport checks exercise responsive CSS; they do not
  establish compositor presentation timing or native minimum-window constraints.
- Use `perf:stability` separately for streaming Working/composer settlement, and
  `perf:input` without video/trace for clean input measurements.

Use `--inspect` to keep an isolated scenario alive. The harness prints an explicit `agent-browser connect '<renderer-websocket>'` command and writes the browser port plus renderer WebSocket to `instance.json`. Connect to the renderer WebSocket because Electron does not support the new-target command that this `agent-browser` version sends to browser-level CDP endpoints. Add `--visible` only when the user wants the native window shown. Visible E2E windows use `showInactive()` so they do not take keyboard focus; add `--focus` only for a focus-specific test. Stop the retained command with Ctrl-C; cleanup runs on exit.

Use `--inspect-on-failure` to retain a failed renderer for inspection. It only
waits when a renderer is still attachable, keeps the isolated service alive, and
preserves the failed exit status after Ctrl-C. Startup failures still keep their
artifacts. An atomic, owner-only `instance.json` exists before the build and tracks
phase, PIDs, ports, failure, and cleanup. Build and Electron console output stay
in `build.log` and `electron.log`; application logs stay in `logs/`.

Signals cancel requests, stop owned child processes, and close active model
streams through one awaited cleanup path. Process cleanup first sends SIGTERM to
the leader and allows up to five seconds for graceful shutdown, so Electron can
close its own GPU/network children without triggering fatal recovery attempts.
Remaining owned process groups receive SIGTERM, then SIGKILL after two seconds.
Unexpected exit codes or signals (including teardown crashes) fail cleanup and
retain the run's evidence even if the scenario assertions passed.
Service startup is the exception to
prompt cancellation: the official SDK has no abort or contender handle, and can
take 120 seconds to settle. Failed startup can leave cleanup unverifiable for an
unregistered contender. Such runs report `cleanup.status: "uncertain"` and retain
`service-startup-error.log`. See the [agent development loop](agent-development.md)
for the ownership boundary and upstream limitation.

Performance runs show an inactive, non-focusable window because Chromium throttles hidden or occluded renderers. The report records document visibility and Electron's `BrowserWindow.isFocused()` state, and refuses frame measurement when the document is hidden. Chromium's `document.hasFocus()` is retained separately and must not be read as proof that macOS activated the test app.

Performance measurement also refuses to start while the in-app diagnostics collector, overlay, or React Scan is active. Use those tools to find candidates, then turn them off before retaining a benchmark.

### Input responsiveness under streaming

`bun run perf:input` runs `input-streaming-performance --profile`: four routed
sessions stream text, reasoning, tools, and Markdown while native keyboard events
enter an unsent draft. The test requires real text deltas from each session during
typing, exact draft prefixes and final contents, no focus loss, and visible
transcript advancement. Composer initialization is warmed before measurement.
It omits the parallel benchmark's heavy per-frame scroll probe; use
`perf:parallel` for bottom-follow correctness.

The report adds Event Timing stages, optional LoAF script/layout attribution,
collector support/failure and truncation, monotonic measurement marks, and scoped
oldest-pending streaming latency. Event Timing excludes fast events below its
requested 16 ms threshold and quantizes durations; it is not page-level INP.
The useful-draft milestone is an rAF observation, not proof of compositor
presentation. This scenario covers click focus and typing; use the separate
interaction scenario below for wheel, navigation, and Stop. Keep diagnostics and
Scan disabled.

Use `bun run perf:compare <baseline.json...> -- <candidate.json...>` to compare
retained independent runs (minimum two per group; five recommended). The command
checks scenario, fixture, host, build, viewport, runtime and collector metadata,
then reports run-level median/min/max rather than pooled-event percentiles. It
does not launch benchmarks or set regression budgets. Source revision may differ
between groups, not within a group. Dirty contents, display refresh, power state,
host load and occlusion still need manual control; matching metadata does not
prove those conditions were identical. Memory-cycle arrays and old reports
without `interaction.runIdentity` are intentionally rejected.

If the discovered `opencode2` is a shell wrapper that resolves through `$HOME`, it
may fail under the isolated E2E home. Pass `OPENCODE_BIN` with the absolute path
to the matching real executable; do not change the user's shared service.

### Batch size and main-thread contention

`bun run perf:batch:steady` and `bun run perf:batch:burst` isolate the article's
batching/splitting question from tools, reconnect, and network-request tuning.
Both use four real service sessions and the same 384 numbered text chunks per
session. The steady provider emits one content chunk every 20 ms; the burst
provider emits sixteen unchanged content chunks every 320 ms. Protocol envelopes
do not count as content chunks. Transport/service scheduling can change the actual
arrival pattern, so inspect measured renderer batches rather than treating the
scripted cadence as proof of renderer contention.

The opted-in `interaction.batchProcessing` collector records monotonic synchronous
subscriber duration, event count, and text-delta character count. OpenCode can
merge many provider chunks into one event, so the burst scenario requires at least
two renderer batches carrying 1,000 or more text-delta UTF-16 code units strictly
inside the keyboard interval. This is payload-burst evidence, not proof of many
distinct events. Both event clustering and payload size are retained.
The diagnostic retains at most 2,048 numeric samples, no payloads; total counts,
total duration and maximum duration continue if samples are dropped. `perf:compare`
rejects collector-mode mismatches and omits truncated batch percentiles rather than
silently interpreting missing samples as zero work. Later React/paint and async
request completion are outside this synchronous callback scope.

Both variants reuse trusted typing, exact draft prefixes/final value, focus and
interior transcript-progress assertions. After measurement they verify full
service output and the selected transcript's numbered ordering. They retain
`batch-input-performance.json` and, with `--profile`, `performance.json`.
`batch-measurement.json` is written before the final overlap/output assertions so
a failed assertion still retains the completed measurement.
No synthetic frontend events or user-service restarts are involved.

Compare each scenario against itself across product changes using `perf:compare`.
The steady-versus-burst contrast intentionally changes workload settings and must
not pass the matched A/B comparator or be labelled a product speedup.

### Wheel, navigation, and Stop under streaming

`bun run perf:interactions` runs `interaction-streaming-performance --profile`.
Four independently routed sessions stream long multi-paragraph responses after
warming both navigation directions. Trusted clicks/wheel events exercise session
switching, scroll-up, retaining a reading anchor, return to latest, and Stop.
Session-scoped event receipts prove surrounding concurrent streaming; very fast
actions can legitimately fit between two deltas. Stop additionally requires the
interruption event, inactive execution, and no further selected-session deltas or
provider emissions while the other sessions finish.

`interaction-streaming-performance.json` and `performance.json` retain bounded
per-action event-to-useful-DOM milestones, labelled pre/action/post stream counts,
common performance collectors, and cancellation evidence. Navigation milestones
include the existing surface fade; none of these timestamps are compositor paint
or INP. Cached-marker mutation/scroll/transition observers stop after each action;
there is no per-frame geometry sampling. The reading check compares a visible
text anchor: raw `scrollTop` can legitimately change when the virtualizer measures
content above it. `perf:compare` also summarizes the named action milestones and
does not generate numeric deltas for missing/failed probes.

### Renderer video

For active-turn bottom-follow regressions, `bun run perf:stability` runs the same
four-session typing workload with a separate geometry diagnostic;
`bun run perf:stability:video` also records it. `streaming-stability.json` retains
bounded, phase-labelled status/composer/turn/virtual-height and scroll samples.
These observer-heavy runs are not substitutes for clean `perf:input` runs. A DOM
sample, including a resize callback sample, is not proof that the intermediate
position was presented; correlate unexpected movement with the recording.
Assertions check post-spacer-update clearance and down-and-back movement, with
one CSS pixel of rounding tolerance, rather than treating every pre-correction
rAF/resize observation as a painted glitch. The scenario also wheels up and back
while streaming, then grows/shrinks the composer after measurement without sending.
For scrollable, fully measured tails, clearance must remain at the 16px dock
reserve in both directions, even when text/tool transitions replace the status
row. An overlap-only check would miss upward shifts or downward jumps that stop
short of the composer.

Add `--video` to any isolated scenario, or run `bun run perf:input:video` to
record the input-under-streaming workload. `ffmpeg` must be installed on PATH;
the runner checks this only when recording is requested, before building or
starting a service. Video implies a visible, inactive window and retained artifacts,
not React profiling or tracing.

The harness captures only the explicit Electron renderer with CDP screencasting,
from before scenario execution through its assertions. It does not capture other
applications, desktop chrome, audio, or the microphone. Encoding occurs after the
measurement, and `video.mp4` plus `video.json` are retained beside the report.
Normal failures also try to finalize the video before inspection or cleanup;
interrupted or over-limit captures can retain partial frame evidence rather than
claiming a complete recording. Capture is bounded to ten minutes, 18,000 source
frames, 512 MiB of source images, and eight pending frame writes. Exceeding a
limit fails the recording instead of silently returning a truncated success.

Video is for visual inspection, not FPS or compositor-presentation proof: CDP
provides frames on visual updates and the video holds them according to their
capture timestamps, not their delivery order. The 60 fps MP4 repeats frames;
it does not imply 60 distinct captured or presented frames each second.
Recording adds transport/encoding-preparation overhead even though
the final encode is offline. `PALOT_E2E_VIDEO` is recorded in performance identity;
the comparison command rejects mixing recorded and unrecorded runs. Never use a
recorded run as a clean performance baseline. Keep video and source paths private.

## Scenarios

### Native context-menu crash regression (Linux)

Native menus are outside the renderer DOM. The task-menu scenarios exercise Base
UI menus, not Electron's native edit/selection/link menus. For the Linux native
popup guard, run this small, service-free Electron fixture from the repository root:

```sh
umask 077
mkdir -p .local
qa_dir="$(mktemp -d "$PWD/.local/native-menu-XXXXXX")"
bun build apps/desktop/test/native-menu-smoke.ts --target=node --external=electron \
  --format=cjs --outfile="$qa_dir/main.cjs"
PALOT_MENU_SMOKE_DATA="$qa_dir/user-data" env -u ELECTRON_RUN_AS_NODE \
  node_modules/electron/dist/electron "$qa_dir/main.cjs"
```

This uses the pinned Electron binary and an isolated data directory, briefly shows
an inactive window, and starts no OpenCode service. It obtains a real Chromium
context-menu event, injects empty display geometry into the guard's screen query
and asserts no popup starts, restores the real screen query, then opens/dismisses
mouse and keyboard-source menus and verifies the renderer remains responsive.
It does not simulate a compositor hotplug or prove native menu placement visually.
The fixture exits nonzero on assertion failure, native crash, or timeout. A popup
cannot be safely reopened inside `menu-will-close`; the fixture lets native
teardown unwind before its next action.

For Linux installation shutdown, the opt-in native regression uses a temporary
Electron installation and isolated XDG state. It verifies only the main process
receives the quit request, asynchronous cleanup completes before replacement,
and shutdown exits cleanly without GPU fallback fatals:

```sh
TMPDIR=/tmp/opencode PALOT_TEST_LINUX_ELECTRON=1 bun run --cwd apps/desktop test \
  scripts/linux-install-lifecycle.test.ts scripts/linux-install-electron.test.ts
```

It does not replace or stop installed Palot. Without the opt-in variable, the
native test is skipped; the process-classification regression tests still run.

Scenarios live in `apps/desktop/test/e2e/scenarios.ts`. Prefer an existing scenario. Add one when a new protocol or UI state cannot be represented by the current set.

Each scenario declares:

- The user prompt sent through the real OpenCode API.
- Scripted model responses.
- The number of expected model calls.
- Observable Palot assertions.

The test LLM supports deterministic text, tool calls, HTTP errors, and explicit
output-token usage for throughput checks. It handles OpenCode title requests automatically.

Workflow scenarios live in `workflow-scenarios.ts` and use the same real service.
They cover task-scoped drafts, cancel/edit/resubmit of queued inputs, distinct
provider connections exposing one model ID, and an actual failing V2 plugin.
Deferred or rejected activation and plugin-inventory races use focused settings
integration tests. Settings queries own one capability each, so configuration and
plugin diagnostics can resolve while plugin-backed registries await activation.
Activation completion does not guarantee plugin success or finished resource
discovery. The installed contract emits `plugin.updated`, including removals;
there is no separate `plugin.removed` event.

`perf:scan:render` drives two long sessions through native tool projections, questions, subagents, hidden-session activity, switching, manual compaction, and continued work. It combines React Scan's imperative scanner with React Scan Lite commit reasons and correlates Lite commits with `long-animation-frame` entries. The phase report retains component counts, timings, prop/state/context/parent-cascade reasons, and slow-frame component subtrees. This extra instrumentation makes it an attribution tool, not a benchmark-neutral measurement.

### Subagents

Subagent scenarios script OpenCode's model-facing `subagent` tool, which drives the real child-session task runner. A successful delegation uses three model responses:

1. The parent calls `subagent` with `agent`, `description`, and `prompt`.
2. The child returns its result.
3. The parent returns its final response.

Assert both OpenCode behavior and Palot presentation: child status, description, child-session link, and final parent output. Add reverse-state scenarios for running, failed, or cancelled behavior when the change affects those states.

This proves protocol and UI behavior. It does not evaluate whether a real model makes a good delegation decision.

## Live Review

`bun run dev` connects to the normal shared OpenCode service and starts hidden so agent work does not cover or focus another app. Use `bun run dev:visible` when rendering, interaction, accessibility, screenshots, or visual inspection require a real visible window. Use `bun run dev:focus` only when focus behavior matters or the user explicitly wants a foreground launch. All three commands match OpenCode's TUI model: clients share sessions, auth, config, and models while sessions retain their project and worktree path.

Use live development when the user wants to inspect the app or the behavior depends on a real provider. Treat sessions as real user data. Create prompts only in an approved disposable session.

## Upstream

The test LLM is adapted from OpenCode's MIT-licensed test utilities. Its pinned source and update instructions are in `apps/desktop/test/e2e/UPSTREAM.md`. Reconcile it whenever Palot updates `@opencode/client`.
