# Architecture

Palot is an Electron client for OpenCode 2. OpenCode owns execution and durable
task state; Palot owns the desktop presentation and local preferences.

## Process and ownership boundaries

- **Electron main** owns connection profiles, credentials, OpenCode HTTP/event
  transport, request scheduling, native windows, and platform integrations.
- **Preload** exposes typed, validated IPC. Renderer requests do not receive the
  service credentials or unrestricted Node.js access.
- **Renderer** uses the official OpenCode client through that bridge, TanStack
  Query for server-state caching, and Jotai for focused UI state. Query keys and
  actions include the owning connection; equal session IDs on different servers
  are not interchangeable.
- **OpenCode** owns sessions, messages, execution, permissions, agents, models,
  and server-relative files and worktrees. Palot does not use the service database
  as an integration API or inspect remote paths on the local machine.

Local lifecycle operations use the official service contract. Remote and SSH
connections retain their own ownership and must never silently fall back to a
local service. See [runtime packaging](opencode-runtime.md) and
[multi-connection behavior](multi-connection-overview.md).

**Source control.** OpenCode's `vcs` API stays the read path for diffs and
branches. Palot's main process adds a local-only layer in `main/source-control`:
GitHub PR links stored in Palot's database (keyed by profile and session), a
one-minute batched GraphQL sweep (open PRs each minute, closed every 15 minutes,
merged never), settle-on-merge through the triage store, and PR watches that queue
an OpenCode prompt to wake the agent. GitHub tokens come from `GH_TOKEN`,
`GITHUB_TOKEN`, or `gh auth token`, stay in main, and never reach the renderer.
Background reads keep 10% of each GitHub quota for interactive requests and pause
on rate limits. Local Git writes run `git` without a shell, with literal pathspecs
confined to the repository. Remote and SSH connections report source control as
unsupported.

**Project scripts.** `main/project-scripts` stores per-project scripts in Palot's database,
keyed by profile and OpenCode project. When the triage store records a new settlement (row
action, settle-on-merge, or a batch), main reads the task and project from the task's own server,
confirms the directory resolves inside the checkout or its worktrees, and runs each settle
script through the user's shell with a timeout and bounded output. Batches (Inbox bulk settle
and the renderer's inactivity sweep, both one `settle-many` triage command) run scripts only
in worktrees, once per directory, and skip rejected directories without a notice. Results go to the renderer
as notices only. Remote and SSH connections can't save or run scripts.

## Data flow

Main-process event batching preserves official payload semantics while bounding
delivery overhead. Renderer reconciliation combines hydration responses with live
events and rejects stale ownership generations. The renderer's data graph and
query caches are disposable projections, not an alternative task database.

Session summaries load progressively. Transcript history loads on demand, and
virtualized turns keep mounted UI bounded. Stable IDs and structural sharing
prevent unrelated streaming updates from invalidating the whole interface.
Older-page prepends preserve the reading position; scroll intent remains separate
from programmatic layout changes.

Composer approval presets update official session permission rules. Defaults
clears session overrides; Full access requires confirmation. Selecting a preset
does not automatically answer an already-pending request. Drafts and display
preferences belong to Palot, not to OpenCode's execution policy.

## UI and native surfaces

React, Tailwind, and local Base UI/shadcn primitives implement the design contract.
Code and diff views use Shiki and Pierre; terminal rendering uses Ghostty.
Platform-specific integrations stay behind Electron/preload contracts. Themes
provide semantic UI colors, syntax definitions, and terminal palettes.

Diagnostics are opt-in and bounded. Clean performance runs disable overlays and
record workload, build, display, and observer conditions. See the
[test harness](desktop-testing.md) rather than treating historical timings as a
current performance budget.

## Where to start in source

- `apps/desktop/src/main/opencode-runtime*.ts`: runtime ownership and lifecycle.
- `apps/desktop/src/main/opencode-request*.ts`: request transport and scheduling.
- `apps/desktop/src/renderer/lib/open-code-*.ts`: cache graph and reconciliation.
- `apps/desktop/src/renderer/hooks/use-session-transcript.ts`: transcript queries.
- `apps/desktop/src/renderer/components/thread.tsx`: virtualized conversation UI.
- `apps/desktop/src/shared`: cross-process contracts and appearance preferences.
- `apps/desktop/test/e2e`: isolated native integration and performance scenarios.
