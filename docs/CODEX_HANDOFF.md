# Codex Handoff — Nexus Builder Agent Orchestration

Branch: `feat/agent-overhaul` | Last updated: 2026-05-14

---

## 1. Current Project Status

**What Nexus Builder is now:** Electron desktop wrapper around [OpenCode](https://opencode.ai) with a multi-agent orchestration layer bolted on. Forked from ItsWendell/palot and extended with: a Lead Agent pipeline (Lead → Architect → Builder → Reviewer), a Hive Mind sidebar panel showing live sub-agent status, supervision policy enforcement, cost tracking per agent, a skills system, and a decomposed chat input (14 new renderer files replacing the original monolithic chat-input.tsx).

**Works end-to-end:**
- Lead Agent PRE-FLIGHT REPORT → user confirms → Architect → Builder → Reviewer sequential pipeline
- Child sessions appear in sidebar Hive Mind panel with live status/tokens/cost/progress bars
- Budget badge (NORMAL/FRUGAL/EMERGENCY) in chat status bar and sidebar footer
- Supervision policy evaluated at every prompt submission; warn/throttle/block/stop decisions surfaced in Hive Mind panel
- Inline SubAgentCard in chat shows running agent with spinner, collapses to `✓ Name · tok · cost · time` on completion
- Session task list (todo items) with real-time status icons (pending/running/done/failed)
- Skills system: main process reads `~/.config/opencode/skills/`, IPC layer exposes them to renderer, skills page shows management UI, lead-agent picks skills before spawning sub-agents
- Project directory service: per-project settings, IPC-backed
- Cost tracker sidebar widget with per-agent popover breakdown

**Partially implemented:**
- Chat input decomposition: 14 new files exist and are wired in, but `chat-input.tsx` (original) is deleted and all functionality moved. Type-check/lint pass; running-app smoke testing is still recommended before release.
- Supervision events: stored in renderer localStorage via `atomWithStorage`; banner displayed in Hive Mind panel only when `decision !== "allow"`; not yet wired to any main-process kill switch
- Review panel and diff comment model: modified but not fully validated

**Not implemented:**
- Heartbeat / stall detector on live child sessions
- Main-process kill switch for child agents (OpenCode has no exposed API for this yet)
- User-configurable budget thresholds (hardcoded in `DEFAULT_SUPERVISION_POLICY`)
- End-to-end automated test of the full Architect → Builder → Reviewer flow
- Durable cross-device audit log for supervision events (currently renderer localStorage only)

---

## 2. Architecture Map

### Agent UI files

| File | Responsibility |
|------|---------------|
| `apps/desktop/src/renderer/components/multi-agent-panel.tsx` | Hive Mind sidebar panel — lists Lead + child agents with status badges, activity lines, token/cost, progress bars, budget bar, supervision event banner |
| `apps/desktop/src/renderer/components/chat/sub-agent-card.tsx` | Inline collapsible card in chat for each `task` tool part — three states: expanded (running), summary (done), closed |
| `apps/desktop/src/renderer/components/cost-tracker.tsx` | Sidebar footer cost widget with per-agent popover breakdown |
| `apps/desktop/src/renderer/components/sidebar.tsx` | Sidebar root — wires MultiAgentPanel under active session |
| `apps/desktop/src/renderer/components/chat/session-task-list.tsx` | Collapsible todo list above chat input with real-time status icons |
| `apps/desktop/src/renderer/components/chat/prompt-toolbar.tsx` | Chat status bar — includes `BudgetIndicator` (cost + NORMAL/FRUGAL/EMERGENCY label) |

### Supervision policy files

| File | Responsibility |
|------|---------------|
| `apps/desktop/src/renderer/lib/supervision-policy.ts` | Pure function `evaluateSupervisionPolicy()` — returns decision/severity/machineCode/messages |
| `apps/desktop/src/renderer/lib/supervision-events.ts` | `createSupervisionEvent()` / `appendSupervisionEvent()` with 50-event cap and dedup |
| `apps/desktop/src/renderer/atoms/supervision-events.ts` | `supervisionEventsAtom` (localStorage), `recordSupervisionEventAtom` (write), `supervisionEventsForWorkflowFamily` (read per workflow) |
| `apps/desktop/src/renderer/lib/agent-progress-display.ts` | `getBudgetDisplay()`, `getAgentStatusBadgeClass()`, `getAgentStatusLabel()`, `getAgentDisplayName()` — shared display helpers |

### Cost tracking files

| File | Responsibility |
|------|---------------|
| `apps/desktop/src/renderer/atoms/cost-tracking.ts` | `agentCostsAtom` — aggregates cost/tokens across all live sessions, sorted by cost desc |
| `apps/desktop/src/renderer/atoms/derived/session-metrics.ts` | `sessionMetricsFamily` — per-session cost, tokens, work time, model distribution |
| `apps/desktop/src/renderer/atoms/sub-agents.ts` | `childSessionsFamily` — derived atom: child sessions enriched with live metrics for Hive Mind panel |

### Agent config files

Stored in two places (kept in sync manually):
- `~/.config/opencode/agents/` — runtime location OpenCode reads
- `.opencode/agents/` — repo copy for version control

| File | Model | Mode | Role |
|------|-------|------|------|
| `lead-agent.md` | `openrouter/deepseek/deepseek-chat-v3.1` | primary | Orchestrator: runs PRE-FLIGHT REPORT, spawns Architect → Builder → Reviewer in sequence |
| `architect.md` | `openrouter/deepseek/deepseek-r1` | subagent | Produces structured architecture plan; no code |
| `builder.md` | `openrouter/deepseek/deepseek-chat-v3.1` | subagent | Implements Architect's plan file by file |
| `reviewer.md` | `openrouter/google/gemini-2.5-flash-preview-09-2025` | subagent | Reviews Builder output against spec; returns PASS/FAIL with BLOCKER/MAJOR/MINOR/NIT |
| `spec-writer.md` | `openrouter/deepseek/deepseek-r1` | subagent | Standalone spec/PRD work; not in the main pipeline |

### OpenCode integration points

- **Child session spawning:** OpenCode's `task` tool creates child sessions. Nexus Builder reads these via the same SSE event stream (`childrenMapAtom` in `atoms/derived/session-requests.ts`).
- **IPC boundary:** `apps/desktop/src/main/ipc-handlers.ts` exposes OpenCode session/message APIs to the renderer. Skills and project-directory services are also IPC-backed.
- **No backend kill switch:** OpenCode does not expose an API to terminate a running child session from outside. Nexus Builder cannot forcibly stop a sub-agent once spawned.
- **Supervision enforcement boundary:** Policy is evaluated in the renderer at prompt submission time. OpenCode's internal `task` tool spawn path is not intercepted.

---

## 3. Current Agent System Behavior

**Lead Agent flow:**
1. User sends message to `lead-agent` session
2. Lead Agent outputs PRE-FLIGHT REPORT (verbatim template with understanding, pipeline, tech choices, cost estimate, budget status)
3. User replies YES (or clarifies)
4. Lead spawns `architect` via OpenCode `task` tool → waits for completion
5. Lead spawns `builder` with Architect's full output → waits
6. Lead spawns `reviewer` with Architect's spec + Builder's output → waits
7. Lead outputs FINAL REPORT

**Hive Mind sidebar panel:**
- Appears when the active session has child sessions
- Header: "Hive Mind" + animated pulse dot when any child is `running`
- Each row: name, status badge (RUNNING green pulse / WAITING amber / DONE muted / FAILED red), activity line (1 line truncated), tokens + cost + model, progress bar relative to session total
- Budget bar at bottom: NORMAL (green) / FRUGAL (amber) / EMERGENCY (red) + total spend
- Policy banner: shown only when `decision !== "allow"` — displays decision, machineCode, operatorMessage, recommendedAction
- Recent supervision events (last 5): shown below policy banner if any exist
- Clicking a row navigates to that child session

**Budget badge in chat status bar:**
- `BudgetIndicator` component in `prompt-toolbar.tsx` reads `sessionMetricsFamily` for the current session
- Renders `{cost} {NORMAL|FRUGAL|EMERGENCY}` color-coded (emerald / amber / red)
- Hidden when `costRaw === 0`

**Supervision policy enforcement:**
- `evaluateSupervisionPolicy()` is called in `multi-agent-panel.tsx` on every render with live cost/token/child counts
- Returns one of: `allow` / `warn` / `throttle` / `block` / `stop` with severity and machine codes
- Panel displays the result as a banner (suppressed for `allow`)
- `recordSupervisionEventAtom` persists non-allow decisions to localStorage
- No enforcement hook at the OpenCode task-spawn level — policy is advisory only unless the user/lead agent acts on it

**Inline agent cards in chat:**
- `SubAgentCard` renders for every `task` tool part in the conversation
- While running: expanded state with live tool activity rows + streaming text + spinner
- On completion: auto-collapses to summary line `✓ Name · N tok · $X.XX · Ns`
- On error: shows red FAILED section with error text
- Clicking "Open" navigates to the child session

---

## 4. Validation History

All commands run from repo root (`/Users/cristianruizjr/palot`).

```bash
# Type check — PASS (exit 0)
bun run check-types

# Lint — PASS (no fixes)
bun run lint

# git diff --check — PASS (no whitespace errors)
git diff --check

# Unit tests (bun) — files exist, last known run: not recorded in this session
bun test apps/desktop/src/renderer/lib/supervision-policy.test.ts
bun test apps/desktop/src/renderer/lib/supervision-events.test.ts
bun test apps/desktop/src/renderer/lib/agent-progress-display.test.ts
bun test apps/desktop/src/main/automation/reliability.test.ts
bun test apps/desktop/src/main/automation/registry.test.ts
bun test apps/desktop/src/main/skills-service.test.ts
bun test apps/desktop/src/main/project-directory-service.test.ts
bun test apps/desktop/src/renderer/components/chat/chat-send.test.ts
bun test apps/desktop/src/renderer/components/chat/slash-commands.test.ts
```

2026-05-14 cleanup notes:
- Fixed stale `SupervisorState` test assumptions and added missing `bun:test` imports.
- Updated `research-orchestrator.ts` to use the OpenCode SDK v2 response shapes (`data`, `promptAsync`, `messages`, `status`).
- Corrected root agent docs for Biome 2.4.2 and the macOS unsigned packaging command.
- Ignored local launcher helpers (`Launch Nexus Builder.command*`) so absolute-path/keychain convenience scripts stay local.

2026-05-14 agent reliability notes:
- Raised default supervision limits from `$0.50`/6 children to `$1.00`/12 children to avoid normal workflows stopping at the sixth child session.
- Updated Lead/Architect/Builder/Reviewer prompts with explicit `HANDOFF_READY` / `HANDOFF_BLOCKED` markers and retry rules.
- Hive Mind child rows now treat SDK `session.error` state as a failed child session even when message metrics have not recorded an assistant error part.

---

## 5. Remaining Risks

- **Enforcement boundary:** Policy fires at Nexus Builder's prompt submission hook, not inside OpenCode's internal `task` tool spawn. A lead agent that spawns sub-agents autonomously mid-turn bypasses all enforcement.
- **Manual heartbeat recovery only:** Nexus Builder detects stalled/unresponsive child sessions and exposes restart/terminate controls, but does not automatically recover them.
- **No kill switch:** OpenCode exposes no API to terminate a running child session from outside. Budget overruns can only be surfaced to the user, not stopped automatically.
- **Hardcoded thresholds:** `DEFAULT_SUPERVISION_POLICY` in `supervision-policy.ts` defines `configuredBudget: 1.0`, `maxChildren: 12`, `maxConcurrentAgents: 3`. Not user-configurable.
- **No integration test:** No automated test covers the full Lead → Architect → Builder → Reviewer flow end-to-end.
- **Event persistence:** `supervisionEventsAtom` uses `atomWithStorage` (renderer localStorage). Not durable across devices, not a reliable audit log, capped at 50 events.

---

## 6. Agent Config Reference

| Filename | Model | Mode | Description |
|----------|-------|------|-------------|
| `lead-agent.md` | `deepseek/deepseek-chat-v3.1` | primary | Orchestrates Architect → Builder → Reviewer; PRE-FLIGHT + FINAL REPORT |
| `architect.md` | `deepseek/deepseek-r1` | subagent | Architecture plan only — no code; reasoning model for deep planning |
| `builder.md` | `deepseek/deepseek-chat-v3.1` | subagent | File-by-file implementation from Architect's plan |
| `reviewer.md` | `google/gemini-2.5-flash-preview-09-2025` | subagent | PASS/FAIL review with BLOCKER/MAJOR/MINOR/NIT ratings; different model from Builder by design |
| `spec-writer.md` | `deepseek/deepseek-r1` | subagent | Standalone spec/PRD agent; not part of main pipeline |

Provider prefix for all: `openrouter/`

---

## 7. Key Files Index

### Agent UI
- `apps/desktop/src/renderer/components/multi-agent-panel.tsx` — Hive Mind sidebar panel (fully committed on this branch)
- `apps/desktop/src/renderer/components/chat/sub-agent-card.tsx` — inline three-state collapsible agent card in chat
- `apps/desktop/src/renderer/components/cost-tracker.tsx` — sidebar footer spend widget with popover breakdown
- `apps/desktop/src/renderer/components/chat/prompt-toolbar.tsx` — chat status bar including `BudgetIndicator`
- `apps/desktop/src/renderer/components/chat/session-task-list.tsx` — todo progress list above chat input
- `apps/desktop/src/renderer/components/sidebar.tsx` — sidebar root wiring MultiAgentPanel

### Supervision
- `apps/desktop/src/renderer/lib/supervision-policy.ts` — pure `evaluateSupervisionPolicy()` function
- `apps/desktop/src/renderer/lib/supervision-events.ts` — event creation, append, dedup utilities
- `apps/desktop/src/renderer/atoms/supervision-events.ts` — Jotai atoms for event persistence and read
- `apps/desktop/src/renderer/lib/agent-progress-display.ts` — shared display helpers (budget, status badges)

### Chat (decomposition from monolithic chat-input.tsx)
- `apps/desktop/src/renderer/components/chat/chat-view.tsx` — main chat view (massively refactored)
- `apps/desktop/src/renderer/components/chat/chat-input-composer.tsx` — `ChatInputCard` + `ChatInputStatus`
- `apps/desktop/src/renderer/components/chat/chat-input-extras.tsx` — `LiveTurnTimer`, `WorktreeSetupProgress`, `DiffCommentChips`
- `apps/desktop/src/renderer/components/chat/chat-scroll.tsx` — `ScrollBridge`, `ScrollOnLoad`, `ScrollToResponseStart`
- `apps/desktop/src/renderer/components/chat/chat-send.ts` — `useChatSend` hook
- `apps/desktop/src/renderer/components/chat/prompt-input-bridges.tsx` — `TriggerDetector`, `DraftSync`, `SlashCommandBridge`, `AttachButton`
- `apps/desktop/src/renderer/components/chat/slash-commands.ts` — slash command parsing and routing
- `apps/desktop/src/renderer/components/chat/use-chat-mentions.ts` — mention popover state
- `apps/desktop/src/renderer/components/chat/use-chat-model-selection.ts` — model/agent/variant selection state
- `apps/desktop/src/renderer/components/chat/use-chat-skills.ts` — skills dialog and fork-via-slash
- `apps/desktop/src/renderer/components/chat/use-escape-abort.ts` — escape-to-abort logic
- `apps/desktop/src/renderer/components/chat/use-slash-command-handler.ts` — `/undo`, `/redo`, etc.

### Derived atoms
- `apps/desktop/src/renderer/atoms/sub-agents.ts` — `childSessionsFamily` (live child sessions with metrics)
- `apps/desktop/src/renderer/atoms/cost-tracking.ts` — `agentCostsAtom` (aggregated across all sessions)

### Main process
- `apps/desktop/src/main/ipc-handlers.ts` — IPC handler additions for skills, project-directory, automation
- `apps/desktop/src/main/skills-service.ts` — reads `~/.config/opencode/skills/`, parses frontmatter
- `apps/desktop/src/main/project-directory-service.ts` — per-project settings storage
- `apps/desktop/src/main/automation/executor.ts` — automation executor (modified)
- `apps/desktop/src/main/automation/index.ts` — automation entry (modified)
- `apps/desktop/src/main/automation/reliability.ts` — retry/reliability utilities (new)

### Agent configs (in repo)
- `.opencode/agents/lead-agent.md`
- `.opencode/agents/architect.md`
- `.opencode/agents/builder.md`
- `.opencode/agents/reviewer.md`
- `.opencode/agents/spec-writer.md`

### Docs added this branch
- `docs/CODEX_HANDOFF.md` (this file)

---

## 8. Recommended Next Task for Codex

**Status:** The agent progress UI overhaul described below is **already implemented** on `feat/agent-overhaul`. The Hive Mind panel, inline SubAgentCard, budget badge, and todo list icons are all live. The commits are:

- `de6c823` — skills system + multi-agent panel (initial)
- `d1b1193` — budget badge in status bar, completedSummary format fix, conditional policy banner
- `cfec2d4` — docstring slop removal

**If the next Codex session starts from `main` (before this branch merges)**, the highest-priority work is this full UI overhaul. If it starts from `feat/agent-overhaul` after a merge, the next priority is:

1. **Automatic heartbeat recovery** — use stalled/unresponsive state to trigger a safe retry or targeted recovery prompt without manual button clicks
2. **User-configurable budget thresholds** — expose `configuredBudget`, `maxChildren`, `maxConcurrentAgents` in settings UI; persist to disk
3. **Full pipeline integration test** — mock the OpenCode task tool; drive a Lead → Architect → Builder → Reviewer flow; assert Hive Mind panel state transitions

---

## 9. Copy-Paste Ready Prompt for Codex

> Use this if the branch hasn't merged yet and Codex is starting from `main`.

---

**Prompt:**

Overhaul the agent progress display in Nexus Builder — both the sidebar and the main chat. Goal: at any moment the user can see exactly which agent is running, what it's doing, how much it's spent, and feel the agents communicating back.

Read these files before touching anything:
- `apps/desktop/src/renderer/components/multi-agent-panel.tsx`
- `apps/desktop/src/renderer/atoms/sub-agents.ts`
- `apps/desktop/src/renderer/atoms/cost-tracking.ts`
- `apps/desktop/src/renderer/components/cost-tracker.tsx`
- `apps/desktop/src/renderer/lib/agent-progress-display.ts`
- `apps/desktop/src/renderer/lib/supervision-policy.ts`
- `apps/desktop/src/renderer/atoms/supervision-events.ts`
- Any session/message rendering components in the chat view

**SIDEBAR — rewrite multi-agent-panel.tsx:**
- Section header "Hive Mind" with animated pulse dot when any agent is running
- Each agent row: name, status badge (RUNNING green pulse / WAITING amber / DONE muted check / FAILED red x), current activity (1 line truncated with tooltip), token count + cost (small muted), progress bar filling as tokens accumulate relative to session total
- Budget status bar at bottom: NORMAL (green, < $0.25) / FRUGAL (amber, $0.25–$0.50) / EMERGENCY (red, > $0.50) — shows total spend
- Supervision banner: if policy decision is not `allow`, show machineCode, operatorMessage, recommendedAction
- Clicking a row navigates to that agent's session

**CHAT VIEW — inline agent status cards:**
- When a `task` tool part exists in a message, render a `SubAgentCard` inline
- Running: expanded with live tool activity + spinner
- Complete: collapse to `✓ Name · N tok · $X.XX · Ns`
- Failed: red FAILED badge with error reason
- Cards appear in chronological message order

**BUDGET BADGE — chat bottom bar:**
- Color-code the existing cost display: green < $0.25 / amber $0.25–$0.50 / red > $0.50
- Add budget mode label: NORMAL / FRUGAL / EMERGENCY

**TODO LIST:**
- Pending: muted circle icon
- Running: animated spinner
- Done: green check
- Failed: red x
- Update in real time as agents complete

Use existing atoms only — `sessionMetricsFamily`, `childrenMapAtom`, `agentCostsAtom`, `supervisionEventsAtom`. Do not create duplicate state.

Match dark theme, Tailwind, shadcn/ui. Run `npm run check-types`, `npm run lint`. Commit when clean.

---

## 10. Git Status

**Branch:** `feat/agent-overhaul`

**Last 5 commits:**
```
cfec2d4 chore: remove verbose multi-paragraph docstrings (slop cleanup)
d1b1193 feat(agent-display): add budget badge to chat status bar, fix agent card summary format, suppress allow-state policy banner
de6c823 feat: add skills system with manager UI, IPC layer, and lead agent integration
3f670e3 feat(new-chat): dynamic time-based greeting, remove wordmark from hero
076a096 fix(add-project-modal): navigate into new session after adding project
```

**Unstaged modifications (do not overwrite without reading):**
```
M  apps/desktop/src/main/automation/executor.ts
M  apps/desktop/src/main/automation/index.ts
M  apps/desktop/src/main/ipc-handlers.ts
M  apps/desktop/src/preload/api.d.ts
M  apps/desktop/src/renderer/atoms/sub-agents.ts
D  apps/desktop/src/renderer/components/chat/chat-input.tsx   ← DELETED, replaced by decomposed files
M  apps/desktop/src/renderer/components/chat/chat-view.tsx
M  apps/desktop/src/renderer/components/chat/session-task-list.tsx
M  apps/desktop/src/renderer/components/cost-tracker.tsx
M  apps/desktop/src/renderer/components/review/review-comments.tsx
M  apps/desktop/src/renderer/components/review/review-panel.tsx
M  apps/desktop/src/renderer/components/sidebar.tsx
M  apps/desktop/src/renderer/components/skills-page.tsx
M  apps/desktop/src/renderer/hooks/use-server.ts
M  apps/desktop/src/renderer/services/backend.ts
```

**Untracked new files:**
```
apps/desktop/src/main/automation/reliability.ts
apps/desktop/src/main/project-directory-service.ts
apps/desktop/src/main/skills-service.ts
apps/desktop/src/renderer/atoms/supervision-events.ts
apps/desktop/src/renderer/components/chat/chat-input-composer.tsx
apps/desktop/src/renderer/components/chat/chat-input-extras.tsx
apps/desktop/src/renderer/components/chat/chat-scroll.tsx
apps/desktop/src/renderer/components/chat/chat-send.ts
apps/desktop/src/renderer/components/chat/prompt-input-bridges.tsx
apps/desktop/src/renderer/components/chat/slash-commands.ts
apps/desktop/src/renderer/components/chat/use-chat-mentions.ts
apps/desktop/src/renderer/components/chat/use-chat-model-selection.ts
apps/desktop/src/renderer/components/chat/use-chat-send.ts
apps/desktop/src/renderer/components/chat/use-chat-skills.ts
apps/desktop/src/renderer/components/chat/use-escape-abort.ts
apps/desktop/src/renderer/components/chat/use-slash-command-handler.ts
apps/desktop/src/renderer/components/review/diff-comment-model.ts
apps/desktop/src/renderer/components/sidebar-project-folder.tsx
+ corresponding *.test.ts files for all of the above
```

**Do not overwrite without reading first:**
- `chat-view.tsx` — massively refactored; original 1100-line monolith split into 14 files
- `ipc-handlers.ts` — new skills + project-directory IPC channels added
- `sidebar.tsx` — MultiAgentPanel wiring added; project folder component split out
- `automation/executor.ts` + `automation/index.ts` — reliability and registry changes

---

## 11. Agent Orchestration Hardening Notes

**Crash root cause:** `childSessionsFamily` assumed child session question data was fully
hydrated and read `questions[0]?.questions[0]?.header`. OpenCode can briefly stream partial
question/session entries while child agents are starting or asking for input, so that nested
array access can throw in the renderer. The fix normalizes missing `status`, `permissions`, and
`questions`, and reads nested question headers through optional access.

**OpenCode compaction API:** Nexus Builder already uses `client.session.summarize({ sessionID })`; slash
commands `/compact` and `/summarize` call the same endpoint. The context badge already derives
usage from the last assistant message plus provider model limits.

**Context policy:** `context-compaction-policy.ts` defines:
- `NORMAL` below 60%
- `HIGH_CONTEXT` at 60%
- `COMPACTION_SUGGESTED` at 75%
- `AUTO_COMPACTING` at 85%
- `BLOCKED_UNTIL_COMPACTED` at 95%

The prompt send path now calls OpenCode summarization before sending when the policy asks for
auto-compaction. If auto-compaction is disabled and context is critical, Nexus Builder blocks new work.

**Simultaneous agents:** OpenCode can expose multiple child sessions and global SSE can interleave
their events, but no file locking or merge protection was found in Nexus Builder. The safe policy is:
parallel for planning, research, docs, and explicitly isolated file ownership; sequential for
shared writes unless locking exists.
