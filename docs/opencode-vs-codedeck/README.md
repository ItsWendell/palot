# OpenCode vs Codedeck: Comparative Analysis

> **Date:** February 8, 2026
> **Purpose:** Deep comparison of OpenCode (the AI coding CLI/TUI) and Codedeck (the GUI dashboard), identifying feature gaps, architectural differences, and improvement opportunities for Codedeck.

## Document Index

| Document | Description |
|----------|-------------|
| [Architecture](./architecture.md) | Architecture deep-dive comparing both systems |
| [Feature Gap Analysis](./features.md) | Side-by-side feature comparison with gap identification |
| [Recommended Improvements](./improvements.md) | Prioritized list of improvements Codedeck should implement |
| [Learnings & Patterns](./learnings.md) | Interesting patterns, techniques, and insights from OpenCode |

---

## Executive Summary

**OpenCode** is a mature, feature-rich AI coding agent with 20+ providers, 20+ built-in tools, a full plugin/skill system, LSP integration, git snapshots, a comprehensive TUI with 33 themes, and extensive configuration options. It runs as both a CLI/TUI and a headless HTTP server.

**Codedeck** is a GUI dashboard that wraps OpenCode's server API, providing a visual interface for managing multiple AI agent sessions across projects. It's a Vite + React 19 app with a Bun backend, designed for future Tauri desktop packaging.

### The Relationship

Codedeck is **not a competitor** to OpenCode — it's a **visual frontend** for it. Codedeck spawns and manages OpenCode server processes, connecting via the SDK to provide a multi-project dashboard experience. However, Codedeck currently exposes only a fraction of OpenCode's capabilities.

### Key Findings

1. **Codedeck surfaces ~30% of OpenCode's features** — the core chat, session management, and permission approval work well, but many powerful features (session forking, undo/redo, compaction, snapshots, diffs, slash commands, themes, cost tracking, LSP status, MCP management, worktrees, sharing, and more) have no GUI equivalent yet.

2. **OpenCode has 65+ configurable keybindings** — Codedeck has ~5. The TUI is a power-user interface with deep keyboard customization that Codedeck could learn from.

3. **OpenCode's plugin system** (hooks, custom tools, custom commands, skills) has no Codedeck integration. Users can't manage plugins, skills, or custom commands through the GUI.

4. **OpenCode's 33 built-in themes** with full syntax/diff/markdown color tokens are vastly more sophisticated than Codedeck's single dark theme. The theme system supports custom user themes and live preview during selection.

5. **Cost tracking** is built into OpenCode (per-message token counts, session cost totals, context % used) but not surfaced in Codedeck's UI.

6. **Session operations** like fork, undo/redo, compact, share, export, and timeline navigation exist in OpenCode but not in Codedeck.

7. **File diffs** are a first-class concept in OpenCode (split/unified views, syntax-highlighted, with snapshot-based revert) but absent from Codedeck.

8. **MCP server management** (connect/disconnect, status, OAuth flows) exists in OpenCode's API but Codedeck doesn't expose it.

9. **OpenCode has ACP (Agent Client Protocol) support** for standardized agent communication — a pattern Codedeck could adopt for multi-agent orchestration.

10. **The prompt input** in OpenCode is substantially more capable: shell mode, `@file` autocomplete with frecency, `/command` autocomplete, prompt history with persistence, prompt stash (git-stash-like drafts), paste summarization, image pasting, and external editor integration.

---

## At a Glance

| Dimension | OpenCode | Codedeck |
|-----------|----------|----------|
| **Language** | TypeScript (Bun) | TypeScript (Bun + Vite) |
| **UI** | Terminal (opentui + SolidJS) | Browser/Desktop (React 19) |
| **State** | SolidJS signals + KV store | Zustand + React hooks |
| **Providers** | 20+ (Anthropic, OpenAI, Google, etc.) | Passthrough via OpenCode |
| **Tools** | 20+ built-in | Display-only (renders OpenCode tool calls) |
| **Themes** | 33 built-in + custom | 1 (dark) |
| **Keybindings** | 65+ configurable | ~5 hardcoded |
| **Sessions** | Fork, undo, redo, compact, share, export | Create, view, delete |
| **Prompt** | History, stash, @file, /cmd, shell mode, editor | Basic textarea |
| **Diffs** | Split/unified, syntax-highlighted, revert | None |
| **Plugins** | Full system (hooks, tools, commands, skills) | None |
| **MCP** | Full management (connect, auth, status) | None |
| **LSP** | Integrated (diagnostics, go-to-def, etc.) | None |
| **Git** | Snapshots, worktrees, branch tracking | Branch display |
| **Cost** | Per-message tokens, session cost, context % | None |
| **ACP** | Full Agent Client Protocol support | None |
| **Desktop** | None (TUI-only) | Planned (Tauri) |
| **Multi-project** | Single project per instance | Multi-project dashboard |
