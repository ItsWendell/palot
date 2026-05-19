---
title: Model Performance Notes
tags: [models, performance]
updated: 2026-05-16
---

# Model Performance Notes

| model | role | strengths | weaknesses | cost-tier |
|-------|------|-----------|-----------|-----------|
| openrouter/deepseek/deepseek-chat-v3.1 | Lead Agent, Builder | Fast, cheap, good at following structured templates and writing code file-by-file | Weaker at deep architectural reasoning than r1 | low |
| openrouter/deepseek/deepseek-r1 | Architect | Deep reasoning, thorough planning, catches edge cases before implementation | Slow (reasoning tokens), expensive compared to chat models, verbose | high |
| openrouter/google/gemini-2.5-flash-preview | Reviewer | Large context window (good for reviewing diffs), different model family from Builder (reduces blind spots), fast | Less precise on TypeScript specifics than deepseek | medium |
| openrouter/deepseek/deepseek-r1 | Spec Writer | Same strengths as Architect role — suitable for standalone PRD/spec work | Same weaknesses — only use when deep spec reasoning is needed | high |

## Builtin Agent Routing Policy

Current bundled-agent assignment:

- 119 agents use `openrouter/deepseek/deepseek-chat-v3.1` for everyday specialist execution.
- 25 reasoning-heavy agents use `openrouter/deepseek/deepseek-r1` for architecture, security, compliance, orchestration, and high-risk review work.

Best operating model:

- Start with tiered defaults, not per-agent guesswork.
- Promote an agent to a stronger model only when performance data shows low score, repeated failures, or high rework.
- Demote an agent to a cheaper/faster model when it consistently scores well and has low failure/retry rates.
- Judge by team and agent role: team leaders, architecture, security, legal/compliance, payment, and incident-style work should bias toward reasoning models; implementation, docs, search, and routine language specialists should bias toward fast models.

The `agent-performance` brain file is the source of truth for future tuning decisions.
