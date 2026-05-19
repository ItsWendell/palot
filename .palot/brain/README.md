---
title: Palot Project Brain
description: Durable agent-readable knowledge base for the Palot codebase
tags: [project-brain, meta]
updated: 2026-05-13
---

# Palot

Palot is an Electron desktop application that wraps [OpenCode](https://opencode.ai) and adds a multi-agent orchestration layer on top. It ships a Lead → Architect → Builder → Reviewer pipeline, a Hive Mind sidebar panel showing live sub-agent status, cost tracking, supervision policy enforcement, a skills system, and a decomposed chat input.

## What it is

- Electron main process manages OpenCode server lifecycle, IPC, and file I/O
- Renderer (React + Jotai + Tailwind + shadcn/ui) renders the chat and agent panels
- Preload bridge (`contextBridge`) exposes typed APIs from main to renderer
- OpenCode integration: child sessions spawned via the `task` tool; events consumed via SSE

## Agent pipeline

`lead-agent` → `architect` → `builder` → `reviewer` (sequential, each depends on the previous)

The Lead Agent reads the user request, outputs a PRE-FLIGHT REPORT, waits for confirmation, then orchestrates the three specialist sub-agents in order.

## Key systems

- **Skills system**: Lead Agent reads `.md` skill files from `~/.config/opencode/skills/` before spawning sub-agents. Managed via `SkillsService` + IPC.
- **Hive Mind panel**: sidebar shows live child agent status, token/cost, progress bars, and supervision policy decisions.
- **Supervision policy**: evaluated at prompt submission time in the renderer; decisions surfaced in the Hive Mind panel.
- **Budget tracking**: `sessionMetricsFamily` atom aggregates cost/tokens per session; `BudgetIndicator` in the status bar shows NORMAL/FRUGAL/EMERGENCY.

## Cross-references

- [[architecture]] — Electron main/renderer/preload split and IPC boundary
- [[coding-conventions]] — TypeScript, Tailwind, Jotai, test runner
- [[tasks]] — pending tasks and execution graph
- [[decisions]] — prior engineering decisions
- [[issues]] — known risks and blockers
- [[models]] — model performance and cost notes
- [[agent-performance]] — automatic agent run scores, timing, failures, and tuning signals
- [[skills]] — skill usage history
- [[run-history]] — agent run log
