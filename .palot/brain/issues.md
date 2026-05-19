---
title: Known Issues and Blockers
tags: [issues, risks]
updated: 2026-05-14 (heartbeat-recovery + pipeline-integration-test resolved; 3 new reliability gaps documented)
---

# Known Issues and Blockers

| id | severity | description | status | workaround |
|----|----------|-------------|--------|-----------|
| enforcement-boundary | high | Supervision policy fires at Palot's prompt submission hook, not inside OpenCode's `task` tool spawn. A lead agent that spawns sub-agents autonomously mid-turn bypasses all enforcement. | open | Policy is advisory only; user must act on warnings manually |
| heartbeat-recovery | medium | Palot detected stalled/unresponsive child sessions in Hive Mind and exposes restart/terminate actions. Auto-recovery loop was added: restarts STALLED children, terminates UNRESPONSIVE ones, throttled (max 2 restarts, 5min cooldown). | resolved | — |
| no-kill-switch | medium | OpenCode exposes no API to terminate a running child session from outside. Budget overruns can only be surfaced to the user, not stopped automatically. | open | User must abort from inside the child session |
| hardcoded-thresholds | low | `DEFAULT_SUPERVISION_POLICY` defines `configuredBudget: 1.0`, `maxChildren: 12`, `maxConcurrentAgents: 3`. Not user-configurable. Also `STALLED_AFTER_MS`, `UNRESPONSIVE_AFTER_MS`, `DEFAULT_RECOVERY_CONFIG` (maxRestartsPerChild, restartCooldownMs) are hardcoded. | open | Edit `supervision-policy.ts` or `agent-heartbeat.ts` manually; see [[tasks]] for `budget-thresholds-ui` task |
| runtime-agent-sync | medium | OpenCode reads runtime agent files outside the repo. Updating `.opencode/agents/` improves version control, but existing local runtime copies may still be stale. | open | Sync `.opencode/agents/*.md` to the configured OpenCode agent directory after edits |
| no-integration-test | medium | Automated test now covers the full Lead → Architect → Builder → Reviewer flow end-to-end (42 tests, 8 verification areas). | resolved | — |
| recovery-state-leak | low | `recoveryStateFamily` atom state persists indefinitely per child session ID. When a child session ends or is deleted, its restart-count history lingers. No cleanup mechanism. | open | Negligible in practice since session IDs are UUIDs; atom family memory is negligible |
| permission-persistence | low | `addPermissionAtom` has no matching `removePermissionAtom`. Once a permission is added, the child stays "waiting" until SSE events from the server clear it locally. If SSE events are lost, the child appears stuck. | open | Reloading the app or navigating away/back resets stale atom state |
| no-recovery-hook-test | low | `useAgentRecovery` hook (interval + abort/sendPrompt calls) is not tested. Only the pure decision function `evaluateRecoveryAction` and atom recording `recordRecoveryActionAtom` are tested. The interval timing and side-effect execution require component rendering. | open | Manual verification through the Hive Mind panel |
| event-persistence | low | `supervisionEventsAtom` uses `atomWithStorage` (renderer localStorage). Not durable across devices, capped at 50 events, not a reliable audit log. | open | Acceptable for now; see [[decisions]] for rationale |
| manual-agent-sync | low | Agent config files must be manually synced between `.opencode/agents/` (repo) and `~/.config/opencode/agents/` (runtime). | open | Copy files after editing; a future app-launch sync hook would resolve this |
