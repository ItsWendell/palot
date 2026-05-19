---
title: Palot Architecture
tags: [architecture]
updated: 2026-05-13
---

# Architecture

## Electron process split

| Process | Entry | Responsibilities |
|---------|-------|-----------------|
| Main | `apps/desktop/src/main/index.ts` | Window management, OpenCode server lifecycle, IPC handlers, file I/O, credential store, git service, skills service, automation scheduler |
| Preload | `apps/desktop/src/preload/index.ts` | `contextBridge` — exposes typed `window.palot` API to renderer; never touches DOM |
| Renderer | `apps/desktop/src/renderer/` | React + Jotai UI; all state lives here; communicates to main only via `window.palot.*` |

## IPC boundary

All main↔renderer communication goes through `ipcMain.handle` / `ipcRenderer.invoke`. Types are defined in `apps/desktop/src/preload/api.d.ts`. Shared data types (skills, tasks, server config) live in `apps/desktop/src/shared/`.

Fetch requests from the renderer are proxied through the main process (`fetch:request`) to bypass Chromium's 6-connections-per-origin limit.

## OpenCode integration

- **Server lifecycle**: `OpenCodeManager` starts/stops the OpenCode CLI process; `ensureServer()` is called at app launch.
- **Session data**: Renderer reads sessions/messages via SSE from the OpenCode HTTP API (proxied through `net.fetch`).
- **Child sessions**: The `task` tool in OpenCode creates child sessions. Palot reads them via `childrenMapAtom` in `atoms/derived/session-requests.ts`.
- **No kill switch**: OpenCode exposes no API to terminate a running child session from outside.

## Agent pipeline

```
lead-agent (primary)
  └─ architect (subagent) — deepseek-r1 — plan only, no code
       └─ builder (subagent) — deepseek-chat-v3.1 — file-by-file implementation
            └─ reviewer (subagent) — gemini-2.5-flash — PASS/FAIL with severity ratings
```

Agent configs live in `.opencode/agents/` (repo) and `~/.config/opencode/agents/` (runtime). See [[models]] for model selection rationale.

## State management (Jotai)

All UI state uses Jotai atoms. Key atom files:

| File | What it holds |
|------|--------------|
| `atoms/sessions.ts` | Session list, active session |
| `atoms/sub-agents.ts` | `childSessionsFamily` — child sessions enriched with metrics |
| `atoms/supervision-events.ts` | Supervision event log (localStorage, 50-event cap) |
| `atoms/derived/session-metrics.ts` | `sessionMetricsFamily` — cost, tokens, work time per session |
| `atoms/cost-tracking.ts` | `agentCostsAtom` — aggregated cost across all sessions |
| `atoms/context-compaction.ts` | Context usage and compaction policy |

## Shared types

`apps/desktop/src/shared/` contains types shared between main and renderer:
- `skills.ts` — `ManagedSkill`, `SkillImportResult`, `SkillImportRisk`
- `tasks.ts` — `BrainTask`, `TaskGraph`, `ExecutionPlan`
- `server-config.ts` — `ServerConfig`, `LocalServerConfig`, `RemoteServerConfig`

## Skills system

`SkillsService` reads `~/.config/opencode/skills/` and parses YAML frontmatter. `SkillImporter` fetches from GitHub and runs a security scan before returning a draft. IPC handlers in `ipc-handlers.ts` expose list/write/delete/import to the renderer.

See [[skills]] for usage history and external repositories.
