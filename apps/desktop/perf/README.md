# strobe benchmarks

[strobe](https://github.com/anomalyco/strobe) compares two builds in alternating fresh launches and decides one
primary metric per case with an interval. Each block launches a variant's built Palot (`scripts/build.ts`) against an
OpenCode 2.4.1 fixture: the seeded tasks restored from a template, plus a scripted model that streams replies of one
kind per file (`fixture.ts --replies`): Markdown (`stream`), or 384 numbered deltas steady or in bursts.

| File                      | Case                            | Primary     | Measures                                              |
| ------------------------- | ------------------------------- | ----------- | ----------------------------------------------------- |
| `session-switch.bench.ts` | switch to a long task           | `main.work` | Switching between two 12-turn tasks, at the live edge |
| `stream.bench.ts`         | stream a reply into a long task | `main.work` | 80 Markdown deltas 25 ms apart into a 12-turn task    |
| `tasks.bench.ts`          | visit six long tasks            | `main.work` | A tour of six tasks; with `--probes memory`, leaks    |
| `idle.bench.ts`           | idle on a long task             | `cpu.work`  | 5 s left open on a long task                          |
| `typing.bench.ts`         | type while a reply streams      | `main.work` | A sentence typed while 384 deltas stream 20 ms apart  |
| `burst.bench.ts`          | stream a bursty reply …         | `main.work` | The same 384 deltas in bursts of 16 every 320 ms      |
|                           | type while a bursty reply …     | `main.work` | Typing the sentence during the bursty reply           |
| `interactions.bench.ts`   | switch away and back …          | `main.work` | To another long task and back, mid-reply              |
|                           | scroll up and back to latest …  | `main.work` | Wheel up 900 px, read 0.5 s, "Scroll to bottom"       |
|                           | stop a task mid-reply           | `main.work` | "Stop task" 20 lines into the reply, to the idle view |

## Run

```sh
bun apps/desktop/perf/seed.ts        # optional: the fixture seeds /var/tmp/palot-strobe/template on first use
Xvfb :91 -screen 0 1440x920x24 -nolisten tcp &   # a private X display: nothing opens on your desktop
export DISPLAY=:91; unset WAYLAND_DISPLAY

strobe bench apps/desktop/perf/stream.bench.ts --head . --check        # each case once, with a screenshot
strobe bench apps/desktop/perf/stream.bench.ts --base main --head .    # did this branch help?
strobe bench apps/desktop/perf/session-switch.bench.ts --aa --head .   # is the method sound on this machine?
strobe bench apps/desktop/perf/tasks.bench.ts --head . --probes memory --repeat 10   # leaks
strobe report experiment <exp_…> --format pr                           # the results block for a pull request
```

The installed app, from outside: `strobe record pid:<palot main pid> --for 30s`, then
`strobe query <rec> threads` or `memory`.

## On a quieter machine

A busy laptop often gets no decided result (strobe refuses or cuts runs as Throttled). Any Linux machine with Xvfb,
the pinned OpenCode binary and strobe can run the same commands; a long run can go in the background with
`--timeout 3h`. On a virtual machine with a software GPU absolute times are higher and frame metrics are refused, but
comparisons of two builds stay valid. A bench that needs many pairs takes one to two hours there.

## Notes

- **Why Xvfb:** strobe reads Electron pages over CDP and checks their window through X11. Its headless sway serves
  native-app targets only, and it can't see windows on a private Weston (what the E2E harness uses). Under Xvfb Palot
  renders on a software GPU, so frame and GPU metrics are refused; `main.work` and `cpu.*` are unaffected.
- **Fresh profile per block:** setup skips onboarding, opens the settled tasks and views each once, so runs switch to
  tasks at their live edge as a returning user sees them. A task's first visit (its first unread message) is not
  measured.
- **Streaming:** each run adds its exchange to the task, so history grows by one turn a run on both sides alike. A
  numbered reply is 383 paragraphs (about 10k tokens), and strobe's warm-up runs until steady (about ten runs here), so
  the fixture gives those replies a 10M-token context window: under the default 100k OpenCode starts a compaction
  within a block, which fails against the scripted model.
- **Reply kinds:** the scripted model answers prompts in order, so each file picks one kind with its fixture
  (`replyFixture("steady")`) and counts its prompts from 1 per block (`replyCounter()`); every reply ends with its
  numbered marker. `typing` and `burst` carry the same text at the same pace: only the clustering differs, a contrast of
  workloads, not a product A/B.
- **Mid-reply cases** (`typing`, `interactions`) start the reply untimed and act once 20 lines are in. Their resets wait
  for the reply to end (a stopped one is over already); the typing resets also check the composer holds the sentence
  with no lost key before clearing it.
- **Input latency:** `interaction.p95` (strobe's per-key latency) is refused under Xvfb (`SoftwareGpu`), so typing is
  judged by `main.work`; on a display with a GPU add `interaction.p95` to the typing cases' metrics.
- **Not ported from E2E:** four sessions streaming at once (these benches stream into the open task only), per-action
  DOM-response timings, the renderer batch-processing report, and the streaming-stability scroll-anchor assertions
  (correctness, kept in E2E).
- **No first-visit bench:** a seeded task opens at its first unread message until it was viewed, and OpenCode keeps
  that (`session.time.viewed`, which only moves forward) for the block. Six tasks give at most five first visits a block,
  while strobe sets runs per block on the command line (warm-up until steady, then `--runs`), so a case cannot bound its
  own runs; a strobe launch case would, but stalls the renderer here (below).
- **No first-launch bench:** a strobe launch case on this `command()` target holds Palot's renderer ~20 s before it
  connects (strobe 0.23, measured: Palot's main process is ready in ~0.1 s; the same launch outside strobe connects in
  0.4 s). Revisit when strobe supports Electron launch cases here.
- **OpenCode binary:** `environment.ts` finds the exact `@opencode/client` version the way E2E does: `OPENCODE_BIN`,
  then `.local/opencode-bin/<version>/opencode` in the primary checkout (found from the file's repository, not from
  strobe's `HOME`), then `opencode2` in common install locations and on `PATH`. To put one in the primary checkout,
  `npm pack @opencode/cli-<platform>@<version>` (for example `cli-linux-x64`) and move the archive's
  `package/bin/opencode` there; [agent development](../../../docs/agent-development.md) has the commands.
- **`launch.sh`** resolves Electron without `node`: strobe gives the app its own `HOME`, where mise shims find no
  config.
- **Machine noise:** an A/A run (same build both sides) on this machine stayed within −4% … +3% after 34 pairs for
  the session switch.

## Quick check on the laptop (two to four minutes)

For a fast answer while iterating, cap the pairs and test the metric you expect to move:

```sh
env -u WAYLAND_DISPLAY DISPLAY=:91 strobe bench apps/desktop/perf/session-switch.bench.ts \
  --base main --head . --primary main.style --pairs 3 --max-time 6m
```

Three pairs took 3 min 37 s with both variants to build and 1 min 42 s with builds cached (2026-11-11). strobe
labels a three-pair result "underpowered" even when the interval is tight; use it for direction and rough size, and
run more pairs (or the devbox in exclusive mode) for a number you quote. A full default run takes about 30 minutes
because it launches the app 24 times and keeps adding pairs while the primary metric is undecided, so pick a primary
that the change should move.
