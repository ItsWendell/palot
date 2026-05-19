# Hive Mind UI Validation

This document explains how Nexus Builder renders multi-agent progress for Lead Agent
sessions and how to smoke-test the UI after changing the sidebar, chat task
cards, cost tracking, or session tree plumbing.

## Files That Power The UI

- `apps/desktop/src/renderer/components/sidebar.tsx`
  - Mounts `MultiAgentPanel` under the selected root session.
- `apps/desktop/src/renderer/components/multi-agent-panel.tsx`
  - Renders the sidebar `Hive Mind` panel, including the Lead-Agent row, child
    agent rows, budget mode, token progress bars, and session spend.
- `apps/desktop/src/renderer/components/chat/sub-agent-card.tsx`
  - Renders inline chat cards for task/sub-agent tool calls.
  - Hydrates child session messages when possible so completed cards can show
    real model, token, cost, and duration summaries.
- `apps/desktop/src/renderer/atoms/sub-agents.ts`
  - Builds each child-agent row from OpenCode child sessions plus
    `sessionMetricsFamily`.
- `apps/desktop/src/renderer/atoms/derived/session-requests.ts`
  - Builds the parent-to-child session map and bubbles child-agent questions or
    permissions to the parent input area.
- `apps/desktop/src/renderer/atoms/derived/session-metrics.ts`
  - Computes per-session tokens, cost, model distribution, retries, errors,
    work time, and tool counts.
- `apps/desktop/src/renderer/components/cost-tracker.tsx`
  - Shows global live spend and budget mode in the sidebar footer.
- `apps/desktop/src/renderer/lib/agent-progress-display.ts`
  - Centralizes budget thresholds, status labels, status colors, and common
    agent-name normalization.
- `apps/desktop/src/renderer/components/chat/session-task-list.tsx`
  - Shows Lead Agent todo progress with pending, running, done, and failed
    icons.

## Current Agent Pipeline

The default local OpenCode agent files live outside this repo:

- `~/.config/opencode/agents/lead-agent.md`
- `~/.config/opencode/agents/architect.md`
- `~/.config/opencode/agents/builder.md`
- `~/.config/opencode/agents/reviewer.md`

The repo-local copies live in:

- `.opencode/agents/`

The current expected orchestration flow is:

1. `Lead-Agent` outputs a PRE-FLIGHT REPORT and waits for confirmation.
2. `Architect` plans the implementation.
3. `Builder` implements the plan.
4. `Reviewer` reviews the result against the architecture/spec.
5. `Lead-Agent` outputs the final report.

## Progress Tracking Model

Nexus Builder receives OpenCode session, status, message, and part events through the
global SSE stream in `connection-manager.ts`.

The `Hive Mind` sidebar panel tracks progress by:

1. Reading child sessions whose `parentID` matches the selected Lead-Agent
   session.
2. Reading the parent session metrics for the Lead-Agent row.
3. Reading each child session's `sessionMetricsFamily(childSessionId)` for
   tokens, cost, duration, model distribution, and failure state.
4. Mapping pending child permissions/questions to `WAITING`.
5. Mapping busy/retry status to `RUNNING`.
6. Mapping sessions with assistant output to `DONE`.
7. Mapping sessions with metric errors to `FAILED`.

Each row should show:

- Agent name: `Lead-Agent`, `Architect`, `Builder`, or `Reviewer`
- Status badge: `RUNNING`, `WAITING`, `DONE`, or `FAILED`
- Current activity line
- Token count and cost
- Primary model when known
- Token-share progress bar relative to the visible session total

The sidebar footer cost tracker shows global spend across known sessions. The
Hive Mind panel shows spend for the selected orchestration session.

## Budget Modes

Budget thresholds are centralized in `agent-progress-display.ts`.

| Spend | Mode | UI |
| --- | --- | --- |
| `< $0.25` | `NORMAL` | Green |
| `$0.25 - $0.50` | `FRUGAL` | Amber |
| `> $0.50` | `EMERGENCY` | Red |

The same helper is used by the Hive Mind panel and the global cost tracker so
threshold colors stay consistent.

## Inline Chat Cards

When the Lead Agent delegates work, `SubAgentCard` renders an inline card in the
chat thread.

Expected completed summary format:

```text
✓ Architect completed · 847 tokens · $0.02 · 1m 23s
```

If child messages were not already loaded, `SubAgentCard` performs a best-effort
background hydration for the child session. Until hydration finishes, older
historical cards may temporarily show lower token/cost values.

When child output is available, the card also shows:

```text
← Architect returned results
```

## Smoke Test Prompt

After restarting Nexus Builder, select `Lead-Agent` and send:

```text
Build a simple TypeScript utility function that takes an array of golf groups,
each with a startTime and currentHole, and returns which groups are behind pace
— defined as taking more than 14 minutes per hole on average. Include the
function, its types, and a simple test file.
```

Confirm `YES` when the Lead Agent asks to proceed.

## Expected Result

- The chat shows:
  - Lead Agent pre-flight report
  - Architect inline card
  - Lead continuation
  - Builder inline card
  - Lead continuation
  - Reviewer inline card
  - Final report
- Completed cards collapse to one-line summaries.
- Sub-agent cards expose model names when child session messages are available.
- The sidebar shows a `Hive Mind` panel for the selected Lead-Agent session.
- The sidebar shows the Lead-Agent row and any known child-agent rows.
- The budget badge appears as `NORMAL`, `FRUGAL`, or `EMERGENCY`.
- The global cost tracker remains visible in the sidebar footer once spend is
  non-zero.
- Lead Agent todos show:
  - pending: circle
  - running: spinner
  - done: green check
  - failed/error: red x

## Failure Signals

- No `Hive Mind` panel:
  - The selected session has no known child sessions and no parent metrics yet.
  - Nexus Builder has not received child `session.created` events.
- Child card shows `0 tokens · $0.00` after a few seconds:
  - Child session messages may not be loaded or the child session may not expose
    token/cost metadata.
- A route-level error appears when selecting an older session:
  - Check the review panel diff payload. Historical `FileDiff` records may have
    missing `before`/`after` content and must be normalized before rendering.
- `ProviderModelNotFoundError`:
  - One of the OpenRouter model IDs in `.opencode/agents` or
    `~/.config/opencode/agents` is invalid.
- `PRAGMA wal_checkpoint(PASSIVE)`:
  - OpenCode local database is busy. Fully quit Nexus Builder/OpenCode and restart.

## Verification Commands

Run from the repo root:

```bash
bun test apps/desktop/src/renderer/lib/agent-progress-display.test.ts
npm run check-types
npm run lint
git diff --check
```
