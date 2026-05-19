---
title: File Ownership
tags: [file-ownership, coordination]
updated: 2026-05-13
---

# File Ownership

## Ownership Rules

**Parallel OK** for tasks with disjoint `filesOwned` sets:
- Planning, research, and documentation tasks that do not write production code
- Tasks whose `filesOwned` arrays have no intersection
- Read-only analysis tasks

**Sequential required** for tasks that share files:
- Any two tasks with overlapping `filesOwned` must run sequentially
- Tasks that write to `ipc-handlers.ts`, `api.d.ts`, or `preload/index.ts` always conflict — these are shared surfaces
- Tests for the same production file must be considered owned by the same task

**Conflict detection** is handled by `TaskGraphService.detectConflicts()`. If any conflict exists, `buildExecutionPlan()` returns `recommendation: "blocked"`.

## Current Assignments

| taskId | files | agent | status |
|--------|-------|-------|--------|
| | | | |
