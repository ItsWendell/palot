---
title: Multi-Agent Workflow Design
description: Patterns for decomposing tasks, coordinating agents, managing handoffs, and avoiding common multi-agent failure modes.
source: palot-knowledge
tags: multi-agent, orchestration, hive-mind, coordination, workflow
agents: multi-agent-coordinator, workflow-orchestrator, research-analyst, product-manager
updated: 2026-05-16
---

## Palot Hive Mind Architecture

```
User → Lead Agent (Boss)
          ├── architect        [planning, no code]
          ├── builder          [implementation]
          ├── reviewer         [quality gates]
          └── spec-writer      [documentation]

Plus 144 Palot builtin agents (spawned via UI):
  engineering / languages / infrastructure / quality /
  data-ai / research / business / orchestration / specialized
```

## Task Decomposition Principles

### Good decomposition — disjoint file ownership
```
Task: Add user profile editing feature

Architect output:
  Parallel Group A (independent):
    Builder-1 owns: src/lib/user/mutations.ts, src/lib/user/schema.ts
    Builder-2 owns: src/components/profile/EditForm.tsx, src/components/profile/AvatarUpload.tsx

  Sequential (depends on A):
    Integration Builder: src/app/profile/page.tsx (wires components to mutations)
    Reviewer: all files above
```

### Bad decomposition — shared ownership causes conflicts
```
// DON'T: both builders touch the same file
Builder-1 owns: src/app/profile/page.tsx, src/lib/user/mutations.ts
Builder-2 owns: src/app/profile/page.tsx, src/components/profile/EditForm.tsx
```

## Handoff Protocol

Every sub-agent must end with a handoff marker that the Lead Agent checks:

```
HANDOFF_READY: ARCHITECTURE_PLAN     ← from architect
HANDOFF_READY: IMPLEMENTATION_COMPLETE  ← from builder
HANDOFF_READY: REVIEW_COMPLETE       ← from reviewer
HANDOFF_BLOCKED: <TYPE>              ← blocked, needs escalation
```

If the marker is missing, Lead asks once for the marker + summary only. Do not re-prompt the full task.

## Context Passing Between Agents

```
Lead → Architect: full user request
Lead → Builder:   architect's COMPLETE output (never summarize in NORMAL mode)
Lead → Reviewer:  architect's acceptance criteria + builder's changed files

In FRUGAL mode: condense architect output to ≤300 words for builders
In EMERGENCY mode: acceptance criteria only, skip optional sections
```

## Parallel vs Sequential

| Condition | Pattern |
|---|---|
| Tasks own disjoint files | Spawn all builders in the same turn |
| Tasks share files | Sequential, or split ownership first |
| Reviews are independent slices | Parallel reviewer fan-out |
| Task B needs Task A's output | Sequential |

## Budget Modes

Pass `BUDGET_MODE: NORMAL/FRUGAL/EMERGENCY` explicitly in every spawn message.

| Mode | When | Agent Behavior |
|---|---|---|
| NORMAL | < $0.25 spent | Full outputs, all steps |
| FRUGAL | $0.25–$0.75 | Condense outputs, skip optional steps |
| EMERGENCY | > $1.00 | Critical path only, minimal output |

## Brain Memory for Multi-Agent Coordination

Agents share state via `.palot/brain/` files using the Brain MCP tools:

```
brain_read "tasks"          → current task list
brain_read "decisions"      → prior engineering decisions
brain_read "run-history"    → previous runs and results
brain_append "run-history"  → add timestamped event
brain_record_event "decisions" "Chose Zod for validation" "Matches existing pattern"
```

## Failure Recovery Pattern

```
1. Capture: agent name + last successful stage + exact error
2. Retry ONCE: smaller prompt with the error + required output format
3. If retry fails:
   - Preserve last successful handoff
   - Report blocker to user with exact agent name and error
   - Do NOT restart successful agents
4. Continue from last good state if possible
```

## Common Failure Modes

| Failure | Symptom | Fix |
|---|---|---|
| Missing handoff marker | Lead asks again, loops | Prompt once for marker only |
| Builder invents features | Extra files, scope creep | Add "implement ONLY assigned slice" |
| Reviewer writes code | Scope violation | Remind: "review only, list issues" |
| Lead implements itself | No subtask spawns | Check model (needs deepseek-r1) |
| Context overflow | Agent ignores instructions | Compress to ≤300 words in FRUGAL |
| File ownership conflict | Merge conflicts | Re-architect with stricter boundaries |

## Reporting Format (Team Leaders)

```
📊 [TEAM] REPORT
Status: in-progress | complete | blocked
Members used: [comma-separated names]
Summary: [one sentence]
Questions for Boss: none | [specific question]
```

## Escalation Pattern

```
⚠️ ESCALATING: [specific blocker]
[What was attempted]
[What is needed to continue]
[Options if the Boss has a preference]
```

## Checklist Before Spawning

- [ ] Task has a clear deliverable (not "research and improve")
- [ ] File ownership boundaries defined (no overlap)
- [ ] Budget mode included in spawn message
- [ ] Acceptance criteria specified
- [ ] Handoff marker requirement stated
- [ ] Retry policy communicated (once, not infinite)
