---
title: Task Graph
tags: [tasks, planning]
updated: 2026-05-17 (spawn-protocol + brain/knowledge pages + Mem9 completed)
---

# Task Graph

## Pending Tasks

| taskId | title | role | status | dependencies | estimatedComplexity | recommendedModel | filesOwned |
|--------|-------|------|--------|-------------|---------------------|-----------------|-----------|
| heartbeat-recovery | Automatic recovery loop for stalled child sessions | builder | completed | | medium | openrouter/deepseek/deepseek-chat-v3.1 | `apps/desktop/src/renderer/atoms/session-heartbeats.ts`, `apps/desktop/src/renderer/components/multi-agent-panel.tsx`, `apps/desktop/src/renderer/hooks/use-server.ts` |
| budget-thresholds-ui | User-configurable budget thresholds settings UI | builder | pending | | medium | openrouter/deepseek/deepseek-chat-v3.1 | `apps/desktop/src/renderer/lib/supervision-policy.ts`, `apps/desktop/src/renderer/components/settings-*.tsx` |
| pipeline-integration-test | End-to-end integration test for Lead → Architect → Builder → Reviewer flow | builder | completed | heartbeat-recovery | high | openrouter/deepseek/deepseek-chat-v3.1 | `apps/desktop/src/renderer/lib/pipeline-integration.test.ts` |
| project-brain-service | ProjectBrainService + TaskGraphService + IPC wiring | builder | pending | | medium | openrouter/deepseek/deepseek-chat-v3.1 | `apps/desktop/src/main/project-brain-service.ts`, `apps/desktop/src/main/task-graph-service.ts`, `apps/desktop/src/shared/tasks.ts` |
| external-skills-scan | External skills repository scanning in SkillsService | builder | pending | | low | openrouter/deepseek/deepseek-chat-v3.1 | `apps/desktop/src/main/skills-service.ts`, `apps/desktop/src/shared/skills.ts` |

## Execution Order

Tasks that can run in parallel (disjoint file ownership):
- Group 1: `heartbeat-recovery`, `budget-thresholds-ui`, `project-brain-service`, `external-skills-scan`
- Group 2 (after Group 1): `pipeline-integration-test`
