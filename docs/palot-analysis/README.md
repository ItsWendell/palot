# Palot Analysis: Comparison with OpenCode TUI & Desktop

> **Date:** February 8, 2026
> **Scope:** Deep feature-by-feature analysis of Palot vs OpenCode TUI and OpenCode Desktop

## Documents

| Document                                                   | Description                                                         |
| ---------------------------------------------------------- | ------------------------------------------------------------------- |
| [Feature Gaps](./01-feature-gaps.md)                       | Features present in OpenCode TUI/Desktop that Palot is missing   |
| [Palot Strengths](./02-palot-strengths.md)           | Areas where Palot is better than or differentiated from OpenCode |
| [UI Improvements](./03-ui-improvements.md)                 | Specific UI improvements Palot could make                        |
| [UX Improvements](./04-ux-improvements.md)                 | User experience workflow improvements                               |
| [Architecture Comparison](./05-architecture-comparison.md) | Technical architecture comparison and trade-offs                    |
| [Feature Parity Roadmap](./06-feature-parity-roadmap.md)   | Prioritized roadmap to close the most impactful gaps                |

## Quick Summary

**Palot's current state:** Early-stage desktop app (~30% feature parity with OpenCode) built on Electron + React 19 + Zustand, using the OpenCode SDK to communicate with an `opencode serve` backend. It surfaces core chat, session management, multi-project browsing, model/agent selection, permissions, questions, and todo tracking.

**OpenCode TUI:** Mature terminal-based UI built on a custom framework (OpenTUI + SolidJS). 70+ keybinds, 34+ themes, 16 languages, full tool/MCP/LSP integration, session forking/sharing/export, undo/redo with git snapshots, and a rich plugin/skill system.

**OpenCode Desktop:** SolidJS + Tauri desktop app that shares a component library with the TUI. Features file trees, embedded terminal (Ghostty-web), drag-and-drop tabs, multi-workspace support, inline code editor, session review with line-level comments, native notifications/sounds, and 15+ themes.

**Key takeaway:** Palot has a strong architectural foundation and some unique strengths (streaming performance optimizations, clean React/Zustand architecture, rich AI element component library, ambitious roadmap for cloud/VM execution environments), but has significant feature gaps in session management, code review, theming, and configuration that need closing.
