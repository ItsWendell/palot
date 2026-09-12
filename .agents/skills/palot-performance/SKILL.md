---
name: palot-performance
description: Measure and improve Palot desktop runtime performance. Use for reported slowness or regressions; profiling CPU, memory, long tasks, React commits, style/layout/paint cost, GPU compositing, frame pacing, or streaming latency; changing the performance harness; React Scan or Compiler experiments; or performance budgets. Use test-palot-desktop for non-performance UI QA.
---

# Palot Performance

Use the smallest loop that can prove or disprove the suspected cost. Preserve UX, motion, and native/CSS material unless measurements show a concrete problem and the cheaper rendering path still looks right.

Read repository-root `../../../docs/desktop-testing.md` for harness commands and measurement contracts. Read `references/main-thread-budget.md` for current main-thread investigation rules; historical measurements are not evidence for the current checkout.

## Choose The Loop

- Static React health: run `bun run perf:doctor` for changed code and `bun run perf:react-check` for React Compiler compatibility diagnostics.
- Full static baseline: run `bun run perf:doctor:full`. Treat it as advisory until the documented baseline has been paid down.
- Deterministic native measurement: run `bun run perf:e2e`. It builds an isolated Electron app, warms a long transcript switch, records frame intervals, long tasks, CDP metrics, Electron process CPU/memory, and streaming latency, then retains private artifacts.
- Input contention: run `bun run perf:input`. It types a real draft while the visible session and background sessions stream. Use it to evaluate responsiveness, not only throughput.
- Batch-size contention: `bun run perf:batch:steady` and `bun run perf:batch:burst` use identical numbered text with different provider arrival clustering. Inspect actual renderer batch sizes and synchronous callback durations alongside typing, freshness, and throughput; the transport timer is not a processing budget. These are different workloads, not a product A/B comparison.
- Navigation/cancellation contention: run `bun run perf:interactions`. It checks trusted session switches, wheel-up, a stable visible reading anchor, return to latest, and Stop under four continuous streams. Per-action DOM milestones include existing fades and are not compositor presentation.
- Visual recording: `bun run perf:input:video` or add `--video` to a matching E2E command. Requires `ffmpeg`; retains renderer-only `video.mp4` and capture metadata. Recording adds observer overhead, is not presented-frame/FPS evidence, and must not be compared to unrecorded benchmarks.
- Streaming geometry: `bun run perf:stability` (or `perf:stability:video`) adds bounded active-turn/composer/scroll geometry sampling. Use it for bottom-follow jumps, not as a clean input benchmark. Inspect rAF and resize-observer phases separately; transient DOM measurements are not presented-frame proof.
- Streaming throughput and scroll correctness: run `bun run perf:parallel`; use `bun run perf:parallel:trace` for whole-app attribution. `bun run perf:parallel:memory` repeats accumulating workloads with forced GC to investigate retention, not independent latency samples.
- Style attribution: run `bun run perf:selectors`. Phase-separated React render attribution: run `bun run perf:scan:render`. Both add observer overhead and are not neutral benchmarks.
- Repeated comparison: `bun run perf:compare <baseline.json...> -- <candidate.json...>` checks matched report metadata and summarizes run-level medians/ranges. It requires at least two independent runs per group (five recommended), rejects legacy/memory-cycle reports, and does not launch tests or declare regression budgets.
- Attribution trace: run `bun run perf:trace`. It repeats the deterministic scenario with React's profiling build and writes `performance-trace.json` beside `performance.json`.
- Render overlay: enable React Scan in Settings > Diagnostics or run `bun run dev:scan`. The dev client starts hidden; use `PALOT_REACT_SCAN=1 bun run dev:visible` for visible inspection without taking focus, and `PALOT_REACT_SCAN=1 bun run dev:focus` only when focus behavior matters. Palot reloads so React Scan can install before React. Use it to find candidate rerenders, then disable it before measuring.
- Compiler experiment: run `bun run perf:compiler` for whole-renderer `infer` mode or `bun run perf:compiler:annotation` to validate opt-in mode. The normal build does not enable React Compiler.

The deterministic harness is the default. Load `test-palot-desktop` before live native inspection or screenshots.

## Measurement Contract

1. Use a document-visible window for frame data. Performance runs show it inactive by default so they do not steal keyboard focus; use `--focus` only when focus behavior is part of the test. Hidden or fully occluded Electron windows are throttled and cannot provide a valid FPS baseline.
2. Compare the same scenario, window size, display scale, power state, hardware, build mode, and glass setting.
3. Warm the flow before recording. Report medians across repeated runs when proposing a budget or claiming an improvement.
4. Keep React Scan, DevTools overlays, paint flashing, and verbose logging off during benchmark runs. They are investigation tools, not neutral observers.
5. Keep Palot's own diagnostics dashboard and overlay off during benchmark runs. Their collector is demand-driven, but active sampling still adds observer cost.
6. Keep traces and screenshots under the primary checkout's `.local/` directory. Treat them as private because traces can contain rendered text and source paths.
7. Change one rendering variable at a time. For blur work, compare the normal tier and `PALOT_DISABLE_GLASS=1`, then isolate individual CSS backdrop surfaces.
8. State build mode with every result. Development, production, and React profiling builds have different overhead.

## Read The Report

`performance.json` contains:

- `sessionSwitch.targetVisibleAtMs`: click to useful target transcript.
- `interaction.page`: document visibility and Chromium's internal `document.hasFocus()` state.
- `interaction.runIdentity`: revision/dirty state, host hardware/load context, declared versions, runner versions, scenario, and explicit build/trace/material controls. Power, refresh rate, and occlusion still require controlled manual recording.
- `interaction.measurementWindow`: renderer monotonic start/end and time origin, correlated with `palot:measurement:start` / `palot:measurement:end` trace marks.
- `interaction.collectors` and `interaction.droppedEntries`: distinguish observing, disabled, unsupported, or failed collectors and truncated samples. Missing instrumentation never means zero work.
- `interaction.inputTimings`: Event Timing stages and per-interaction duration summaries. Entries are thresholded at 16 ms, quantized, and limited to supported discrete interactions; these are not page-level INP or a distribution of every keystroke.
- `interaction.longAnimationFrames`: optional rendering/script attribution without React Scan; enabled by the input scenario. Entries and script attribution are bounded.
- `interaction.frames`: p50, p95, maximum frame interval, and counts over 25/50/100 ms.
- `interaction.longTasks`: count, total duration, maximum, and the 20 longest entries.
- `interaction.reactCommits`: profiling-build React commit count and actual/base render durations.
- `interaction.browserMetrics.delta`: CDP task, script, layout, style, heap, node, document, frame, and listener deltas.
- `interaction.batchProcessing`: opt-in (`captureBatchProcessing`) synchronous event-subscriber timing, event counts, and text-delta UTF-16 lengths. Only active in harness builds during measurement. The first 2,048 numeric samples are retained; complete counts/total/max continue after truncation. `disabled`/`unavailable` is not zero work. This excludes later React rendering, asynchronous request completion, and paint.
- `interaction.appMetrics`: on-demand Electron `app.getAppMetrics()` snapshots, host-window focus/visibility, interval CPU, working set, GPU feature status, and hardware acceleration state.
- `interaction.streamingLatency`: commit-cursor-scoped receive-to-React-commit samples, owner identity, applied batch count, oldest pending age, and retention loss. Latest-batch stage timings alone can hide an older pending batch. Top-level `streamingLatency` in older scenario reports remains a run-wide buffer.

CPU percentages from Electron are interval values since the prior snapshot. Memory values from Electron are KiB. CDP duration metrics are seconds, so convert deltas to milliseconds when presenting them.

Use `interaction.appMetrics.*.window.focused` for OS window focus. `interaction.page.documentHasFocus` is Chromium renderer state and can remain true for a non-focusable Electron window.

## Diagnose In Order

1. Reproduce with the deterministic scenario and keep its report.
2. Decide whether the failure is React work, JavaScript computation, style/layout, paint/compositing, GPU material, memory retention, or OpenCode transport latency.
3. Use `perf:trace` only when the aggregate report cannot attribute the cost.
4. Use React Scan or React DevTools to identify component-level candidates after the trace points at React rendering.
5. Inspect source subscriptions, identity preservation, virtualization boundaries, observers, animation loops, and backdrop-filter bounds before adding memoization.
6. Make the smallest change that attacks the measured cause.
7. Repeat the same run without diagnostic overlays and compare against the retained baseline.

Read `references/poll-driven-renders.md` when polling appears to trigger expensive React work. Read `references/react-compiler.md` before changing compiler configuration or adopting compiled components.

## Main-Thread Budget

1. Eliminate irrelevant computation before scheduling it differently: inspect whole-store scans, subscription fan-out, settled Markdown prefixes, and disabled diagnostics.
2. Measure input response, streaming freshness, throughput, and CPU together. Fewer commits or IPC batches alone do not prove an improvement.
3. Keep batching bounded in size and age. Only split at safe boundaries that preserve ordering and atomic publication; prefer time budgets over fixed item counts when item costs vary.
4. `await Promise.resolve()` is a microtask, not a rendering yield. rAF runs before rendering; it is not a general background-work queue. React transitions do not make arbitrary synchronous computation interruptible.
5. Defer presentation, not authoritative correctness. Never drop OpenCode deltas, permissions, or lifecycle events to hide backpressure.
6. Workers need an end-to-end cost model including serialization, cancellation, stale results, and applying the result. Moving blocking work into Electron's main process is not a free optimization.
7. Preserve motion and material. Transform/opacity can avoid layout but do not guarantee cheap raster/compositing; avoid blanket `will-change`. Virtualization does not automatically stop offscreen parsing, subscriptions, or animation preparation.
8. Keep measurement cheaper than the workload. Use stable marker references instead of per-frame descendant scans; separate detailed geometry assertions from low-overhead input measurement. Zero 50 ms long tasks or healthy rAF cadence does not prove good 120 Hz presentation.
9. For streaming scroll defects, verify visual stability separately from input throughput. Coordinate measured virtual geometry and bottom-follow correction; do not hide a delayed correction with a fixed status overlay, smooth scrolling, or a longer polling loop. Preserve explicit scroll-up and history anchors.
10. Summary cards should not subscribe to whole transcripts just to show status or elapsed time. Use lifecycle/tool timestamps, isolate clock subscriptions to timer leaves, and share a demand-driven visible-document clock. Verify that timer ticks do not rerender the card and that unrelated message deltas do not invalidate it. `subagent-card-stability --visible --keep` checks the native summary/timer behavior; it is a correctness scenario, not a latency benchmark.

## Completion Gate

A performance change is complete when the exact scenario and build mode are recorded, before/after artifacts exist, UX and visual behavior are unchanged or explicitly approved, the smallest relevant correctness checks pass, and the result identifies remaining uncertainty without claiming more than the data proves.
