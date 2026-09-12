# Main-thread budget

Inspired by [The Browser's Main Thread Is Expensive](https://kciter.so/posts/the-expensive-main-thread/en/).
Use its split / batch / prioritize / defer / compositor / worker / eliminate taxonomy as an investigation aid, not a prescription to build a custom scheduler.

## Choose the missing evidence

| Question                                           | First loop                                                    | Evidence to retain                                                                                   |
| -------------------------------------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Does streaming delay my typing?                    | `bun run perf:input`                                          | Exact draft/focus, genuine stream overlap, Event Timing, oldest pending commit age                   |
| Do navigation, wheel, or Stop lag under streaming? | `bun run perf:interactions`                                   | Trusted action-to-DOM milestones, surrounding stream receipts, reading anchor, verified cancellation |
| Is a warm transcript switch slow?                  | `bun run perf:e2e`                                            | Useful target visibility, monotonic window, frame cadence                                            |
| Do background sessions add CPU or rerenders?       | `bun run perf:parallel`, then a visible-only control          | Renderer reconciliation vs React vs style/layout; workload duration                                  |
| Does retained content leak?                        | `bun run perf:parallel:memory`                                | Post-GC history growth, DOM count, working-set plateau; not independent latency samples              |
| Which script or layout is blocking?                | Input LoAF collector, then matching `--trace` / `--app-trace` | Script/forced-layout attribution, compositor and presentation tracks                                 |
| Is the probe the hotspot?                          | Low-overhead run versus detailed geometry/trace capture       | Instrumentation cost, with identical content and build                                               |

## Optimization order

Use `perf:batch:steady` / `perf:batch:burst` for the batching-versus-task-size
question. They deliberately change provider clustering, so compare revisions
within each scenario rather than claiming one workload is a faster product build.

1. **Eliminate:** Narrow a subscription or avoid redoing unchanged work. In Palot, check graph transactions, connection-wide message maps, transcript-wide metadata, Markdown prefixes, and hidden views.
2. **Batch:** Amortize update overhead without letting queue age grow. Measure oldest pending work, not just the newest batch reaching a commit. Existing main-to-renderer batching already has an 8 ms window and a capacity flush.
3. **Split:** Use task boundaries only where partial progress is safe. A staged snapshot can be prepared in chunks, but publishing partial authoritative state may violate reconciliation invariants. No yield can interrupt a single synchronous parse call.
4. **Prioritize/defer:** Keep composer input and deliberate navigation responsive. Defer optional summaries and offscreen animation preparation, with cancellation/stale-result guards. Don't defer correctness-critical event admission indiscriminately.
5. **Move:** Use workers only for substantial pure computation after measuring transfer and application costs. Use compositor-friendly motion where it preserves the design, and verify rather than assuming GPU promotion.

For graph reads, use the installed collection's index APIs rather than introducing
a second subscription-maintained map. TanStack's equality buckets are live internal
sets: consume them synchronously, never mutate them or retain them as snapshots.
Test reads inside commit subscribers as well as rollback and connection ownership;
include index memory/write overhead in native comparisons.

For Markdown, unchanged React blocks and unchanged parsing are separate questions.
The current parser accepts a full document, and later reference definitions can
change earlier nodes. Measure the actual growing response shape: a settled-prefix
optimization cannot help a single growing paragraph. Synthetic long-document gains
alone do not justify changing the parser or animation semantics.

Choose the phase as well as the scenario: the input/parallel workload's early
text grows a single paragraph, while its final response streams the rich Markdown
feature page. Early typing overlap does not establish typing responsiveness during
that rich final phase. The interaction workload supplies sustained separate
paragraph growth. Inspect role-specific derived work before touching the parser:
an assistant message should not compute a user-only collapse/accessibility summary.

For batching, distinguish the transport's accumulation interval from the renderer's
synchronous processing duration. An 8 ms flush timer is not an 8 ms main-thread
budget. Record batch event count, text-delta size, and callback duration together, then correlate
with input delay, React work, and oldest pending age. A callback measurement is not
the entire browser task and does not include later React rendering or paint.
Test both steady and clustered arrivals: equal average throughput can conceal very
different task sizes. Require actual service/renderer delivery evidence rather
than assuming the scripted provider's intended pacing survives every layer.
Never call a different workload an A/B product improvement, or add a scheduler
when the measured batch work is already short.
OpenCode may merge several provider chunks into one text delta: fewer events can
mean larger payloads, not less content. The batch probe's text size is UTF-16 code
units, not network bytes or tokens. Its retained sample percentiles are incomplete
after truncation, even though its aggregate counts and durations remain complete.
Receive-to-commit starts after upstream provider/service buffering. It cannot
measure that earlier delay or justify another debounce window. Inspect the pinned
runtime, not just an upstream development checkout, before changing batching policy.

### Scheduling pitfalls

- Yielding improves opportunities for input/rendering; it can increase wall-clock completion time. Report both.
- A resolved promise continues in the microtask queue, which drains before rendering. `scheduler.yield()` or a task-based fallback creates a real scheduling opportunity. Check the pinned Electron runtime's support before adding a compatibility layer.
- rAF callbacks consume the time immediately before style/layout/paint. Don't put a large background loop there merely because it is "frame aligned". A 5 ms slice is a heuristic, not a universal budget—especially at 120 Hz.
- `startTransition` / `useDeferredValue` schedule React work; they do not move parsing, sorting, external-store mutation, or reconciliation off-thread, and cannot interrupt the middle of a synchronous component calculation.
- Debounce a derived preview, not the authoritative editor value. Bound latency and ensure the final result flushes.
- Dropping transient visual states can be valid; dropping transcript deltas, tool lifecycles, permissions, or user input is not. Any event coalescing must be justified by the official contract.
- A later HTTP response is not automatically fresher than live state. Ephemeral text/reasoning or tool-input fragments may be absent until their durable completion boundary. Test both `fetch → delta → response` and `delta → fetch → response` ordering before changing batching or snapshot admission; revision watermarks alone only protect the former.
- A worker cannot manipulate the DOM. Avoid copying the full growing transcript for every token. Define ownership, result versioning, cancellation, and bounded queues first; consider transferables for suitable buffers.
- Batch layout reads before writes where possible. A geometry read is expensive only when it forces relevant work; trace it. Never remove scroll settlement without testing bottom-lock, user scroll intent, prepend anchors, and late media/font resizing.

## Read metrics honestly

- Event Timing has a minimum requested threshold of 16 ms and quantized durations. Fast events can be absent. Presentation delay is an estimate derived from duration, not a compositor timestamp. Interaction grouping uses the maximum event duration for one interaction ID; do not label the scenario result INP.
- LoAF captures long frames, not every frame. Script attribution can be incomplete and collection adds some overhead. Keep it explicitly identified in comparisons; React Scan remains off.
- Long Tasks begins at 50 ms. Several shorter tasks can still consume frame opportunities. rAF intervals measure callback cadence, not raster/presentation success.
- A rAF or ResizeObserver sample can precede another observer's same-frame correction. Correlate post-geometry checkpoints with captured frames; callback order is not paint order. Check visual stability in both directions and across row replacements—overlap-only or same-identity tests can miss upward handoff jumps.
- Stable reading means stable visible content, not an unchanged numeric `scrollTop`. A virtualizer may correctly adjust the offset when content above the viewport is measured. Capture a visible anchor before treating that adjustment as unwanted auto-follow.
- Collector status and truncation are part of the result. Empty arrays from unsupported or failed collection must not pass responsiveness budgets.
- Streaming samples end at React commit, not paint. Scoped samples are selected by commit cursor; work received before the action can contribute its full wait. Oldest pending age in a background session may intentionally include time until it becomes visible. Compare owners and visibility, not an undifferentiated global percentile.
- Pure-graph microbenchmarks can establish scaling behavior, not a native UX speedup. Keep native production, React profiling, and traced results separate.
- Require the measured User Timing start/end marks in traces before slicing CPU samples or layout events. Both renderer and whole-app tracing need `blink.user_timing`; enabling `blink` alone did not capture these marks in Electron 44.3. Do not silently substitute the whole trace, which includes setup and teardown.
- CPU samples are estimates, not instrumented function durations. Inclusive stacks and nested style/layout events overlap and must not be summed. A hot DOM geometry accessor can spend time in browser layout; it does not automatically justify a JavaScript worker. Retain matching source maps before rebuilding another candidate.
- For forced-layout call sites, enable `disabled-by-default-devtools.timeline.stack` alongside timeline tracing. Both native trace paths include it; it is diagnostic overhead, not a clean benchmark setting. Map the actual Layout/UpdateLayoutTree stack with that build's source maps rather than assigning all browser work to the nearest JavaScript sample.
- Removing a geometry reader can move the pending style/layout flush to the next reader, including a component-library listener. Compare aggregate browser work and clean input/freshness results, not only the disappearance of one call site. In the streaming transcript, eliminating a redundant locked-scroll read shifted similar style work to Base UI; it did not establish a net layout saving.
- A virtualizer's cached total is not automatically the browser's `scrollHeight`: estimates, overflow, fractional measurements, and viewport changes can differ. Preserve synchronous spacer-to-bottom settlement unless an alternative proves post-layout stability, explicit user intent, and history anchoring. Even `scrollTop` can flush pending style/layout, so a no-op fast path must avoid all geometry getters to eliminate its own read.
- Drive transcript pagination from the virtualizer's actual visible range, not the first mounted item (custom extraction can pin offscreen turns). Reuse existing range notifications and user-input handlers rather than adding per-scroll geometry reads. Programmatic scroll direction is not user intent. Fetch at most one page per upward approach/gesture, guard requests synchronously before query loading state commits, and test continued access after short or same-turn pages as well as errors and exhaustion. Prepend settlement must not trigger a history-fetch loop.

## Comparing changes

Keep at least five comparable production runs per candidate when making budget or improvement claims. Retain each artifact and report median and spread of run-level measurements. Alternate baseline/candidate runs when practical; don't pool every event from unequal-length runs into one percentile.

Use `bun run perf:compare <baseline.json...> -- <candidate.json...>` on retained
independent reports. It checks run identity, scenario/fixture settings, viewport,
runtime and collector metadata, and prints descriptive JSON summaries. It does
not start benchmarks, pool events, infer confidence, or fail for a numerical
regression. Missing/truncated measurements do not receive numerical comparison
deltas. At least two runs per group are required; five remain the recommended
minimum. Memory cycles and legacy reports without identity are rejected.

Record revision/dirty state, scenario and fixture cadence, renderer/build flags, native/CSS glass settings, runtime versions, hardware, display refresh/scale, window bounds, power mode, and competing host load. Unknown conditions are unknown—not automatically matched. Use a slower supported machine and real 60/120 Hz displays before defining release budgets; CPU throttling is only a supplemental experiment.

Keep private artifacts under the primary checkout's `.local/`. Do not publish traces or source paths without inspection. Performance changes are complete only after the relevant correctness checks and matched native verification, or an explicit report of what could not be verified.
